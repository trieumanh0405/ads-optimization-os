import { describe, expect, it } from "vitest";
import { parseAiInsight } from "./contracts";

describe("AI output contract", () => {
  it("accepts fenced JSON but rejects output outside the schema", () => {
    const insight = parseAiInsight(`\`\`\`json
      {"summary":"S","observations":[],"hypotheses":[],"suggestedChecks":[],"actionCommentary":"A","confidence":0.5,"limitations":[]}
    \`\`\``);
    expect(insight.confidence).toBe(0.5);
    expect(() => parseAiInsight('{"summary":"missing fields"}')).toThrow();
  });
});
