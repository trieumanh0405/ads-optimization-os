/**
 * "Chưa đủ dữ liệu" is the least useful thing the board can say. An entity ends
 * up there for three very different reasons, and only one of them means "wait".
 *
 * The dangerous one is a row that spent real money and returned zero of the
 * metric being scored — usually because the ad runs a different objective than
 * the scope's KPI measures. Those rows are not thin, they are mismeasured, and
 * the engine will happily recommend turning them off. Naming that out loud is
 * the difference between a tool you trust and a tool you second-guess.
 */

export type WindowMetric = {
  id: string;
  spend: number;
  result: number | null;
  rowCount: number;
};

export type EvidenceCause = "NO_SPEND" | "SPENT_NO_RESULT" | "THIN_EVIDENCE" | "HEALTHY";

export type EvidenceReading = {
  cause: EvidenceCause;
  spend: number;
  results: number;
};

/** Windows overlap, so the widest one carries the entity's full picture. */
export function readEvidence(windows: WindowMetric[] | undefined): EvidenceReading {
  if (!windows?.length) return { cause: "THIN_EVIDENCE", spend: 0, results: 0 };
  const spend = windows.reduce((most, window) => Math.max(most, window.spend), 0);
  const results = windows.reduce((most, window) => Math.max(most, window.result ?? 0), 0);
  if (spend <= 0) return { cause: "NO_SPEND", spend, results };
  if (results <= 0) return { cause: "SPENT_NO_RESULT", spend, results };
  return { cause: "THIN_EVIDENCE", spend, results };
}

export function causeLabel(cause: EvidenceCause, eventLabel: string): string {
  switch (cause) {
    case "NO_SPEND":
      return "chưa tiêu đồng nào";
    case "SPENT_NO_RESULT":
      return `đã tiêu tiền, chưa ra ${eventLabel} nào`;
    case "THIN_EVIDENCE":
      return "có kết quả nhưng chưa đủ ngưỡng tối thiểu";
    default:
      return "";
  }
}
