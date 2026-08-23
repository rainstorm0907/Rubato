type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function providerPrefix(id: string, ownedBy?: string): string {
  if (id.includes("/")) return id;
  const owner = ownedBy && ownedBy !== "unknown" ? ownedBy : "openai";
  return `${owner}/${id}`;
}

function reasoningValues(model: JsonObject): string[] {
  const efforts = model.reasoning_efforts;
  if (!Array.isArray(efforts)) return [];
  const values: string[] = [];
  for (const effort of efforts) {
    if (typeof effort === "string") values.push(effort);
    else if (isObject(effort) && typeof effort.value === "string") values.push(effort.value);
  }
  return values;
}

export function opencodexModelsToFxCatalog(payload: unknown): { object: "list"; data: JsonObject[] } {
  const models = isObject(payload) && Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload)
      ? payload
      : [];

  const data: JsonObject[] = [];
  for (const model of models) {
    if (!isObject(model)) continue;
    const rawId = asString(model.id);
    if (!rawId) continue;
    const ownedBy = asString(model.owned_by);
    const id = providerPrefix(rawId, ownedBy);
    const tags = ["tool-use"];
    const efforts = reasoningValues(model);
    if (efforts.length > 0 || model.supports_reasoning_effort === true) tags.push("reasoning");
    const entry: JsonObject = {
      id,
      type: "language",
      owned_by: ownedBy ?? (id.includes("/") ? id.split("/")[0] : "openai"),
      tags,
    };
    if (efforts.length > 0) {
      entry.reasoning_options = [
        {
          type: "effort",
          values: efforts,
        },
      ];
    }
    if (typeof model.context_window === "number") entry.context_window = model.context_window;
    data.push(entry);
  }

  return { object: "list", data };
}

/** Rubato owns OpenAI through the direct Codex OAuth lane, never OpenCodex. */
export function removeDirectProviderModels(proxied: JsonObject[]): JsonObject[] {
  return proxied.filter((entry) => {
    const id = asString(entry.id);
    return id && !id.startsWith("openai/") && !id.startsWith("xai/") && !id.startsWith("anthropic/");
  });
}
