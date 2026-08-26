import { assertEngineBuilt, omoExtension } from "../engine-paths.mjs";
import { rubatoPiMemoryComponent, rubatoPiTaskComponent } from "../omo-runtime.mjs";
import { ON_COMPONENTS } from "../policy.mjs";

assertEngineBuilt();
const { composeOmoSenpiExtension, omoSenpiComponents } = await import(omoExtension);

const ON = new Set(ON_COMPONENTS);

const replaceMemory = rubatoPiMemoryComponent !== undefined;
export default composeOmoSenpiExtension([
  ...omoSenpiComponents.filter((component) => ON.has(component.name) && component.name !== "task" && (!replaceMemory || component.name !== "memory")),
  rubatoPiTaskComponent,
  ...(replaceMemory ? [rubatoPiMemoryComponent] : []),
]);
