export type AdCampaignFilter = "all" | "active" | "rejected" | "ended";

type CampaignSummary = {
  status: string;
  plan: string;
  budgetYen: number;
  spentYen: number;
  endsAt: string | null;
};

export function campaignGroup(
  ad: CampaignSummary,
  now: number,
): Exclude<AdCampaignFilter, "all"> | null {
  if (ad.status === "rejected") return "rejected";
  if (ad.status === "paused") return "ended";
  if (ad.status !== "active") return null;
  if (
    (ad.endsAt && new Date(ad.endsAt).getTime() <= now) ||
    (ad.plan === "cpm" && ad.spentYen >= ad.budgetYen) ||
    (ad.plan === "cpc" && ad.budgetYen - ad.spentYen < 15)
  )
    return "ended";
  return "active";
}

export function paginateCampaigns<T extends CampaignSummary>(
  campaigns: T[],
  filter: AdCampaignFilter,
  page: number,
  now: number,
) {
  const filtered =
    filter === "all" ? campaigns : campaigns.filter((ad) => campaignGroup(ad, now) === filter);
  const totalPages = Math.max(1, Math.ceil(filtered.length / 3));
  const currentPage = Math.max(1, Math.min(page, totalPages));
  return {
    items: filtered.slice((currentPage - 1) * 3, currentPage * 3),
    currentPage,
    totalPages,
    totalItems: filtered.length,
  };
}
