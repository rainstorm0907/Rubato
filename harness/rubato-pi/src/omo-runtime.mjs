import { omoExtension, omoTaskExtension } from "./engine-paths.mjs";
import { loadRubatoPiOmoConfig, pinMemoryJobsToGrok } from "./omo-config.mjs";

const { createTaskComponent } = await import(omoTaskExtension);
const omoModule = await import(omoExtension);

export const rubatoPiTaskComponent = createTaskComponent({
  loadConfig: loadRubatoPiOmoConfig,
});

function loadMemoryConfig(options = {}) {
  const base = typeof omoModule.loadSenpiOmoConfig === "function"
    ? omoModule.loadSenpiOmoConfig(options)
    : loadRubatoPiOmoConfig(options);
  return pinMemoryJobsToGrok(base);
}

export const rubatoPiMemoryComponent = typeof omoModule.createMemoryComponent === "function"
  ? omoModule.createMemoryComponent({ loadConfig: loadMemoryConfig })
  : undefined;
