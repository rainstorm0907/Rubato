import { describe, expect, test } from "bun:test"

import { createTaskChildPlanner } from "../../../../packages/omo-senpi/src/components/task/planner"
import { FALLBACK_CATALOG } from "../../src/broker.mjs"
import { brokerProviders } from "../../src/extensions/broker-overlay.mjs"

describe("picker and task model catalog parity", () => {
  test("every broker model visible to the picker can override a task category", () => {
    const catalog = [
      ...FALLBACK_CATALOG,
      { id: "google-antigravity/gemini-3.1-pro", name: "Gemini 3.1 Pro" },
      { id: "google-antigravity/gemini-3.7-flash", name: "Gemini 3.7 Flash" },
      { id: "cursor/composer-2.5", name: "Composer 2.5" },
    ]
    const models = brokerProviders(catalog).flatMap((provider) => provider.getModels())
    const registry = {
      getAvailable: () => models,
      find: (provider: string, modelId: string) =>
        models.find((model) => model.provider === provider && model.id === modelId),
    }
    const planner = createTaskChildPlanner(
      { categories: { sol: { model: "openai-codex/gpt-5.6-sol" } } },
      {},
      () => registry,
    )

    for (const model of models) {
      const id = `${model.provider}/${model.id}`
      const result = planner({
        prompt: "Use the selected model.",
        parent_session_id: "parent-1",
        depth: 0,
        category: "sol",
        model: id,
      })
      expect(result.kind, id).toBe("resolved")
      if (result.kind !== "resolved") continue
      expect(result.plan.model).toBe(id)
      expect(result.plan.category).toBe("sol")
      expect(result.plan.resolved_model?.source).toBe("explicit")
    }
  })
})
