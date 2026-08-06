"use client";

import { useCallback, useRef, useState } from "react";
import type { SourceMapping, SupportingMetricMapping, DimensionMapping, NormalizeError } from "@/core/normalize";
import type { ProjectConfig, FactRow } from "@/core/schemas";

export type CsvProgress = 
  | { stage: "idle" }
  | { stage: "reading" }
  | { stage: "parsing" }
  | { stage: "normalizing"; detail?: string }
  | { stage: "classifying"; detail?: string }
  | { stage: "done" };

export type CsvResult = {
  facts: FactRow[];
  errors: NormalizeError[];
  rawRowCount: number;
};

export function useCsvWorker() {
  const workerRef = useRef<Worker | null>(null);
  const [progress, setProgress] = useState<CsvProgress>({ stage: "idle" });

  const processFile = useCallback(
    (
      csvText: string,
      mappings: SourceMapping[],
      config: ProjectConfig,
      metricMappings?: SupportingMetricMapping[],
      dimensionMappings?: DimensionMapping[]
    ): Promise<CsvResult> => {
      return new Promise((resolve, reject) => {
        try {
          const worker = new Worker(
            new URL("../workers/csv-processor.worker.ts", import.meta.url),
            { type: "module" }
          );
          workerRef.current = worker;
          setProgress({ stage: "parsing" });

          worker.onmessage = (event) => {
            const msg = event.data;
            if (msg.type === "PROGRESS") {
              setProgress(msg);
            } else if (msg.type === "RESULT") {
              setProgress({ stage: "done" });
              worker.terminate();
              workerRef.current = null;
              resolve(msg.data);
            } else if (msg.type === "ERROR") {
              worker.terminate();
              workerRef.current = null;
              reject(new Error(msg.message));
            }
          };

          worker.onerror = (err) => {
            worker.terminate();
            workerRef.current = null;
            reject(err);
          };

          worker.postMessage({
            type: "PROCESS",
            payload: { csvText, mappings, metricMappings, dimensionMappings, config }
          });
        } catch (err) {
          // Fallback: Worker creation failed, reject so caller can use main-thread
          reject(err);
        }
      });
    },
    []
  );

  const cancel = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setProgress({ stage: "idle" });
  }, []);

  return { processFile, progress, cancel };
}
