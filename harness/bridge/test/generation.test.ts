import assert from "node:assert/strict";
import test from "node:test";
import { gatewayCost, gatewayProviderMetadata, gatewayTimestamp, newGatewayGenerationId } from "../src/fx-generation.ts";

const GATEWAY_ID = /^gen_[0-9A-HJKMNP-TV-Z]{26}$/;

test("gateway generation ids match the fx ULID contract", () => {
  const id = newGatewayGenerationId(1_787_179_545_919, Uint8Array.from({ length: 16 }, (_, i) => i + 1));
  assert.equal(id.length, 30);
  assert.match(id, GATEWAY_ID);
  assert.equal(newGatewayGenerationId(1_787_179_545_919, Uint8Array.from({ length: 16 }, (_, i) => i + 1)), id);
});

test("terminal metadata carries generation id, cost, and canonical slug", () => {
  const generationId = newGatewayGenerationId();
  assert.deepEqual(gatewayProviderMetadata({
    generationId,
    modelId: "xai/grok-4.6",
    usage: { cost: { total: 0.0123 } },
  }), {
    gateway: {
      generationId,
      cost: "0.0123",
      routing: { canonicalSlug: "xai/grok-4.6" },
    },
  });
  assert.equal(gatewayCost({ cost: { total: 0 } }), "0");
  assert.match(gatewayTimestamp(Date.UTC(2026, 6, 29, 3, 31, 7)), /^2026-07-29T03:31:07(\.000)?Z$/);
});
