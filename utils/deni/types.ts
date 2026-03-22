export interface DeniUsageInfo {
  tier: 'free' | 'plus' | 'pro' | "max";
  planId: string | null;
  status: string | null;
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
}

export interface BillingRow {
  plan_id: string;
  status: string;
  current_period_end: Date | null;
  max_mode_enabled: boolean;
}

export interface UsageQuotaRow {
  category: string;
  limit_amount: number | null;
  used: number;
  period_start: Date;
  period_end: Date | null;
}
