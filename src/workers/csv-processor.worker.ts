// Web Worker for CSV processing
import { parseCsv } from "@/core/csv";
import { normalizeRows } from "@/core/normalize";
import type { SourceMapping, SupportingMetricMapping, DimensionMapping } from "@/core/normalize";
import { classifyFacts } from "@/core/scopes";
import type { ProjectConfig } from "@/core/schemas";

type WorkerRequest = {
  type: "PROCESS";
  payload: {
    csvText: string;
    mappings: SourceMapping[];
    metricMappings?: SupportingMetricMapping[];
    dimensionMappings?: DimensionMapping[];
    config: ProjectConfig;
  };
};

type WorkerResponse = 
  | { type: "PROGRESS"; stage: "parsing" | "normalizing" | "classifying" | "done"; detail?: string }
  | { type: "RESULT"; data: { facts: any[]; errors: any[]; rawRowCount: number } }
  | { type: "ERROR"; message: string };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const { csvText, mappings, metricMappings, dimensionMappings, config } = event.data.payload;
    
    // Stage 1: Parse
    const post = (msg: WorkerResponse) => self.postMessage(msg);
    post({ type: "PROGRESS", stage: "parsing" });
    const parsed = parseCsv(csvText);
    const rows = Array.isArray(parsed) ? parsed : (parsed as { rows: Record<string, string>[] }).rows;
    
    // Stage 2: Normalize
    post({ type: "PROGRESS", stage: "normalizing", detail: `${rows.length} rows` });
    const { facts, errors } = normalizeRows(rows, {
      projectId: config.projectId,
      platform: config.platform,
      accountId: config.accountId,
      mappings,
      metricMappings,
      dimensionMappings
    });
    
    // Stage 3: Classify
    post({ type: "PROGRESS", stage: "classifying", detail: `${facts.length} facts` });
    const classified = classifyFacts(facts, config);
    
    // Done
    post({ type: "PROGRESS", stage: "done" });
    post({ type: "RESULT", data: { facts: classified, errors, rawRowCount: rows.length } });
  } catch (err) {
    self.postMessage({ type: "ERROR", message: err instanceof Error ? err.message : String(err) });
  }
};
