import { UsageEstimate } from "../utils/agent/usageEstimation";
import type { UsageReservation } from "../utils/deni/usage";
import { Context, Next } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  GUEST_ACCOUNT_ERROR_MESSAGE,
  extractApiKeyFromHeaders,
  redactApiKey,
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
import { getModelDefinition, getModelTokenUsageMultiplier } from '../utils/agent/models';
import { checkUserRateLimit } from './rateLimit';
import {
  getAuthDisabledUserId,
  isAuthDisabledMode,
} from '../utils/authMode';

export interface AgentAuthContext {
  userId: string;
  modelId: string;
  tier: 'free' | 'plus' | 'pro' | "max";
  modelCategory: 'basic' | 'premium';
  usageUnit: 'requests' | 'tokens';
  usageReserved: boolean;
  usageReservation?: UsageReservation;
  usageEstimate?: UsageEstimate;
  hasVerifiedPaymentMethod: boolean;
  /** Base model multiplier; long-context surcharge is applied at finalize. */
  tokenUsageMultiplier: number;
  /** False when FLIXA_AUTH_DISABLED bypasses billing and quota accounting. */
  usageMeteringEnabled: boolean;
}

function missingApiKeyMessage(c: Context): string {
  const signal = detectClientSignal(c.req.raw.headers);
  if (signal.client === 'codex') {
    return (
      'Authentication required. Codex did not send an API key. In %USERPROFILE%\\.codex\\config.toml ' +
      '(or ~/.codex/config.toml) set requires_openai_auth = false and either env_key = "FLIXA_API_KEY" ' +
      'with that variable defined for the Codex process, or pin the key with ' +
      '[model_providers.<id>.http_headers] Authorization = "Bearer deni_...". ' +
      'Windows Codex TUI launched from the Start menu / a shortcut often cannot see a PowerShell $env: ' +
      'set in another window. Restart Codex after saving. Codex omits Authorization when env_key is ' +
      'unset or the env var is empty.'
    );
  }

  if (signal.client === 'flixa' || signal.client === 'flixa_cli') {
    return 'Authentication required. Please update the Flixa extension to the latest version.';
  }

  return (
    'Authentication required. Provide an API key in the Authorization: Bearer header ' +
    'or x-api-key.'
  );
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
 * agent API without an allowed client signal (Codex / Claude Code / OpenCode / Zed / Flixa).
 *
 * Every request records a client-signal log (console + in-memory ring buffer
 * for /admin/lookup). Legacy AI SDK User-Agents (`ai/…`, `ai-sdk…`) get a soft
 * "please update" response without banning — typically outdated Flixa clients.
 */
async function enforceFlixaAccessPolicy(
  c: Context,
  userId: string,
  apiKey: string | null,
): Promise<Response | null> {
  const headers = c.req.raw.headers;
  const signal = detectClientSignal(headers);
  const clientHeaders = summarizeClientHeaders(headers);
  const logBase = {
    userId,
    apiKey,
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
  if (isAuthDisabledMode()) {
    return { userId: getAuthDisabledUserId() };
  }

  const apiKey = extractApiKeyFromHeaders(c.req.raw.headers);
  const apiKeyRedacted = redactApiKey(apiKey);

  if (!apiKey) {
    return c.json(
      {
        error: {
          message: missingApiKeyMessage(c),
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

  const policyBlock = await enforceFlixaAccessPolicy(
    c,
    keyResult.userId,
    apiKeyRedacted,
  );
  if (policyBlock) {
    return policyBlock;
  }

  // Short-window request rate limit (separate from monthly usage quota).
  const rateLimited = await checkUserRateLimit(c, keyResult.userId);
  if (rateLimited) {
    return rateLimited;
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

  if (!getModelDefinition(model)) {
    return c.json(
      {
        error: {
          message: `The model "${model}" does not exist or is not available.`,
          type: 'invalid_request_error',
          param: 'model',
          code: 'model_not_found',
        },
      },
      404
    );
  }

  const modelCategory = getModelCategory(model);
  if (isAuthDisabledMode()) {
    c.set('agentAuth', {
      userId: keyValidation.userId,
      modelId: model,
      tier: 'max',
      modelCategory,
      usageUnit: 'tokens',
      usageReserved: false,
      hasVerifiedPaymentMethod: true,
      tokenUsageMultiplier: getModelTokenUsageMultiplier(model),
      usageMeteringEnabled: false,
    } satisfies AgentAuthContext);

    await next();
    return;
  }

  // Get the cached billing tier before atomically reserving usage.
  const billingProfile = await getDeniBillingProfile(keyValidation.userId);

  // Check model category and reserve quota when needed
  const requiredTier = getRequiredTierForModel(model);
  const tier = billingProfile.tier;
  const tokenUsageMultiplier = getModelTokenUsageMultiplier(model, tier);

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

  const protocol = c.req.path.endsWith('/responses/compact') ? 'compact'
    : c.req.path.endsWith('/responses') ? 'responses'
    : c.req.path.endsWith('/messages') ? 'messages' : 'chat';
  const usageEstimate = new UsageEstimate(body as Record<string, unknown>, model, protocol, tier);
  if (!Number.isSafeInteger(usageEstimate.reservationAmount)) {
    return c.json({ error: {
      message: 'Requested token budget is too large.',
      type: 'invalid_request_error', param: null, code: 'invalid_parameter',
    } }, 400);
  }
  const quotaReservation = await reserveUsageQuota(
    keyValidation.userId,
    modelCategory,
    tier,
    billingProfile.hasVerifiedPaymentMethod,
    usageEstimate.reservationAmount,
  );
  if (!quotaReservation.allowed) {
    return c.json(
      {
        error: {
          message: `Insufficient ${modelCategory} model ${quotaReservation.unit} quota to reserve this request (${usageEstimate.reservationAmount} estimated tokens). Please upgrade your plan or wait for quota reset.`,
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
    usageReservation: quotaReservation.reservation,
    usageEstimate,
    hasVerifiedPaymentMethod: billingProfile.hasVerifiedPaymentMethod,
    tokenUsageMultiplier,
    usageMeteringEnabled: true,
  } satisfies AgentAuthContext);

  await next();
}
