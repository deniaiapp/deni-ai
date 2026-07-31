import { Context, Next } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  GUEST_ACCOUNT_ERROR_MESSAGE,
  validateDeniApiKey,
  getDeniBillingProfile,
  getUpgradeUrl,
  getModelCategory,
  getRequiredTierForModel,
  isTierSufficient,
  getVerifyUrl,
  reserveUsageQuota,
  isUserBannedFromFlixa,
  banUserFromFlixa,
  BANNED_ERROR_MESSAGE,
  CLIENT_UPDATE_REQUIRED_MESSAGE,
  isClientSignalEnforcementEnabled,
  detectClientSignal,
  isLegacyAiSdkUserAgent,
  summarizeClientHeaders,
  evaluateSilentBanRules,
} from '../utils/deni';
import { recordClientSignalLog } from '../utils/deni/clientSignalLog';
import { getModelTokenUsageMultiplier } from '../utils/agent/models';

export interface AgentAuthContext {
  userId: string;
  modelId: string;
  tier: 'free' | 'plus' | 'pro' | "max";
  modelCategory: 'basic' | 'premium';
  usageUnit: 'requests' | 'tokens';
  usageReserved: boolean;
  hasVerifiedPaymentMethod: boolean;
  /** Base model multiplier; long-context surcharge is applied at finalize. */
  tokenUsageMultiplier: number;
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

function authErrorMessage(code: string | null, fallback: string): string {
  if (code === 'guest_account') {
    return GUEST_ACCOUNT_ERROR_MESSAGE;
  }

  if (code === 'service_unavailable' || code === 'banned') {
    return BANNED_ERROR_MESSAGE;
  }

  if (code === 'client_update_required') {
    return CLIENT_UPDATE_REQUIRED_MESSAGE;
  }

  if (code === 'invalid_key') {
    return 'Invalid API key. Please login again to Deni AI. If the issue persists, try updating the extension to the latest version.';
  }

  if (code === 'expired_key') {
    return 'Your API key has expired. Please login again to Deni AI to generate a new key.';
  }

  return fallback;
}

function getAuthErrorResponseConfig(code: string | null): {
  status: ContentfulStatusCode;
  type: 'authentication_error' | 'server_error';
} {
  if (
    code === 'guest_account' ||
    code === 'service_unavailable' ||
    code === 'banned' ||
    code === 'client_update_required'
  ) {
    return {
      status: 403,
      type: 'authentication_error',
    };
  }

  if (code === 'db_error') {
    return {
      status: 503,
      type: 'server_error',
    };
  }

  return {
    status: 401,
    type: 'authentication_error',
  };
}

function forbiddenAuthResponse(
  c: Context,
  code: 'service_unavailable' | 'client_update_required',
  message: string,
) {
  const errorResponse = getAuthErrorResponseConfig(code);
  return c.json(
    {
      error: {
        message: authErrorMessage(code, message),
        type: errorResponse.type,
        param: null,
        code,
      },
    },
    { status: errorResponse.status },
  );
}

/**
 * After a key is valid, reject banned users and ban accounts that call the
 * agent API without an allowed client signal (Codex / Claude Code / OpenCode / Flixa).
 *
 * Every request records a client-signal log (console + in-memory ring buffer
 * for /admin/lookup). Legacy AI SDK User-Agents (`ai/…`, `ai-sdk…`) get a soft
 * "please update" response without banning — typically outdated Flixa clients.
 */
async function enforceFlixaAccessPolicy(
  c: Context,
  userId: string,
): Promise<Response | null> {
  const headers = c.req.raw.headers;
  const signal = detectClientSignal(headers);
  const clientHeaders = summarizeClientHeaders(headers);
  const logBase = {
    userId,
    path: c.req.path,
    method: c.req.method,
    client: signal.client,
    headers: clientHeaders,
  };

  if (await isUserBannedFromFlixa(userId)) {
    recordClientSignalLog({
      ...logBase,
      allowed: signal.allowed,
      outcome: 'already_banned',
    });
    // Do not expose "banned" in the API response.
    return forbiddenAuthResponse(c, 'service_unavailable', BANNED_ERROR_MESSAGE);
  }

  // Configurable silent-ban rules (UA / header / path). First N-1 matches
  // still go through; on the Nth match the account is banned silently.
  const silentBan = await evaluateSilentBanRules(
    userId,
    headers,
    c.req.path,
    c.req.method,
  );
  if (silentBan.action === 'banned') {
    recordClientSignalLog({
      ...logBase,
      allowed: signal.allowed,
      outcome: 'silent_rule_banned',
    });
    return forbiddenAuthResponse(c, 'service_unavailable', BANNED_ERROR_MESSAGE);
  }

  if (!isClientSignalEnforcementEnabled()) {
    recordClientSignalLog({
      ...logBase,
      allowed: true,
      outcome: 'enforcement_disabled',
    });
    return null;
  }

  if (signal.allowed) {
    recordClientSignalLog({
      ...logBase,
      allowed: true,
      outcome: 'allowed',
    });
    return null;
  }

  // Outdated Flixa / raw AI SDK: nudge to update, do not ban.
  if (isLegacyAiSdkUserAgent(headers)) {
    recordClientSignalLog({
      ...logBase,
      allowed: false,
      outcome: 'legacy_update_required',
    });
    return forbiddenAuthResponse(
      c,
      'client_update_required',
      CLIENT_UPDATE_REQUIRED_MESSAGE,
    );
  }

  recordClientSignalLog({
    ...logBase,
    allowed: false,
    outcome: 'missing_banned',
  });

  await banUserFromFlixa(userId, 'missing_client_signal', clientHeaders);

  // Same public response as an already-banned account (do not expose ban/signal).
  return forbiddenAuthResponse(
    c,
    'service_unavailable',
    BANNED_ERROR_MESSAGE,
  );
}

async function validateApiKeyFromRequest(c: Context): Promise<{ userId: string } | Response> {
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

  const keyResult = await validateDeniApiKey(apiKey);

  if (!keyResult.valid) {
    const errorResponse = getAuthErrorResponseConfig(keyResult.code);
    return c.json(
      {
        error: {
          message: authErrorMessage(keyResult.code, keyResult.error),
          type: errorResponse.type,
          param: null,
          code: keyResult.code,
        },
      },
      { status: errorResponse.status }
    );
  }

  const policyBlock = await enforceFlixaAccessPolicy(c, keyResult.userId);
  if (policyBlock) {
    return policyBlock;
  }

  return { userId: keyResult.userId };
}

/**
 * Middleware to validate Deni API key only.
 * Used by endpoints that require authentication but do not need quota/tier checks by model.
 */
export async function validateAgentApiKey(c: Context, next: Next) {
  const keyValidation = await validateApiKeyFromRequest(c);
  if (keyValidation instanceof Response) {
    return keyValidation;
  }

  c.set('agentUserId', keyValidation.userId);
  await next();
}

/**
 * Middleware to validate Deni API key and check usage quota for agent requests
 * Must be placed AFTER validateAgentRequest middleware to access validatedBody
 */
export async function validateAgentAuth(c: Context, next: Next) {
  const keyValidation = await validateApiKeyFromRequest(c);
  if (keyValidation instanceof Response) {
    return keyValidation;
  }

  // Get user's billing tier (cached, no usage rows — reserveUsageQuota reads
  // the quota row itself, so fetching it here would be a redundant query)
  const billingProfile = await getDeniBillingProfile(keyValidation.userId);

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

  // Check model category and reserve quota when needed
  const modelCategory = getModelCategory(model);
  const tokenUsageMultiplier = getModelTokenUsageMultiplier(model);
  const requiredTier = getRequiredTierForModel(model);
  const tier = billingProfile.tier;

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

  const quotaReservation = await reserveUsageQuota(
    keyValidation.userId,
    modelCategory,
    tier,
    billingProfile.hasVerifiedPaymentMethod,
  );
  if (!quotaReservation.allowed) {
    return c.json(
      {
        error: {
          message: `You have exceeded your ${modelCategory} model ${quotaReservation.unit} quota. Remaining: ${quotaReservation.remaining}. Please upgrade your plan or wait for quota reset.`,
          type: 'quota_exceeded',
          param: null,
          code: 'USAGE_LIMIT_EXCEEDED',
          category: modelCategory,
          tier,
          canVerifyForBoost: tier === 'free' && !billingProfile.hasVerifiedPaymentMethod,
          canUpgrade: tier !== 'max',
          verifyUrl: getVerifyUrl(),
          upgradeUrl: getUpgradeUrl(),
        },
      },
      429
    );
  }

  // Store auth context for downstream handlers
  c.set('agentAuth', {
    userId: keyValidation.userId,
    modelId: model,
    tier,
    modelCategory,
    usageUnit: quotaReservation.unit,
    usageReserved: quotaReservation.reserved,
    hasVerifiedPaymentMethod: billingProfile.hasVerifiedPaymentMethod,
    tokenUsageMultiplier,
  } satisfies AgentAuthContext);

  await next();
}
