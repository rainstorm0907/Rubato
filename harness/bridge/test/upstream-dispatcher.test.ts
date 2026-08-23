import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type Server } from "node:http";
import { closeUpstreamAgent, upstreamAgent, upstreamFetch } from "../src/upstream-dispatcher.ts";

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return address.port;
}

test("FX_UPSTREAM_CONNECTIONS rejects values that are not a usable pool size", async () => {
  await closeUpstreamAgent();
  for (const raw of ["0", "-1", "1.5", "abc", "999"]) {
    assert.throws(
      () => upstreamAgent({ FX_UPSTREAM_CONNECTIONS: raw } as NodeJS.ProcessEnv),
      /invalid FX_UPSTREAM_CONNECTIONS/,
      `expected ${raw} to be rejected`,
    );
  }
  await closeUpstreamAgent();
});

test("concurrent upstream requests do not queue behind one another", async () => {
  await closeUpstreamAgent();
  // 상대편을 느리게 만들어 두면, 요청이 직렬화될 때만 완료가 계단으로 밀린다.
  // 연결이 분리되어 있으면 넷이 거의 동시에 끝난다.
  const inFlight: number[] = [];
  let peak = 0;
  const upstream = createServer((_req, res) => {
    inFlight.push(1);
    peak = Math.max(peak, inFlight.length);
    setTimeout(() => {
      inFlight.pop();
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    }, 300);
  });
  const port = await listen(upstream);

  const started = Date.now();
  const results = await Promise.all(
    [1, 2, 3, 4].map(async () => {
      const response = await upstreamFetch(`http://127.0.0.1:${port}/`);
      await response.text();
      return Date.now() - started;
    }),
  );

  // 직렬화되면 마지막 요청이 1200ms 언저리가 된다. 병렬이면 300ms 대에 몰린다.
  assert.equal(peak, 4, `expected 4 concurrent upstream requests, saw ${peak}`);
  assert.ok(Math.max(...results) < 900, `slowest request was ${Math.max(...results)}ms`);

  await new Promise((resolve) => upstream.close(resolve));
  await closeUpstreamAgent();
});

test("aborting the caller signal cancels the upstream request", async () => {
  await closeUpstreamAgent();
  let sawAbort = false;
  const upstream = createServer((req, res) => {
    req.on("aborted", () => {
      sawAbort = true;
    });
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("data: partial\n\n");
    // 응답을 끝내지 않는다 — 취소가 도달해야만 닫힌다.
  });
  const port = await listen(upstream);

  const controller = new AbortController();
  const response = await upstreamFetch(`http://127.0.0.1:${port}/`, { signal: controller.signal });
  controller.abort();
  await assert.rejects(() => response.text());
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(sawAbort, true, "upstream never observed the abort");

  await new Promise((resolve) => upstream.close(resolve));
  await closeUpstreamAgent();
});

test("a stalled upstream body is cut instead of hanging forever", async () => {
  await closeUpstreamAgent();
  // 실제 상한은 2분이라 테스트에서 기다릴 수 없다. 여기서는 그 값이 유한하고
  // 비활성 구간에만 적용된다는 계약만 고정한다 — 0(무한)으로 되돌아가면 깨진다.
  const agent = upstreamAgent({} as NodeJS.ProcessEnv);
  const options = (agent as unknown as { [key: symbol]: Record<string, unknown> });
  const values = Object.getOwnPropertySymbols(options)
    .map((symbol) => options[symbol])
    .find((value) => value && typeof value === "object" && "bodyTimeout" in value);
  assert.ok(values, "could not read agent options");
  assert.ok(
    typeof values.bodyTimeout === "number" && values.bodyTimeout > 0,
    `bodyTimeout must stay finite and non-zero, got ${String(values.bodyTimeout)}`,
  );
  assert.equal(values.allowH2, false, "H2 must stay disabled while that is the mitigation");
  await closeUpstreamAgent();
});
