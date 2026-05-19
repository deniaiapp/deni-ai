import crypto from 'crypto';
import { getDeniPool } from './db';

export type ApiKeyValidationResult =
  | { valid: true; userId: string }
  | { valid: false; error: string; code: 'invalid_key' | 'expired_key' | 'guest_account' | 'db_error' };

export const GUEST_ACCOUNT_ERROR_MESSAGE =
  'Guest accounts are not supported. Please sign in with a permanent account.';

/**
 * Hash an API key using SHA-256
 */
export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Validate a Deni API key and return the associated user ID
 */
export async function validateDeniApiKey(rawKey: string): Promise<ApiKeyValidationResult> {
  if (!rawKey.startsWith('deni_')) {
    return { valid: false, error: 'Invalid API key format', code: 'invalid_key' };
  }

  const keyHash = hashApiKey(rawKey);
  const pool = getDeniPool();

  try {
    const result = await pool.query<{
      user_id: string;
      expires_at: Date | null;
      is_anonymous: boolean;
    }>(
      `SELECT k.user_id, k.expires_at, COALESCE(u.is_anonymous, false) AS is_anonymous
       FROM api_key k
       JOIN "user" u ON u.id = k.user_id
       WHERE k.key_hash = $1`,
      [keyHash]
    );

    if (result.rows.length === 0) {
      return { valid: false, error: 'API key not found', code: 'invalid_key' };
    }

    const { user_id, expires_at, is_anonymous } = result.rows[0];

    if (is_anonymous) {
      return { valid: false, error: GUEST_ACCOUNT_ERROR_MESSAGE, code: 'guest_account' };
    }

    // Check expiration
    if (expires_at && new Date(expires_at) < new Date()) {
      return { valid: false, error: 'API key has expired', code: 'expired_key' };
    }

    // Update last_used_at asynchronously (fire and forget)
    pool.query(
      `UPDATE api_key SET last_used_at = NOW() WHERE key_hash = $1`,
      [keyHash]
    ).catch(err => console.error('Failed to update last_used_at:', err));

    return { valid: true, userId: user_id };
  } catch (error) {
    console.error('API key validation error:', error);
    return { valid: false, error: 'Database error during validation', code: 'db_error' };
  }
}
