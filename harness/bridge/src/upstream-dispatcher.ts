import { Agent, fetch as undiciFetch } from "undici";

// 모델 호출은 한 브리지에 세션 여러 개가 물린 채로 나간다. Node 내장 fetch 를
// 그대로 쓰면 첫 라운드가 끝난 뒤 살아남은 연결 하나로 요청이 모이고, 그
// 연결 안에서 요청이 한 줄로 선다 — 세션 6개 기준 뒤쪽 요청이 3초에서
// 30초로 밀렸다. 계단은 연결이 4개에서 1개로 줄어드는 순간부터 시작한다.
//
// 그래서 업스트림 전용 Agent 를 둔다. `connections` 로 동시 연결을 확보하고,
// `allowH2: false` 로 한 연결에 스트림을 몰아넣지 못하게 한다. HTTP/1.1 은
// 연결당 요청이 하나라 요청이 저절로 흩어진다. `Connection: close` 헤더로도
// 시도해 봤지만 HTTP/2 에서는 무시되어 계단이 그대로 남았다.
const DEFAULT_CONNECTIONS = 16;

function poolSize(env: NodeJS.ProcessEnv): number {
  const raw = env.FX_UPSTREAM_CONNECTIONS;
  if (raw === undefined) return DEFAULT_CONNECTIONS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`invalid FX_UPSTREAM_CONNECTIONS: ${raw}`);
  }
  return parsed;
}

let agent: Agent | undefined;

export function upstreamAgent(env: NodeJS.ProcessEnv = process.env): Agent {
  if (!agent) {
    agent = new Agent({
      connections: poolSize(env),
      allowH2: false,
      pipelining: 0,
      // 모델 응답은 첫 토큰까지 수십 초가 걸릴 수 있고 스트림은 그보다 오래
      // 열려 있다. undici 기본값(300초 헤더 / 300초 본문)은 긴 turn 을
      // 중간에 끊으므로 본문 타임아웃을 없앤다.
      headersTimeout: 600_000,
      bodyTimeout: 0,
    });
  }
  return agent;
}

/** pi-ai 가 SDK 로 넘겨 주는 fetch. 업스트림 호출만 전용 Agent 를 타게 한다. */
export const upstreamFetch: typeof globalThis.fetch = ((
  input: Parameters<typeof undiciFetch>[0],
  init?: Parameters<typeof undiciFetch>[1],
) => undiciFetch(input, { ...init, dispatcher: upstreamAgent() })) as unknown as typeof globalThis.fetch;
