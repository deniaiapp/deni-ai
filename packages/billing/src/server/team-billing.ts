import { sql } from "drizzle-orm";
import { billing } from "@deniai/db";

/**
 * The canonical billing row of a team: the oldest row of its organization.
 * Historical per-admin copies are ignored even before the next Stripe sync.
 */
export function canonicalTeamBillingRow() {
  return sql`${billing.id} = (SELECT canonical.id FROM billing AS canonical WHERE canonical.organization_id = ${billing.organizationId} ORDER BY canonical.created_at, canonical.id LIMIT 1)`;
}
