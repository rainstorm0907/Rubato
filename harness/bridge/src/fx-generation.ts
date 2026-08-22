const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newGatewayGenerationId(now = Date.now(), entropy = randomBytes(16)): string {
  const time = encodeCrockford(BigInt(now), 10);
  const random = encodeBytes(entropy, 16);
  return `gen_${time}${random}`;
}

export function gatewayTimestamp(now = Date.now()): string {
  return new Date(now).toISOString();
}

export function emptyFxUsage(): { inputTokens: { total: number; noCache: number; cacheRead: number; cacheWrite: number }; outputTokens: { total: number } } {
  return {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0 },
  };
}

export function gatewayCost(usage: unknown): string {
  if (!isObject(usage)) return "0";
  const cost = isObject(usage.cost) ? usage.cost.total : usage.total_cost;
  if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) return String(cost);
  if (typeof cost === "string" && cost.trim()) return cost.trim();
  return "0";
}

export function gatewayProviderMetadata(args: {
  generationId: string;
  modelId: string;
  usage?: unknown;
}): { gateway: { generationId: string; cost: string; routing: { canonicalSlug: string } } } {
  return {
    gateway: {
      generationId: args.generationId,
      cost: gatewayCost(args.usage),
      routing: { canonicalSlug: args.modelId },
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function encodeCrockford(value: bigint, length: number): string {
  let remaining = value;
  let out = "";
  for (let i = 0; i < length; i++) {
    out = CROCKFORD[Number(remaining % 32n)] + out;
    remaining /= 32n;
  }
  return out;
}

function encodeBytes(bytes: Uint8Array, length: number): string {
  let remaining = 0n;
  for (const byte of bytes) remaining = (remaining << 8n) + BigInt(byte);
  return encodeCrockford(remaining, length);
}
