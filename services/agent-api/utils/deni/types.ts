import type { UsageUnit } from './usage';

/**
 * `GET /v1/deni/usage` response. The public shape lives in
 * `@deniai/flixa-contract` so Flixa clients and this server share it.
 */
export type { DeniUsageInfo } from '@deniai/flixa-contract';

export interface BillingRow {
  plan_id: string | null;
  status: string;
  current_period_end: Date | null;
  max_mode_enabled: boolean;
  payment_method_fingerprint: string | null;
  card_verified_at: Date | null;
}

export interface UsageQuotaRow {
  category: string;
  plan_tier: 'free' | 'go' | 'plus' | 'pro';
  limit_amount: number | null;
  unit: UsageUnit;
  used: number;
  period_start: Date;
  period_end: Date | null;
}
