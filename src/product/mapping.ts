import type { FactRow } from "@/core/schemas";
import type { DimensionMapping, SourceMapping, SupportingMetricMapping } from "@/core/normalize";

const aliases: Record<string, string[]> = {
  date: ["date", "day", "reporting starts", "reporting ends", "ngay", "ngay bao cao"],
  campaignId: ["campaign id", "campaign_id", "id chien dich", "ma chien dich"],
  campaignName: ["campaign name", "campaign", "ten chien dich"],
  adsetId: ["ad set id", "adset id", "adset_id", "id nhom quang cao"],
  adsetName: ["ad set name", "adset name", "ten nhom quang cao"],
  adId: ["ad id", "ad_id", "id quang cao"],
  adName: ["ad name", "ad", "ten quang cao"],
  status: ["delivery", "status", "trang thai", "phan phoi"],
  budget: ["budget", "daily budget", "lifetime budget", "ngan sach"],
  spend: ["amount spent", "spend", "cost", "so tien da chi tieu", "chi tieu"],
  result: ["results", "result", "leads", "purchases", "messaging conversations started", "ket qua", "khach hang tiem nang"],
  qualifiedResult: ["qualified result", "qualified lead", "qlead", "vlead", "qualified_result", "lead du dieu kien"],
  revenue: ["purchase conversion value", "revenue", "conversion value", "doanh thu", "gia tri chuyen doi mua hang"],
  impressions: ["impressions", "luot hien thi"],
  clicks: ["link clicks", "inline link clicks", "clicks (all)", "clicks", "luot nhap vao lien ket"],
  sourceUpdatedAt: ["source updated at", "updated at", "last updated", "data updated at"]
};

export const supportingMetricAliases: Record<string, string[]> = {
  reach: ["reach", "so nguoi tiep can"],
  clicksAll: ["clicks (all)", "clicks all"],
  linkClicks: ["link clicks", "inline link clicks", "luot nhap vao lien ket"],
  messagingConversations: ["messaging conversations started", "messaging conversations", "mcs"],
  purchases: ["purchases", "purchase"],
  addToCart: ["adds to cart", "add to cart", "addtocart"],
  initiateCheckout: ["checkouts initiated", "initiate checkout", "initiated checkout"],
  landingPageViews: ["landing page views", "landing page view"],
  video3s: ["3-second video plays", "video views", "video plays at 3s"],
  thruPlays: ["thruplays", "video thruplay watched actions"],
  frequency: ["frequency", "tan suat"]
};

export const dimensionAliases: Record<string, string[]> = {
  objective: ["objective", "muc tieu"],
  optimizationGoal: ["optimization goal", "performance goal", "muc tieu toi uu"],
  learningStatus: ["learning status", "delivery", "learning phase"],
  postId: ["post id", "post_id", "creative id"],
  campaignObjective: ["4. campaign objective", "campaign objective"],
  namingObjective: ["5. objective", "naming objective"],
  funnel: ["7. funnel", "funnel"],
  product: ["8. products", "products", "product"],
  kpiMetric: ["9. kpi metrics", "kpi metrics", "kpi metric"],
  budgetOptimization: ["10. budget optimization", "budget optimization"],
  performanceGoal: ["21. performance goal", "performance goal"],
  destination: ["28. destination", "destination"]
};

function normalized(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function findHeader(headers: string[], candidates: string[]): string | null {
  const normalizedHeaders = headers.map((header) => ({ header, normalized: normalized(header) }));
  for (const candidate of candidates) {
    const exact = normalizedHeaders.find((item) => item.normalized === normalized(candidate));
    if (exact) return exact.header;
  }
  for (const candidate of candidates) {
    const partial = normalizedHeaders.find((item) => item.normalized.includes(normalized(candidate)));
    if (partial) return partial.header;
  }
  return null;
}

function mapping(
  canonicalField: SourceMapping["canonicalField"],
  sourceColumn: string | null,
  required: boolean,
  defaultValue?: unknown
): SourceMapping {
  return {
    canonicalField,
    sourceColumn: sourceColumn ?? "__DEFAULT__",
    required,
    ...(defaultValue === undefined ? {} : { defaultValue })
  };
}

export function suggestMappings(
  headers: string[],
  entityLevel: FactRow["entityLevel"],
  budgetType: FactRow["budgetType"],
  importedAt: string
): {
  mappings: SourceMapping[];
  metricMappings: SupportingMetricMapping[];
  dimensionMappings: DimensionMapping[];
} {
  const campaignName = findHeader(headers, aliases.campaignName);
  const adsetName = findHeader(headers, aliases.adsetName);
  const adName = findHeader(headers, aliases.adName);
  const campaignId = findHeader(headers, aliases.campaignId) ?? campaignName;
  const adsetId = findHeader(headers, aliases.adsetId) ?? adsetName;
  const adId = findHeader(headers, aliases.adId) ?? adName;
  const entityName = entityLevel === "CAMPAIGN" ? campaignName
    : entityLevel === "ADSET" ? adsetName
      : adName;

  const mappings: SourceMapping[] = [
    mapping("date", findHeader(headers, aliases.date), true),
    mapping("entityLevel", null, true, entityLevel),
    mapping("campaignId", campaignId, true),
    mapping("adsetId", entityLevel === "CAMPAIGN" ? null : adsetId, entityLevel !== "CAMPAIGN", null),
    mapping("adId", entityLevel === "AD" ? adId : null, entityLevel === "AD", null),
    mapping("entityName", entityName, true),
    mapping("status", findHeader(headers, aliases.status), false, "UNKNOWN"),
    mapping("budgetType", null, true, budgetType),
    mapping("budget", findHeader(headers, aliases.budget), false, null),
    mapping("spend", findHeader(headers, aliases.spend), true),
    mapping("result", findHeader(headers, aliases.result), false, null),
    mapping("qualifiedResult", findHeader(headers, aliases.qualifiedResult), false, null),
    mapping("revenue", findHeader(headers, aliases.revenue), false, null),
    mapping("impressions", findHeader(headers, aliases.impressions), false, null),
    mapping("clicks", findHeader(headers, aliases.clicks), false, null),
    mapping("sourceUpdatedAt", findHeader(headers, aliases.sourceUpdatedAt), true, importedAt)
  ];

  const metricMappings = Object.entries(supportingMetricAliases).flatMap(([metricKey, candidates]) => {
    const sourceColumn = findHeader(headers, candidates);
    return sourceColumn ? [{ metricKey, sourceColumn }] : [];
  });
  const dimensionMappings = Object.entries(dimensionAliases).flatMap(([dimensionKey, candidates]) => {
    const sourceColumn = findHeader(headers, candidates);
    return sourceColumn ? [{ dimensionKey, sourceColumn }] : [];
  });
  if (campaignName && !dimensionMappings.some((item) => item.dimensionKey === "campaignName")) {
    dimensionMappings.push({ dimensionKey: "campaignName", sourceColumn: campaignName });
  }
  if (adsetName && !dimensionMappings.some((item) => item.dimensionKey === "adsetName")) {
    dimensionMappings.push({ dimensionKey: "adsetName", sourceColumn: adsetName });
  }

  return { mappings, metricMappings, dimensionMappings };
}

export function requiredMappingGaps(mappings: SourceMapping[]): string[] {
  return mappings
    .filter((item) => item.required && item.sourceColumn === "__DEFAULT__" && item.defaultValue === undefined)
    .map((item) => item.canonicalField);
}
