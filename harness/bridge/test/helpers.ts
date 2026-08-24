import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { parseSseBlock } from "../src/sse.ts";
import { bridgeState, type AdminSecret } from "../src/server.ts";

const here = dirname(fileURLToPath(import.meta.url));

export function fixture(name: string): string {
  return readFileSync(join(here, "fixtures", name), "utf8");
}

export function fixtureJson(name: string) {
  return JSON.parse(fixture(name));
}

export function collectFxEvents(frames: string[]) {
  const events = [];
  for (const frame of frames) {
    const parsed = parseSseBlock(frame.trimEnd());
    if (!parsed) continue;
    if (parsed.data === "[DONE]") {
      events.push({ type: "[DONE]" });
      continue;
    }
    events.push(JSON.parse(parsed.data));
  }
  return events;
}

export function sseToStream(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** Isolated admin secret so tests never write into ~/Library or XDG. */
export function isolatedAdminEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), "fx-bridge-admin-"));
  return {
    ...extra,
    FX_BRIDGE_ADMIN_SECRET: join(dir, "bridge.admin"),
  };
}

export async function waitForAdminSecret(server: Server, timeoutMs = 5_000): Promise<AdminSecret> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const admin = bridgeState(server).admin;
    if (admin) return admin;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("admin secret was not written");
}
