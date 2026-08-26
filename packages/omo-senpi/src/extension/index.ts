import { composeOmoSenpiExtension } from "./compose"
import { createOmoSenpiComponents } from "./component-list"
import { createTaskComponent } from "../components/task"

export const omoSenpiComponents = createOmoSenpiComponents(createTaskComponent())

export default composeOmoSenpiExtension(omoSenpiComponents)
export { composeOmoSenpiExtension }
export { createMemoryComponent } from "../components/memory"
export { loadSenpiOmoConfig } from "../components/config-resolution"
export type { ComponentContext, ComponentLogger, OmoSenpiComponent, SenpiExtensionAPI } from "./types"
