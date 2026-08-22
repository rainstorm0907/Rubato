const DEFAULT_BIND = "127.0.0.1";
const DEFAULT_PORT = 8788;
const DEFAULT_OPENCODEX = "http://127.0.0.1:10100";

export type CacheRetention = "none" | "short" | "long";
const CACHE_RETENTIONS: CacheRetention[] = ["none", "short", "long"];
const DEFAULT_CACHE_RETENTION: CacheRetention = "long";

export type BridgeConfig = {
  bind: string;
  port: number;
  opencodexBaseUrl: string;
  cacheRetention: CacheRetention;
};

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const bind = env.FX_BRIDGE_BIND ?? DEFAULT_BIND;
  if (!isLoopbackHost(bind)) {
    throw new Error(`fx-v3-bridge refuses non-loopback bind: ${bind}`);
  }
  const port = Number(env.FX_BRIDGE_PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 0) {
    throw new Error(`invalid FX_BRIDGE_PORT: ${env.FX_BRIDGE_PORT}`);
  }
  const opencodexBaseUrl = (env.OPENCODEX_BASE_URL ?? DEFAULT_OPENCODEX).replace(/\/$/, "");
  let parsed: URL;
  try {
    parsed = new URL(opencodexBaseUrl);
  } catch {
    throw new Error(`invalid OPENCODEX_BASE_URL: ${opencodexBaseUrl}`);
  }
  if (parsed.protocol !== "http:" || !isLoopbackHost(parsed.hostname)) {
    throw new Error(`OpenCodex URL must be loopback http: ${opencodexBaseUrl}`);
  }
  const cacheRetention = (env.FX_CACHE_RETENTION ?? DEFAULT_CACHE_RETENTION) as CacheRetention;
  if (!CACHE_RETENTIONS.includes(cacheRetention)) {
    throw new Error(`invalid FX_CACHE_RETENTION: ${env.FX_CACHE_RETENTION}`);
  }
  return { bind, port, opencodexBaseUrl, cacheRetention };
}
