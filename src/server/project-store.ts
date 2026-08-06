// Backward-compatible barrel re-exports
// All callers importing from '@/server/project-store' will continue to work.
export { assertProjectAccess } from "./projects/project-access";
export { saveProjectBundle, listProjects, deleteStoredProject, getProjectBundle, getStoredProjectWorkspace, projectBundleSchema, type ProjectBundle } from "./projects/project-repository";
export { importProjectRows, storeNormalizedFacts, finalizeProjectImport } from "./projects/fact-import-service";
export { syncGoogleSheetProject } from "./projects/google-sync-service";
export { runStoredProject } from "./projects/engine-runner";
export { updateStoredAction, listStoredActions, listStoredRuns } from "./projects/action-service";
