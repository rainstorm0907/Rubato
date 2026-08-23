// 벤더 패치가 **실제로 도는 사본**에 살아 있는지 본다.
//
// pi-tui 는 두 벌 깔린다. 루트의 것과 senpi 가 자기 안에 품은 것이고,
// 세션이 읽는 것은 후자다. 이 구분을 놓쳐서 "패치는 정확한데 화면은 원본"인
// 상태가 오래 갔다 — 검증이 패치된 사본을 직접 열어보고 통과했기 때문이다.
//
// 마커를 손으로 고르지 않는다. 패치를 역적용해서 pristine 이 나오고 그것을
// 다시 정적용했을 때 현재 바이트와 같으면, 그 파일은 패치된 상태다.
// 패치 내용이 바뀌어도 이 테스트는 따라온다.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { applyFilePatch, parseFilePatches } from "../postinstall.mjs";

const repoRoot = join(import.meta.dir, "..");
const senpiRoot = realpathSync(join(repoRoot, "node_modules", "@code-yeongyu", "senpi"));

const TARGETS = [
  { name: "senpi", root: senpiRoot, patch: "@code-yeongyu%2Fsenpi@2026.8.22.patch" },
  {
    name: "senpi 가 읽는 pi-tui",
    root: realpathSync(join(senpiRoot, "node_modules", "@earendil-works", "pi-tui")),
    patch: "@code-yeongyu%2Fsenpi-tui@2026.8.22.patch",
  },
];

for (const target of TARGETS) {
  describe(target.name, () => {
    const patchText = readFileSync(join(repoRoot, "patches", target.patch), "utf8");
    for (const filePatch of parseFilePatches(patchText, target.patch)) {
      test(`${filePatch.relativePath} 에 패치가 살아 있다`, () => {
        const targetPath = join(target.root, filePatch.relativePath);
        expect(existsSync(targetPath)).toBe(true);
        const patched = readFileSync(targetPath, "utf8");
        const pristine = applyFilePatch(patched, filePatch, target.patch, true);
        expect(pristine).not.toBe(false);
        expect(applyFilePatch(pristine as string, filePatch, target.patch)).toBe(patched);
      });
    }
  });
}
