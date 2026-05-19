import { Hono } from 'hono';
import { validateDeniApiKey, getDeniUsageInfo } from '../../utils/deni';

const router = new Hono();

/**
 * GET /v1/deni/usage
 * Get Deni AI user's plan info, usage, and remaining quota
 *
 * Authentication: Bearer token with deni_ prefixed API key
 */
router.get('/deni/usage', async (c) => {
  // Extract API key from Authorization header
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    return c.json({
      error: {
        message: 'Authorization header is required',
        type: 'authentication_error',
        param: null,
        code: 'missing_auth_header'
      }
    }, 401);
  }

  const apiKey = authHeader.replace(/^Bearer\s+/i, '');
  if (!apiKey) {
    return c.json({
      error: {
        message: 'API key is required in Authorization header',
        type: 'authentication_error',
        param: null,
        code: 'missing_api_key'
      }
    }, 401);
  }

  // Validate API key
  const validationResult = await validateDeniApiKey(apiKey);
  if (!validationResult.valid) {
    let statusCode: 401 | 403 | 500 = 401;
    if (validationResult.code === 'db_error') {
      statusCode = 500;
    } else if (validationResult.code === 'guest_account') {
      statusCode = 403;
    }

    return c.json({
      error: {
        message: validationResult.error,
        type: validationResult.code === 'db_error' ? 'server_error' : 'authentication_error',
        param: null,
        code: validationResult.code
      }
    }, statusCode);
  }

  try {
    // Get usage info
    const usageInfo = await getDeniUsageInfo(validationResult.userId);
    return c.json(usageInfo, 200);
  } catch (error) {
    console.error('Failed to get Deni usage info:', error);
    return c.json({
      error: {
        message: 'Failed to retrieve usage information',
        type: 'server_error',
        param: null,
        code: 'usage_fetch_error'
      }
    }, 500);
  }
});

export { router as deniRouter };
