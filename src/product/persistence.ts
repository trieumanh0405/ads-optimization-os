import { EMPTY_WORKSPACE } from "./defaults";
import {
  factRowSchema,
  metricDefinitionSchema,
  optimizationRuleSchema,
  projectConfigSchema
} from "@/core/schemas";
import type { LocalProject, WorkspaceState, WorkspaceView } from "./types";

const DB_NAME = "ads-optimization-os";
const STORE_NAME = "workspace";
const STATE_KEY = "main";
const FALLBACK_KEY = "ads-optimization-os-workspace-v2";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function normalizeState(value: unknown): WorkspaceState {
  if (!value || typeof value !== "object") return structuredClone(EMPTY_WORKSPACE);
  const state = value as Partial<WorkspaceState>;
  if (!Array.isArray(state.projects)) return structuredClone(EMPTY_WORKSPACE);
  const projects = state.projects.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const source = candidate as Partial<LocalProject>;
    const config = projectConfigSchema.safeParse(source.config);
    const metricDefinitions = metricDefinitionSchema.array().safeParse(source.metricDefinitions);
    const rules = optimizationRuleSchema.array().safeParse(source.rules);
    const facts = factRowSchema.array().safeParse(source.facts);
    if (!config.success || !metricDefinitions.success || !rules.success || !facts.success) return [];
    return [{
      ...source,
      config: config.data,
      metricDefinitions: metricDefinitions.data,
      rules: rules.data,
      facts: facts.data,
      mappings: Array.isArray(source.mappings) ? source.mappings : [],
      metricMappings: Array.isArray(source.metricMappings) ? source.metricMappings : [],
      dimensionMappings: Array.isArray(source.dimensionMappings) ? source.dimensionMappings : [],
      imports: Array.isArray(source.imports) ? source.imports : [],
      runs: Array.isArray(source.runs) ? source.runs : [],
      actions: Array.isArray(source.actions) ? source.actions : [],
      actionLog: Array.isArray(source.actionLog) ? source.actionLog : [],
      createdAt: typeof source.createdAt === "string" ? source.createdAt : new Date().toISOString(),
      updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : new Date().toISOString()
    } as LocalProject];
  });
  const validViews: WorkspaceView[] = [
    "OVERVIEW", "OPERATIONS", "PROJECT_SETUP", "DATA_IMPORT", "RULES", "AI", "RUNS"
  ];
  // Decision board and Action queue were merged into one screen; a stored
  // workspace still pointing at either lands on the merged one.
  const legacyViews: Record<string, WorkspaceView> = { DECISIONS: "OPERATIONS", ACTIONS: "OPERATIONS" };
  const requestedView = legacyViews[state.activeView as string] ?? state.activeView;
  const activeProjectId = typeof state.activeProjectId === "string"
    && projects.some((project) => project.config.projectId === state.activeProjectId)
    ? state.activeProjectId
    : projects[0]?.config.projectId ?? null;
  const activeView = validViews.includes(requestedView as WorkspaceView)
    && (activeProjectId || requestedView === "OVERVIEW")
    ? requestedView as WorkspaceView
    : "OVERVIEW";
  return {
    ...structuredClone(EMPTY_WORKSPACE),
    ...state,
    version: 2,
    operatorName: typeof state.operatorName === "string" && state.operatorName.trim()
      ? state.operatorName
      : EMPTY_WORKSPACE.operatorName,
    activeProjectId,
    activeView,
    projects,
    providers: Array.isArray(state.providers) && state.providers.length
      ? state.providers
      : structuredClone(EMPTY_WORKSPACE.providers),
    selectedPlaybookIds: Array.isArray(state.selectedPlaybookIds)
      ? state.selectedPlaybookIds
      : structuredClone(EMPTY_WORKSPACE.selectedPlaybookIds),
    analyses: Array.isArray(state.analyses) ? state.analyses : []
  };
}

export async function loadWorkspace(): Promise<WorkspaceState> {
  try {
    const db = await openDatabase();
    const value = await new Promise<unknown>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(STATE_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (value) return normalizeState(value);
  } catch {
    const fallback = localStorage.getItem(FALLBACK_KEY);
    if (fallback) return normalizeState(JSON.parse(fallback));
  }
  return structuredClone(EMPTY_WORKSPACE);
}

export async function saveWorkspace(state: WorkspaceState): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(state, STATE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  } catch {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(state));
  }
}

export function exportWorkspace(state: WorkspaceState): string {
  return JSON.stringify({
    format: "ads-optimization-os-workspace",
    exportedAt: new Date().toISOString(),
    state
  }, null, 2);
}

export function importWorkspace(text: string): WorkspaceState {
  const parsed = JSON.parse(text) as { format?: string; state?: unknown };
  if (parsed.format !== "ads-optimization-os-workspace" || !parsed.state) {
    throw new Error("WORKSPACE_FILE_INVALID");
  }
  return normalizeState(parsed.state);
}
