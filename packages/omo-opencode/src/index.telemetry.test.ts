import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { createPluginModule, type PluginModuleDeps } from "./testing/create-plugin-module"
import * as posthogModule from "./shared/posthog"

const mockInitConfigContext = mock(() => {})
const mockInjectServerAuthIntoClient = mock(() => {})
const mockLogLegacyPluginStartupWarning = mock(() => {})
const mockMigrateLegacyWorkspaceDirectory = mock(() => ({ migrated: false, skipped: [] }))
const mockRunOpenCodeStartupMigration = mock(() => ({
  journalResumed: false,
  migratedFrom: [],
  reloadRequired: false,
  results: [],
  skippedConflictCount: 0,
}))
const mockLoadPluginConfig = mock(() => ({}))
const mockLoadConfigChain = mock((directory: string) => ({
  config: mockLoadPluginConfig(directory, {}),
  messages: [],
  path: null,
  valid: true,
}))
const mockIsTmuxIntegrationEnabled = mock(() => false)
const mockCreateRuntimeTmuxConfig = mock(() => ({
  enabled: false,
  layout: "tiled" as const,
  main_pane_size: 60,
  main_pane_min_width: 80,
  agent_pane_min_width: 40,
  isolation: "inline" as const,
}))
const mockCreateManagers = mock(() => ({
  backgroundManager: { shutdown: async () => {} },
  skillMcpManager: { disconnectAll: async () => {} },
  configHandler: async () => {},
}))
const mockCreateTools = mock(async () => ({
  mergedSkills: [],
  availableSkills: [],
  filteredTools: {},
}))
const mockCreateHooks = mock(() => ({
  disposeHooks: () => {},
  compactionContextInjector: undefined,
  compactionTodoPreserver: undefined,
  claudeCodeHooks: undefined,
}))
const mockCreatePluginInterface = mock(() => ({}))
const mockLog = mock(() => {})

function clearTelemetryEnv(): void {
  delete process.env.OMO_DISABLE_POSTHOG
  delete process.env.OMO_SEND_ANONYMOUS_TELEMETRY
  delete process.env.POSTHOG_API_KEY
}

function createTestPluginModule(overrides: Partial<PluginModuleDeps> = {}): ReturnType<typeof createPluginModule> {
  return createPluginModule({
    initConfigContext: mockInitConfigContext,
    injectServerAuthIntoClient: mockInjectServerAuthIntoClient,
    logLegacyPluginStartupWarning: mockLogLegacyPluginStartupWarning,
    migrateLegacyWorkspaceDirectory: mockMigrateLegacyWorkspaceDirectory,
    runOpenCodeStartupMigration: mockRunOpenCodeStartupMigration,
    loadConfigChain: mockLoadConfigChain as never,
    loadPluginConfig: mockLoadPluginConfig as never,
    isTmuxIntegrationEnabled: mockIsTmuxIntegrationEnabled as never,
    createRuntimeTmuxConfig: mockCreateRuntimeTmuxConfig as never,
    createManagers: mockCreateManagers as never,
    createTools: mockCreateTools as never,
    createHooks: mockCreateHooks as never,
    createPluginInterface: mockCreatePluginInterface as never,
    log: mockLog,
    detectDuplicateOmoPlugin: mock(() => ({
      detected: false,
      pluginName: null,
      duplicatePlugins: [],
      allPlugins: [],
    })),
    getDuplicateOmoPluginWarning: mock(() => ""),
    detectExternalSkillPlugin: mock(() => ({ detected: false, pluginName: null })),
    getSkillPluginConflictWarning: mock(() => ""),
    initializeOpenClaw: mock(async () => {}),
    startTmuxCheck: mock(() => {}),
    createModelCacheState: mock(() => ({})) as never,
    createFirstMessageVariantGate: mock(() => ({
      shouldOverride: () => false,
      markApplied: () => {},
      markSessionCreated: () => {},
      clear: () => {},
    })) as never,
    installAgentSortShim: mock(() => {}),
    setAgentSortOrder: mock(() => {}),
    ...overrides,
  })
}

describe("oh-my-openagent telemetry isolation", () => {
  beforeEach(() => {
    clearTelemetryEnv()
    posthogModule.__resetActivityStateProviderForTesting()
    posthogModule.__resetOsProviderForTesting()
    posthogModule.__resetTransportFactoryForTesting()
    mockInitConfigContext.mockClear()
    mockInjectServerAuthIntoClient.mockClear()
    mockLogLegacyPluginStartupWarning.mockClear()
    mockMigrateLegacyWorkspaceDirectory.mockClear()
    mockLoadPluginConfig.mockClear()
    mockIsTmuxIntegrationEnabled.mockClear()
    mockCreateRuntimeTmuxConfig.mockClear()
    mockCreateManagers.mockClear()
    mockCreateTools.mockClear()
    mockCreateHooks.mockClear()
    mockCreatePluginInterface.mockClear()
    mockLog.mockClear()
  })

  afterEach(() => {
    clearTelemetryEnv()
    posthogModule.__resetActivityStateProviderForTesting()
    posthogModule.__resetOsProviderForTesting()
    posthogModule.__resetTransportFactoryForTesting()
  })

  it("does not crash plugin load when telemetry throws", async () => {
    // given
    const plugin = createTestPluginModule({
      recordPluginTelemetry: mock(() => {
        throw new Error("telemetry failed")
      }),
    })

    // when
    const result = await plugin.server({
      directory: "/tmp/project",
      client: {},
    } as Parameters<typeof plugin.server>[0])

    // then
    expect(typeof result).toBe("object")
    expect(result).not.toBeNull()
  })

  it("passes config telemetry into plugin telemetry after config loads", async () => {
    // given
    mockLoadPluginConfig.mockImplementationOnce(() => ({ telemetry: false }))
    const recordPluginTelemetry = mock(() => {})
    const plugin = createTestPluginModule({ recordPluginTelemetry })

    // when
    await plugin.server({
      directory: "/tmp/project",
      client: {},
    } as Parameters<typeof plugin.server>[0])

    // then
    expect(recordPluginTelemetry).toHaveBeenCalledWith({ configEnabled: false })
  })
})
