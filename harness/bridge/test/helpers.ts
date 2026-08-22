import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSseBlock } from "../src/sse.ts";

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
