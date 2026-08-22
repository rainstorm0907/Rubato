// 엔진 파일 경로를 한 군데로 모은다.
//
// 예전에는 일곱 파일이 각자 `join(root, "node_modules/omo-ai/plugin/...")` 를 조립했다.
// 그 시절 rubato-pi 는 agent-taskforce 레포에 있었고 엔진을 npm 에서 받았다.
//
// 지금은 이 하네스가 포크(keepitmello/Rubato) 안에 있고, 엔진도 같은 레포에서 온다.
// `packages/omo-senpi/plugin/extensions/` 의 산출물이 그것이며, **component 를 골라
// 빼는 우리 변경이 반영된 유일한 판**이다. npm 의 `omo-ai` 는 upstream 원본이라
// 뺀 12개가 그대로 살아 있으므로 그쪽을 보면 오늘 한 일이 없던 것이 된다.
//
// senpi 엔진 본체는 다르다. 그것은 포크 루트가 워크스페이스로 이미 설치하므로
// 루트의 node_modules 를 쓴다. 우리가 고치지 않는 남의 코드다.
//
// 산출물이 없으면 세션이 뜨지 않는다. 그때는 포크 루트에서
// `node packages/omo-senpi/plugin/scripts/build-extension.mjs` 를 돌린다.
// (bun 1.4+ 필요 — 그 아래는 `--metafile` 이 없어 빌드가 죽는다.)
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** harness/rubato-pi */
export const rubatoPiRoot = join(here, "..");

/** 포크 루트 (harness/rubato-pi -> harness -> repo) */
export const forkRoot = join(rubatoPiRoot, "..", "..");

/** 우리가 빌드한 OMO 확장. component 선택이 반영된 판이다. */
export const enginePluginDir = join(forkRoot, "packages", "omo-senpi", "plugin");

export const omoExtension = join(enginePluginDir, "extensions", "omo.js");
export const omoTaskExtension = join(enginePluginDir, "extensions", "omo-task.js");
export const enginePackageJson = join(enginePluginDir, "package.json");

/** senpi 본체는 포크 루트가 워크스페이스로 설치한 것을 쓴다. */
export const senpiDir = join(forkRoot, "node_modules", "@code-yeongyu", "senpi");
export const senpiCli = join(senpiDir, "dist", "cli.js");
export const senpiPackageJson = join(senpiDir, "package.json");
export const senpiSkillsModule = join(senpiDir, "dist", "core", "skills.js");

/** 없으면 세션이 못 뜨므로, 부팅 실패를 사유와 함께 세운다. */
export function assertEngineBuilt() {
  if (existsSync(omoExtension)) return;
  throw new Error(
    `rubato-pi: 엔진 산출물이 없다 - ${omoExtension}\n` +
      `포크 루트에서 빌드해라: node packages/omo-senpi/plugin/scripts/build-extension.mjs (bun 1.4+)`,
  );
}
