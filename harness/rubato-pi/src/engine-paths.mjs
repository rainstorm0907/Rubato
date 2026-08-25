// 엔진 파일 경로를 한 군데로 모은다.
//
// 예전에는 일곱 파일이 각자 `join(root, "node_modules/omo-ai/plugin/...")` 를 조립했다.
// 그 시절 rubato-pi 는 agent-taskforce 레포에 있었고 엔진을 npm 에서 받았다.
//
// 지금은 이 하네스가 포크(keepitmello/Rubato) 안에 있고, 엔진도 같은 레포에서 온다.
// **component 를 골라 빼는 우리 변경이 반영된 유일한 판**이다. npm 의 `omo-ai` 는
// upstream 원본이라 뺀 12개가 그대로 살아 있으므로 그쪽을 보면 오늘 한 일이 없던
// 것이 된다.
//
// 그 산출물은 레포 **밖**에 있다. 레포 안의 `packages/omo-senpi/plugin/extensions/`
// 는 upstream 이 직접 커밋하는 원본이고, 거기에 우리 빌드를 덮으면 worktree 가
// 영구히 dirty 가 되어 업데이트가 막혔다(첫 줄 `// omo:<소스해시>` 가 소스 전체를
// 덮는데 rubato 는 세션마다 빌드를 돌린다). 보관용과 사용본을 갈랐다.
// 만드는 쪽은 harness/scripts/build-engine.mjs 다.
//
// senpi 엔진 본체는 다르다. 그것은 포크 루트가 워크스페이스로 이미 설치하므로
// 루트의 node_modules 를 쓴다. 우리가 고치지 않는 남의 코드다.
import { existsSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** harness/rubato-pi */
export const rubatoPiRoot = join(here, "..");

/** 포크 루트 (harness/rubato-pi -> harness -> repo) */
export const forkRoot = join(rubatoPiRoot, "..", "..");

function realUserHome() {
  try {
    return userInfo().homedir;
  } catch {
    return "";
  }
}

function pluginDirUnder(home) {
  return home ? join(home, ".rubato-pi", "engine", "plugin") : "";
}

function looksLikeEnginePluginDir(dir) {
  return Boolean(dir) && existsSync(join(dir, "package.json")) && existsSync(join(dir, "extensions", "omo.js"));
}

/**
 * HOME 이 테스트용 빈 디렉터리여도 실제 산출물을 찾는다.
 * `userInfo().homedir` 는 process.env.HOME 을 무시한다.
 */
export function resolveEnginePluginDir(env = process.env) {
  const pinned = env.RUBATO_ENGINE_DIR;
  if (looksLikeEnginePluginDir(pinned)) return pinned;
  const fromHome = pluginDirUnder(env.HOME ?? "");
  if (looksLikeEnginePluginDir(fromHome)) return fromHome;
  const fromReal = pluginDirUnder(realUserHome());
  if (looksLikeEnginePluginDir(fromReal)) return fromReal;
  return pinned || fromHome || fromReal;
}

/**
 * 우리가 빌드한 OMO 확장. component 선택이 반영된 판이다.
 * 레포 밖에 둔다 — 이유는 파일 첫머리 주석에 있다.
 */
export const enginePluginDir = resolveEnginePluginDir();

export const omoExtension = join(enginePluginDir, "extensions", "omo.js");
export const omoTaskExtension = join(enginePluginDir, "extensions", "omo-task.js");
export const enginePackageJson = join(enginePluginDir, "package.json");

/** senpi 본체는 포크 루트가 워크스페이스로 설치한 것을 쓴다. */
export const senpiDir = join(forkRoot, "node_modules", "@code-yeongyu", "senpi");
export const senpiCli = join(senpiDir, "dist", "cli.js");
export const senpiPackageJson = join(senpiDir, "package.json");
export const senpiSkillsModule = join(senpiDir, "dist", "core", "skills.js");
export const senpiSystemPromptModule = join(senpiDir, "dist", "core", "system-prompt.js");

/**
 * senpi 가 자기 node_modules 에 품고 있는 패키지. 워크스페이스 호이스팅 탓에
 * 로컬에 올라오기도 하므로 둘 다 본다 — 먼저 발견되는 쪽을 돌려준다.
 */
export function senpiNested(...segments) {
  const nested = join(senpiDir, "node_modules", ...segments);
  if (existsSync(nested)) return nested;
  return join(forkRoot, "node_modules", ...segments);
}

/** 없으면 세션이 못 뜨므로, 부팅 실패를 사유와 함께 세운다. */
export function assertEngineBuilt() {
  if (existsSync(omoExtension)) return;
  throw new Error(
    `rubato-pi: 엔진 산출물이 없다 - ${omoExtension}\n` +
      `포크 루트에서 빌드해라: node harness/scripts/build-engine.mjs (bun 1.4+)`,
  );
}
