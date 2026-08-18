/**
 * Reason codes are stable identifiers meant for the audit log, not for reading.
 * The board shows the sentence; the drawer keeps the raw code for anyone
 * tracing a decision back through the log.
 */
const REASON_LABELS: Record<string, string> = {
  NO_RULES_CONFIGURED: "Chưa có rule nào cho cấp này",
  MINIMUM_EVIDENCE_NOT_MET: "Chưa đủ chi tiêu hoặc kết quả để kết luận",
  NO_RULE_MATCH: "Không rơi vào dải nào trong bảng ngưỡng",
  CONFLICTING_RULES: "Hai rule cùng độ ưu tiên cho ra hành động trái nhau",
  ENTITY_ALREADY_INACTIVE: "Entity đã tắt sẵn",
  INACTIVE_ENTITY_CANNOT_SCALE: "Đang tắt nên không đổi ngân sách được",
  AD_CANNOT_OWN_BUDGET: "Ad không giữ ngân sách, phải chỉnh ở ad set",
  ENTITY_DOES_NOT_OWN_BUDGET: "Cấp này không giữ ngân sách (CBO/ABO)",
  ADJUSTMENT_CAPPED_BY_GUARDRAIL: "Mức chỉnh đã bị chặn theo trần an toàn",
  MINIMUM_WINDOW_BELOW_SCALE_FLOOR: "Có cửa sổ thời gian quá yếu để tăng ngân sách",
  CONTEXT_BELOW_SCALE_GUARDRAIL: "Nhóm cấp trên chưa đạt, chưa nên tăng ngân sách",
  COHORT_BELOW_SCALE_GUARDRAIL: "Còn kém mặt bằng tài khoản, chưa nên tăng ngân sách",
  BELOW_PLAN_BUT_COMPETITIVE_WITH_COHORT: "Dưới kế hoạch nhưng vẫn tốt hơn mặt bằng tài khoản",
  DAILY_SCALE_LIMIT_REACHED: "Đã chạm giới hạn số lần tăng ngân sách trong ngày",
  EXECUTE_CHILD_ACTIONS_FIRST: "Xử lý xong ad bên trong rồi mới scale cấp cha"
};

const RULE_LABELS: Record<string, string> = {
  "no-result-stop": "Đã tiêu đủ ngưỡng nhưng chưa ra kết quả",
  "critical-under-target": "Dưới 80% target",
  watch: "Đạt 80% đến dưới 100% target",
  keep: "Đạt 100% đến dưới 120% target",
  scale: "Đạt từ 120% target trở lên"
};

export function reasonLabel(code: string): string {
  if (REASON_LABELS[code]) return REASON_LABELS[code];
  if (code.startsWith("WINDOW_RED_FLAG_")) {
    return `Cửa sổ ${code.slice("WINDOW_RED_FLAG_".length).replaceAll("_", ", ")} dưới ngưỡng cảnh báo`;
  }
  if (code.startsWith("RULE_")) {
    const ruleId = code.slice("RULE_".length);
    const suffix = Object.keys(RULE_LABELS).find((key) => ruleId.endsWith(key));
    return suffix ? RULE_LABELS[suffix] : `Khớp rule ${ruleId}`;
  }
  return code;
}

export function reasonSentence(codes: string[]): string {
  return codes.map(reasonLabel).join(" · ");
}

/**
 * Which band of the threshold table a score falls into. Used to colour the
 * achievement readout so a number can be judged without reading the table.
 */
export function achievementBand(value: number | null | undefined): "off" | "watch" | "keep" | "scale" | "unknown" {
  if (value === null || value === undefined || !Number.isFinite(value)) return "unknown";
  if (value < 0.8) return "off";
  if (value < 1.0) return "watch";
  if (value < 1.2) return "keep";
  return "scale";
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatCount(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: digits }).format(value);
}
