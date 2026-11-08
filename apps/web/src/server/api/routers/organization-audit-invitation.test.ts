import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { beforeEach, expect, test, vi } from "vitest";
import { billing } from "@/db/schema";
import { organizationRouter } from "@/server/api/routers/organization";

// Keep these local: no real auth, database, or Stripe.
const state = vi.hoisted(() => ({
  subscriptions: {} as Record<string, { status: string }>,
}));
vi.mock("@/db/drizzle", () => ({ db: {} }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("@/lib/billing-config", () => ({ isBillingDisabled: false }));
vi.mock("@/lib/team-billing", () => ({
  getOrgMemberCount: vi.fn(async () => 2),
  // The audit log is a paid team feature.
  hasPaidTeamPlan: vi.fn(async () => true),
  updateTeamSeatCount: vi.fn(),
}));
vi.mock("@/lib/stripe", () => ({
  stripe: {
    subscriptions: {
      retrieve: vi.fn(async (id: string) => ({
        id,
        status: state.subscriptions[id]?.status ?? "canceled",
        items: { data: [{ id: `${id}-item`, price: { lookup_key: "pro_team_monthly" } }] },
      })),
    },
  },
}));

type Rows = (query: string) => unknown[][];

function caller(rows: Rows) {
  const queries: string[] = [];
  const db = drizzle(async (query) => {
    queries.push(query);
    return { rows: rows(query) };
  });
  return {
    queries,
    api: organizationRouter.createCaller({
      db,
      session: {
        session: { userId: "invitee" },
        user: { isAnonymous: false, emailVerified: true },
      },
    } as never),
  };
}

function billingRow(values: Record<string, unknown>) {
  return Object.keys(getTableColumns(billing)).map((key) => values[key] ?? null);
}

beforeEach(() => {
  state.subscriptions = {
    sub_team: { status: "active" },
    sub_personal: { status: "active" },
  };
});

test("the audit log keeps entries whose actor deleted their account", async () => {
  const { api, queries } = caller((query) => {
    if (query.includes('from "member"')) return [["admin"]];
    return [
      [
        "log",
        "subscription_canceled",
        {},
        "2026-10-01 00:00:00",
        "2026-10-01T00:00:00.000000Z",
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ],
    ];
  });

  const result = await api.teamAuditLog({ organizationId: "team" });

  expect(queries.at(-1)).toContain('left join "user" "actor_user"');
  expect(result.items).toEqual([
    expect.objectContaining({ id: "log", actorId: null, actorName: null, actorEmail: null }),
  ]);
});

function invitationRows(invitationEmail: string): Rows {
  const expiresAt = "2099-01-01 00:00:00";
  return (query) => {
    if (query.includes('from "invitation"')) {
      return [["team", invitationEmail, "pending", expiresAt]];
    }
    if (query.includes('from "user"')) return [["Invitee@Example.com"]];
    if (query.includes('"organization_id" is null')) return [["sub_personal"]];
    if (query.includes('from "billing"')) {
      return [
        billingRow({
          id: "team-billing",
          userId: "owner",
          organizationId: "team",
          stripeCustomerId: "cus_team",
          stripeSubscriptionId: "sub_team",
          planId: "pro_team_monthly",
          status: "active",
        }),
      ];
    }
    return [];
  };
}

test("accepting an invitation to a paid team warns that it cancels the personal plan", async () => {
  const { api } = caller(invitationRows("invitee@example.com"));

  await expect(api.invitationBillingImpact({ invitationId: "inv" })).resolves.toEqual({
    cancelsPersonalSubscription: true,
  });
});

test("no warning when the personal subscription is no longer active", async () => {
  state.subscriptions.sub_personal = { status: "canceled" };
  const { api } = caller(invitationRows("invitee@example.com"));

  await expect(api.invitationBillingImpact({ invitationId: "inv" })).resolves.toEqual({
    cancelsPersonalSubscription: false,
  });
});

test("only the invitee can ask about an invitation's billing impact", async () => {
  const { api, queries } = caller(invitationRows("someone-else@example.com"));

  await expect(api.invitationBillingImpact({ invitationId: "inv" })).resolves.toEqual({
    cancelsPersonalSubscription: false,
  });
  expect(queries.some((query) => query.includes('from "billing"'))).toBe(false);
});
