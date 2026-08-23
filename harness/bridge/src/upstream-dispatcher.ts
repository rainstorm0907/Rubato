import { Agent, fetch as undiciFetch } from "undici";

// 모델 호출은 한 브리지에 세션 여러 개가 물린 채로 나간다. Node 내장 fetch 를
// 그대로 쓰면 첫 라운드가 끝난 뒤 살아남은 연결 하나로 요청이 모이고, 그
// 연결 안에서 요청이 한 줄로 선다 — 동시 4개를 라운드로 반복하면 3/9/13/16초로
// 계단이 서고, 소켓이 4개에서 1개로 줄어드는 시점과 계단 시작이 겹친다.
//
// 그래서 업스트림 전용 Agent 를 둔다. `connections` 로 동시 연결을 확보하고,
// `allowH2: false` 로 한 연결에 스트림이 몰리지 못하게 한다. HTTP/1.1 은
// 연결당 요청이 하나라 요청이 저절로 흩어진다. `Connection: close` 헤더로도
// 시도했지만 HTTP/2 에서는 무시되어 계단이 남았다.
//
// 다만 이것이 원인을 고친 것인지는 아직 모른다. 증거는 "연결 재사용에 기대는
// 병리"까지만 보여 준다 — 상대편의 연결당 동시 스트림 제한인지, undici 의
// H2 스케줄링인지, 로드밸런서가 한 연결을 직렬 백엔드에 붙이는 것인지는
// 가르지 못했다. 연결을 쪼개서 증상을 피한 것일 수 있다.
const DEFAULT_CONNECTIONS = 16;
// 한 오리진에 이보다 많은 소켓을 여는 것은 설정 실수로 본다.
const MAX_CONNECTIONS = 128;

// 모델 응답은 첫 토큰까지 수십 초가 걸린다. 관측된 병리가 74~176초였으므로
// 그보다는 넉넉해야 정상 요청을 자르지 않는다.
const HEADERS_TIMEOUT_MS = 600_000;
// undici 의 body timeout 은 스트림 전체 길이가 아니라 **청크 사이 간격**이다.
// 토큰이 흐르는 동안에는 간격이 짧으므로 긴 turn 도 이 값에 걸리지 않고,
// 정말 멈춘 스트림만 끊긴다. 0(무한)으로 두면 죽은 업스트림이 소켓과 요청을
// 영영 붙들 수 있어 — 지연을 고치겠다면서 무한 대기를 여는 셈이다.
const BODY_INACTIVITY_TIMEOUT_MS = 120_000;

function poolSize(env: NodeJS.ProcessEnv): number {
  const raw = env.FX_UPSTREAM_CONNECTIONS;
  if (raw === undefined) return DEFAULT_CONNECTIONS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_CONNECTIONS) {
    throw new Error(`invalid FX_UPSTREAM_CONNECTIONS: ${raw} (1..${MAX_CONNECTIONS})`);
  }
  return parsed;
}

let agent: Agent | undefined;

export function upstreamAgent(env: NodeJS.ProcessEnv = process.env): Agent {
  if (!agent) {
    agent = new Agent({
      // undici 는 오리진별로 풀을 잡으므로 이 수는 프로바이더마다 따로 적용된다.
      // 느린 xAI 가 Anthropic 의 몫을 잡아먹지 않는다.
      connections: poolSize(env),
      allowH2: false,
      pipelining: 0,
      headersTimeout: HEADERS_TIMEOUT_MS,
      bodyTimeout: BODY_INACTIVITY_TIMEOUT_MS,
    });
  }
  return agent;
}

/**
 * 열린 업스트림 연결을 모두 닫는다. 프로세스 수명과 함께 사는 브리지에서는
 * 필요 없지만, 테스트와 재기동은 서버를 닫은 뒤 이 Agent 도 회수해야 한다.
 */
export async function closeUpstreamAgent(): Promise<void> {
  const current = agent;
  agent = undefined;
  await current?.close();
}

/**
 * pi-ai 가 SDK 로 넘겨 주는 fetch. 업스트림 호출만 전용 Agent 를 타게 한다.
 *
 * undici 의 fetch 타입은 WHATWG `fetch` 와 브랜드가 달라 그대로는 대입되지
 * 않는다. 넓은 이중 캐스트로 덮는 대신 실제로 오가는 값만 좁게 맞춘다 —
 * 입력은 URL/문자열 또는 `Request`, 나머지 init 는 `signal` 을 포함해 그대로
 * 통과시킨다.
 */
async function upstreamFetchImpl(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const dispatcher = upstreamAgent();
  // pi-ai 와 OpenAI SDK 는 URL/문자열 + 평범한 init 로 부른다. 그래도 표준
  // fetch 계약에는 Request 입력이 들어 있으므로 그 경우도 열어 둔다.
  if (typeof Request !== "undefined" && input instanceof Request) {
    const body = init?.body ?? (input.body ? await input.arrayBuffer() : undefined);
    return (await undiciFetch(input.url, {
      method: input.method,
      headers: init?.headers ?? (Object.fromEntries(input.headers) as Record<string, string>),
      ...(body === undefined ? {} : { body: body as never }),
      signal: init?.signal ?? input.signal,
      dispatcher,
    } as never)) as unknown as Response;
  }
  return (await undiciFetch(input as never, { ...init, dispatcher } as never)) as unknown as Response;
}

export const upstreamFetch: typeof globalThis.fetch = upstreamFetchImpl;
