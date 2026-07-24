import type { MetricDefinition } from "./schemas";

export const standardMetricLibrary: MetricDefinition[] = [
  { key: "CPL", label: "Cost per lead", kind: "RATIO", numerator: "spend", denominator: "result", multiplier: 1, direction: "LOWER_IS_BETTER", nullWhenDenominatorZero: true },
  { key: "CPQL", label: "Cost per qualified lead", kind: "RATIO", numerator: "spend", denominator: "qualifiedResult", multiplier: 1, direction: "LOWER_IS_BETTER", nullWhenDenominatorZero: true },
  { key: "CPA", label: "Cost per acquisition", kind: "RATIO", numerator: "spend", denominator: "result", multiplier: 1, direction: "LOWER_IS_BETTER", nullWhenDenominatorZero: true },
  { key: "ROAS", label: "Return on ad spend", kind: "RATIO", numerator: "revenue", denominator: "spend", multiplier: 1, direction: "HIGHER_IS_BETTER", nullWhenDenominatorZero: true },
  { key: "CTR", label: "Click-through rate", kind: "RATE", numerator: "clicks", denominator: "impressions", multiplier: 1, direction: "HIGHER_IS_BETTER", nullWhenDenominatorZero: true },
  { key: "CPC", label: "Cost per click", kind: "RATIO", numerator: "spend", denominator: "clicks", multiplier: 1, direction: "LOWER_IS_BETTER", nullWhenDenominatorZero: true },
  { key: "CVR", label: "Conversion rate", kind: "RATE", numerator: "result", denominator: "clicks", multiplier: 1, direction: "HIGHER_IS_BETTER", nullWhenDenominatorZero: true },
  { key: "CPM", label: "Cost per 1,000 impressions", kind: "RATIO", numerator: "spend", denominator: "impressions", multiplier: 1000, direction: "LOWER_IS_BETTER", nullWhenDenominatorZero: true }
];
