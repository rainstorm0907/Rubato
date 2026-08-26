import { createOmoSenpiComponents } from "./component-list"
import { composeOmoSenpiExtension } from "./compose"
import type { OmoSenpiComponent } from "./types"

const lazyTaskComponent: OmoSenpiComponent = {
  name: "task",
  async register(pi, ctx) {
    const taskModule = await import("#omo-task-runtime")
    await taskModule.createTaskComponent().register(pi, ctx)
  },
}

export const omoSenpiComponents = createOmoSenpiComponents(lazyTaskComponent)

export default composeOmoSenpiExtension(omoSenpiComponents)
export { composeOmoSenpiExtension }
export { createMemoryComponent } from "../components/memory"
export { loadSenpiOmoConfig } from "../components/config-resolution"
export type { ComponentContext, ComponentLogger, OmoSenpiComponent, SenpiExtensionAPI } from "./types"
