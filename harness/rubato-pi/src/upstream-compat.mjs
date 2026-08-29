/**
 * upstream package 가 실제로 읽는 `OMO_*` 값을 다루는 **유일한** 자리.
 *
 * 목적은 이 이름들을 보존하는 것이 아니라 **걷어내는 것**이다. cutover manifest 가 한 파일로
 * 모으라고 한 이유도 그것이다: 한곳에 모이면 무엇이 아직 필요한지 세어볼 수 있고, 필요가
 * 사라진 이름은 지울 수 있다. 흩어져 있으면 죽은 이름이 살아 있는 것처럼 보인다.
 *
 * 여기 이름을 더하려면 **그 값을 읽는 코드의 경로**를 주석에 적는다. 읽는 자리를 못 찾으면
 * 그 이름은 죽은 값이고, 여기 두는 대신 지운다. (실제로 `OMO_DISABLE_POSTHOG` 와
 * `OMO_SENPI_DISABLE_POSTHOG` 가 그랬다 — 아무도 읽지 않았다. telemetry 를 끄는 값은
 * `packages/telemetry-core/src/env.ts:39` 가 읽는 `DO_NOT_TRACK` 이고, 그건 upstream 이름이
 * 아니라 범용 관례라 `brand.mjs` 가 자기 정책으로 직접 넣는다.)
 */

/**
 * 물려받으면 자식이 upstream 런처로 오인하는 값.
 *
 * `packages/omo-native/bin/lib/launcher.js:70,86` 이 **넣는** 값이다. omo-native 런처를
 * 지나 들어온 프로세스에만 붙는다. Rubato 는 pinned Senpi CLI 를 직접 실행하므로 이 값이
 * 남아 있으면 자식이 우리가 고정하지 않은 바이너리를 가리킨다. upstream 이 요구하는 값이
 * 아니라 물려받은 오염이고, 그래서 하는 일은 **지우는 것**뿐이다.
 */
const INHERITED_UPSTREAM_NAMES = Object.freeze(["OMO_NATIVE", "OMO_BIN"]);

/**
 * 물려받으면 안 되는 upstream 런처 이름.
 *
 * 시험이 이 리터럴을 다시 적지 않게 내보낸다. 두 곳에 적으면 소유자가 둘이 되고, 이름이
 * 바뀔 때 한쪽만 고쳐진다.
 */
export function inheritedUpstreamNames() {
  return [...INHERITED_UPSTREAM_NAMES];
}

/**
 * 격리 agent 에게 넘길 extension 목록을 upstream memory 층이 읽는 이름.
 *
 * `packages/omo-senpi/src/components/memory/worker/child-extensions.ts:26` 이 읽는다. 그
 * 파일은 upstream provenance 허용목록 안이라 이름을 우리가 바꿀 수 없다. 여기 남는 유일한
 * 이유가 그것이고, 그 reader 가 사라지면 이 이름도 같이 지운다.
 */
export const UPSTREAM_CHILD_EXTENSIONS_ENV = "OMO_MEMORY_CHILD_EXTENSIONS";

/**
 * 자식 env 에서 물려받은 upstream 런처 값을 지운다. 제자리에서 지운다.
 */
export function stripInheritedUpstream(env) {
  for (const name of INHERITED_UPSTREAM_NAMES) delete env[name];
  return env;
}

/** 격리 agent 가 물려받을 extension 경로를 upstream 이 읽는 이름으로 싣는다. */
export function applyUpstreamChildExtensions(env, paths, delimiter) {
  env[UPSTREAM_CHILD_EXTENSIONS_ENV] = paths.join(delimiter);
  return env;
}
