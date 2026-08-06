import type { AppUser } from "../auth";
import { assertProjectAccess } from "./project-access";
import { getProjectBundle, saveProjectBundle } from "./project-repository";
import { storeNormalizedFacts, finalizeProjectImport } from "./fact-import-service";
import { runStoredProject } from "./engine-runner";
import { mappingsForGoogleSync, previewGoogleSheet } from "../google-sheets";
import { normalizeRows } from "@/core/normalize";
import { classifyFacts } from "@/core/scopes";

export async function syncGoogleSheetProject(input: { projectId: string; user: AppUser; runAfterSync?: boolean; force?: boolean }) {
  await assertProjectAccess(input.projectId, input.user, "import");
  const bundle = await getProjectBundle(input.projectId, input.user);
  const source = bundle.config.dataSource;
  if (source.kind !== "GOOGLE_SHEETS" || !source.spreadsheetId || !source.sheetName) {
    throw new Error("GOOGLE_SHEETS_SOURCE_NOT_CONFIGURED");
  }
  const lastSyncTime = source.lastSyncedAt ? Date.parse(source.lastSyncedAt) : Number.NaN;
  const minimumInterval = source.syncIntervalMinutes * 60_000;
  if (!input.force && source.lastSyncStatus !== "FAILED" && Number.isFinite(lastSyncTime) && Date.now() - lastSyncTime < minimumInterval) {
    return {
      syncedAt: source.lastSyncedAt!,
      status: source.lastSyncStatus === "PARTIAL" ? "PARTIAL" as const : "SUCCESS" as const,
      accepted: 0,
      rejected: 0,
      latestDataDate: null,
      importRecord: null,
      run: null,
      skipped: true
    };
  }
  const syncedAt = new Date().toISOString();
  try {
    const preview = await previewGoogleSheet({
      spreadsheetInput: source.spreadsheetId,
      sheetName: source.sheetName,
      headerRow: source.headerRow ?? 1
    });
    const syncMappings = mappingsForGoogleSync(bundle.mappings, syncedAt);
    const normalized = normalizeRows(preview.rows, {
      projectId: bundle.config.projectId,
      platform: bundle.config.platform,
      accountId: bundle.config.accountId,
      mappings: syncMappings,
      metricMappings: bundle.metricMappings,
      dimensionMappings: bundle.dimensionMappings
    });
    const classifiedFacts = classifyFacts(normalized.facts, bundle.config);
    for (let index = 0; index < classifiedFacts.length; index += 500) {
      await storeNormalizedFacts({ projectId: input.projectId, user: input.user, facts: classifiedFacts.slice(index, index + 500) });
    }
    const rejected = new Set(normalized.errors.map((item) => item.row)).size;
    const importRecord = await finalizeProjectImport({
      projectId: input.projectId,
      user: input.user,
      fileName: `Google Sheets sync · ${preview.spreadsheetTitle} / ${preview.sheetName}`,
      entityLevel: normalized.facts[0]?.entityLevel ?? "AD",
      accepted: classifiedFacts.length,
      rejected,
      mode: "PARTIAL",
      errorCodes: normalized.errors.map((item) => item.code)
    });
    const nextBundle = {
      ...bundle,
      config: {
        ...bundle.config,
        dataSource: {
          ...source,
          lastSyncedAt: syncedAt,
          lastSyncStatus: rejected ? "PARTIAL" as const : "SUCCESS" as const
        }
      }
    };
    await saveProjectBundle(input.user, nextBundle);
    const latestDataDate = classifiedFacts.reduce<string | null>((latest, fact) => !latest || fact.date > latest ? fact.date : latest, null);
    const shouldRun = input.runAfterSync ?? source.autoRunAfterSync;
    const run = shouldRun && latestDataDate
      ? await runStoredProject({ projectId: input.projectId, user: input.user, asOfDate: latestDataDate, runAt: syncedAt })
      : null;
    return {
      syncedAt,
      status: rejected ? "PARTIAL" as const : "SUCCESS" as const,
      accepted: classifiedFacts.length,
      rejected,
      latestDataDate,
      importRecord,
      run,
      skipped: false
    };
  } catch (error) {
    await saveProjectBundle(input.user, {
      ...bundle,
      config: {
        ...bundle.config,
        dataSource: { ...source, lastSyncedAt: syncedAt, lastSyncStatus: "FAILED" }
      }
    }).catch(() => undefined);
    throw error;
  }
}
