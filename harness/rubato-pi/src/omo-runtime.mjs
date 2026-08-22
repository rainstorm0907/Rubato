import { omoTaskExtension } from "./engine-paths.mjs";
import { loadRubatoPiOmoConfig } from "./omo-config.mjs";

const omoTask = omoTaskExtension;
const { createTaskComponent } = await import(omoTask);

export const rubatoPiTaskComponent = createTaskComponent({
  loadConfig: loadRubatoPiOmoConfig,
});
