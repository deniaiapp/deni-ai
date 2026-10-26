export interface DeniUsageInfo {
  tier: 'free' | 'plus' | 'pro' | "max";
  planId: string | null;
  status: string | null;
  hasVerifiedPaymentMethod: boolean;
  cardVerifiedAt: string | null;
  verifyUrl: string;
  upgradeUrl: string;
  isTeam: boolean;
  periodEnd: string | null;
  maxModeEnabled: boolean;
  maxModeEligible: boolean;
  usage: Array<{
    category: 'basic' | 'premium';
    unit: 'requests' | 'tokens';
    limit: number | null;
    used: number;
    remaining: number | null;
    periodStart: string;
    periodEnd: string | null;
  }>;
  /**
   * The one monthly pool shared by Deni AI chat, Flixa, and Deni Run, in usage units.
   * Usage is not split by model class; `usage` repeats it for older clients.
   */
  pool: {
    limit: number;
    used: number;
    remaining: number;
    periodEnd: string;
  };
}

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
  plan_tier: 'free' | 'plus' | 'pro' | 'max';
  limit_amount: number | null;
  unit: 'requests' | 'tokens';
  used: number;
  period_start: Date;
  period_end: Date | null;
}
