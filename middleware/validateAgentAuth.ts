import { Context, Next } from 'hono';
import {
  validateDeniApiKey,
  getDeniUsageInfo,
  getModelCategory,
  hasQuotaForModel,
  getRequiredTierForModel,
  isTierSufficient,
} from '../utils/deni';

export interface AgentAuthContext {
  userId: string;
  tier: 'free' | 'plus' | 'pro';
  modelCategory: 'basic' | 'premium';
}

/**
 * Extract API key from Authorization or x-api-key headers.
 */
function extractApiKey(authHeader: string | undefined, apiKeyHeader: string | undefined): string | null {
  if (apiKeyHeader && apiKeyHeader.trim().length > 0) {
    return apiKeyHeader.trim();
  }

  if (!authHeader) return null;

  // Support "Bearer <key>" format
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  return null;
}

/**
 * Middleware to validate Deni API key and check usage quota for agent requests
 * Must be placed AFTER validateAgentRequest middleware to access validatedBody
 */
export async function validateAgentAuth(c: Context, next: Next) {
  // Extract API key from Authorization header or x-api-key
  const authHeader = c.req.header('Authorization');
  const apiKeyHeader = c.req.header('x-api-key');
  const apiKey = extractApiKey(authHeader, apiKeyHeader);

  if (!apiKey) {
    return c.json(
      {
        error: {
          message: 'Authentication required. Please update the Flixa extension to the latest version.',
          type: 'authentication_error',
          param: null,
          code: 'missing_api_key',
        },
      },
      401
    );
  }

  // Validate API key
  const keyResult = await validateDeniApiKey(apiKey);

  if (!keyResult.valid) {
    let message = keyResult.error;
    if (keyResult.code === 'invalid_key') {
      message = 'Invalid API key. Please login again to Deni AI. If the issue persists, try updating the extension to the latest version.';
    } else if (keyResult.code === 'expired_key') {
      message = 'Your API key has expired. Please login again to Deni AI to generate a new key.';
    }

    return c.json(
      {
        error: {
          message,
          type: 'authentication_error',
          param: null,
          code: keyResult.code,
        },
      },
      401
    );
  }

  // Get user's usage info
  const usageInfo = await getDeniUsageInfo(keyResult.userId);

  // Get model from validated body
  const body = c.get('validatedBody') as { model?: string } | undefined;
  const model = body?.model;

  if (!model) {
    return c.json(
      {
        error: {
          message: 'model is required',
          type: 'invalid_request_error',
          param: 'model',
          code: 'missing_model',
        },
      },
      400
    );
  }

  // Check model category and quota
  const modelCategory = getModelCategory(model);
  const quotaCheck = hasQuotaForModel(usageInfo.usage, modelCategory);

  if (!quotaCheck.allowed) {
    return c.json(
      {
        error: {
          message: `You have exceeded your ${modelCategory} model quota. Remaining: ${quotaCheck.remaining}. Please upgrade your plan or wait for quota reset.`,
          type: 'quota_exceeded',
          param: null,
          code: 'quota_exceeded',
        },
      },
      429
    );
  }

  // Check tier-based model restrictions
  const requiredTier = getRequiredTierForModel(model);
  const tier = usageInfo.tier;

  if (requiredTier && !isTierSufficient(tier, requiredTier)) {
    return c.json(
      {
        error: {
          message: `The model "${model}" requires a ${requiredTier} plan or higher. Your current plan: ${tier}. Please upgrade your plan to access this model.`,
          type: 'insufficient_plan',
          param: 'model',
          code: 'tier_restricted',
        },
      },
      403
    );
  }

  // Store auth context for downstream handlers
  c.set('agentAuth', {
    userId: keyResult.userId,
    tier,
    modelCategory,
  } satisfies AgentAuthContext);

  await next();
}
