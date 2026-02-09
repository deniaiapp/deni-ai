import crypto from 'crypto';
import { getDeniPool } from './db';

export type ApiKeyValidationResult =
  | { valid: true; userId: string }
  | { valid: false; error: string; code: 'invalid_key' | 'expired_key' | 'db_error' };

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
    }>(
      `SELECT user_id, expires_at FROM api_key WHERE key_hash = $1`,
      [keyHash]
    );

    if (result.rows.length === 0) {
      return { valid: false, error: 'API key not found', code: 'invalid_key' };
    }

    const { user_id, expires_at } = result.rows[0];

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
