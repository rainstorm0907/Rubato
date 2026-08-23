// 패치한 TUI 를 senpi 가 실제로 읽는 자리에 맞춘다.
//
// `@earendil-works/pi-tui` 는 두 벌 깔린다. 루트의 것과, senpi 가 자기
// node_modules 안에 품은 것. **senpi 가 읽는 것은 후자다** — 호이스팅이 안 되기
// 때문이다. bun 의 patchedDependencies 는 전자만 고치므로, 패치를 아무리 정확히
// 떠도 화면에 도는 코드는 원본 그대로였다.
//
// 이것 때문에 슬래시 자동완성 수정이 세 번 연속으로 "고쳤는데 안 되는" 상태였다.
// 검증은 패치된 사본을 직접 import 해서 통과했고, 세션은 다른 파일을 읽었다.
//
// 그래서 세션이 뜰 때마다 둘을 맞춘다. 내용이 같으면 아무것도 하지 않으므로
// 평상시 비용은 파일 네 개를 읽는 정도다.
import { copyFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { forkRoot, senpiDir } from "./engine-paths.mjs";

/** 패치가 닿아야 하는 파일. 늘어나면 여기에 적는다. */
const PATCHED_FILES = Object.freeze([
  "autocomplete.js",
  "dollar-invocation-autocomplete.js",
  "slash-command-autocomplete.js",
  join("components", "editor.js"),
]);

// bun 이 패치를 적용해 주는 자리.
//
// `@earendil-works/pi-tui` 는 `npm:@code-yeongyu/senpi-tui` 별칭으로 깔린다.
// 그래서 패치가 실제로 적용된 실체는 별칭 **원래 이름** 아래에 있고, 루트의
// `@earendil-works/pi-tui` 경로에는 없다. senpiNested 도 중첩 사본을 먼저
// 찾으므로 소스로 쓸 수 없다 — 원본을 원본에 복사하게 된다.
function patchedTuiDir() {
  const store = join(forkRoot, "node_modules", ".bun");
  if (!existsSync(store)) return "";
  // 버전을 박지 않는다. 업그레이드하면 디렉토리 이름이 바뀌고,
  // 박아 두면 그때부터 조용히 원본으로 돌아간다.
  const entry = readdirSync(store).find((name) => name.startsWith("@code-yeongyu+senpi-tui@"));
  if (!entry) return "";
  return join(store, entry, "node_modules", "@code-yeongyu", "senpi-tui", "dist");
}

/** senpi 가 실제로 읽는 자리(중첩 사본). */
function liveTuiDir() {
  return join(senpiDir, "node_modules", "@earendil-works", "pi-tui", "dist");
}

/**
 * 두 자리를 맞춘다. 중첩 사본이 없으면(호이스팅이 된 배치라면) 할 일이 없다.
 * 반환값은 실제로 덮어쓴 파일 목록 — 조용히 지나가는 것이 정상이다.
 */
export function syncTuiPatch({ from = patchedTuiDir(), to = liveTuiDir() } = {}) {
  if (!from || from === to || !existsSync(to) || !existsSync(from)) return [];
  const copied = [];
  for (const rel of PATCHED_FILES) {
    const src = join(from, rel);
    const dst = join(to, rel);
    if (!existsSync(src) || !existsSync(dst)) continue;
    try {
      if (readFileSync(src, "utf8") === readFileSync(dst, "utf8")) continue;
      copyFileSync(src, dst);
      copied.push(rel);
    } catch {
      // 맞추지 못해도 세션은 떠야 한다. 원본으로 도는 것이 안 뜨는 것보다 낫다.
    }
  }
  return copied;
}
