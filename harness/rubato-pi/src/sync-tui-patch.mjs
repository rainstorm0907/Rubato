// 벤더 패치 중 postinstall 이 아직 소유하지 않은 자리를 세션 시작 때 맞춘다.
//
// 예전에는 여기에 pi-tui 동기화(`syncTuiPatch`)가 같이 있었다. bun 의
// patchedDependencies 가 루트 사본만 고치던 시절, senpi 가 읽는 중첩 사본에
// 패치를 나르는 유일한 길이었기 때문이다. **그 함수는 걷어냈다** — 두 가지가
// 바뀌었다:
//
//   1. patchedDependencies 를 떼면서 소스로 삼던 `.bun/@code-yeongyu+senpi-tui@*`
//      가 *패치된 사본*에서 *원본*으로 바뀌었다. 그래서 그 복사는 패치를 나르는
//      대신 **원본으로 라이브를 덮어써 postinstall 의 작업을 되돌렸다.** 실측:
//      소스의 autocomplete.js 에는 inlineSlashTokenAt 이 0건, 라이브에는 2건이었고
//      두 파일은 서로 달랐다. 예외를 삼키는 구조라 완전히 조용했다.
//   2. `postinstall.mjs` 의 VENDOR_PATCHES 가 realpath 로 중첩 사본을 직접
//      타겟한다. 우회로가 필요했던 이유 자체가 없어졌다.
//
// 여기 남은 것은 그 다음 문제다. 긴 세션 렌더 최적화는 정의(progressive-transcript-
// container.js)만 정식 패치에 있고 호출부(interactive-mode.js 의 markSettled)는
// 아직 패치에 없다. 그 배선을 여기서 잇는다.
//
// **이 배선은 임시다. 정식 패치로 승격되어야 하고, 그때 이 함수는 사라진다.**
// 지금 모양이 위에서 걷어낸 함정과 똑같기 때문이다:
//
//   - 같은 파일(progressive-transcript-container.js)을 정식 패치와 patch-src 사본
//     두 경로가 쓴다. 둘이 갈라지면 세션 시작 때 사본이 이긴다 — syncTuiPatch 가
//     원본으로 라이브를 덮던 것과 같은 구조다.
//   - markSettled 호출부는 정식 패치에 없다. 그래서 postinstall 직후부터 첫 세션이
//     뜨기 전까지는 배선이 아예 없고, patch-tests/vendor-patch-live.test.ts 는
//     패치에 있는 것만 보므로 그 공백을 잡지 못한다.
//
// 승격은 이 기능을 만든 쪽의 관할이다. 여기서는 기록만 남긴다.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { forkRoot, senpiDir } from "./engine-paths.mjs";

/** Senpi 자체에서 실제 대화 히스토리를 그리는 패치. */
const PATCHED_SENPI_FILES = Object.freeze([
  join("dist", "modes", "interactive", "components", "progressive-transcript-container.js"),
]);
const SETTLE_ANCHOR = "                this.clearPendingTools();\n                this.ui.requestRender();";
const SETTLE_PATCH = "                this.clearPendingTools();\n                this.chatContainer.markSettled();\n                this.ui.requestRender();";

/** 긴 세션 최적화는 pi-tui가 아니라 Senpi transcript 컨테이너가 소유한다. */
export function syncSenpiTranscriptPatch({
  from = join(forkRoot, "harness", "patch-src", "progressive-transcript-container.js"),
  toRoot = senpiDir,
} = {}) {
  if (!existsSync(from) || !existsSync(toRoot)) return [];
  const copied = [];
  for (const rel of PATCHED_SENPI_FILES) {
    const dst = join(toRoot, rel);
    if (!existsSync(dst)) continue;
    try {
      const source = readFileSync(from, "utf8");
      if (source === readFileSync(dst, "utf8")) continue;
      copyFileSync(from, dst);
      copied.push(rel);
    } catch {
      // 렌더 최적화 실패가 세션 시작 자체를 막아서는 안 된다.
    }
  }
  const interactive = join(toRoot, "dist", "modes", "interactive", "interactive-mode.js");
  try {
    const source = readFileSync(interactive, "utf8");
    if (!source.includes("this.chatContainer.markSettled();") && source.includes(SETTLE_ANCHOR)) {
      writeFileSync(interactive, source.replace(SETTLE_ANCHOR, SETTLE_PATCH));
      copied.push(join("dist", "modes", "interactive", "interactive-mode.js"));
    }
  } catch {
    // 위와 같은 best-effort 경계다.
  }
  return copied;
}
