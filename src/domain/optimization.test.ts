import { describe, expect, it } from "vitest";
import { defaultRuleConfig, optimizeEntity, parseEntityCsv } from "./optimization";

describe("working optimizer", () => {
  it("turns off expensive ads after enough evidence", () => {
    expect(optimizeEntity({ id: "1", level: "ad", name: "A", spend: 1000000, results: 1, metric: 600000 }, defaultRuleConfig).action).toBe("TURN_OFF");
  });
  it("imports normalized CSV", () => {
    expect(parseEntityCsv("entity_id,entity_level,entity_name,spend,results\n1,ad,Creative A,640000,2")[0].metric).toBe(320000);
  });
});
