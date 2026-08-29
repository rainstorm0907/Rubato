// postinstall.mjs
// Runs after npm install to verify platform binary is available

import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyPatch, parsePatch } from "diff";
import {
  getPlatformPackageCandidates,
  getBinaryPath,
  resolvePlatformPackageBaseName,
} from "./bin/platform.js";
import { detectPlatformBinaryMismatch } from "./bin/version-mismatch.js";

const require = createRequire(import.meta.url);
const rootDir = dirname(fileURLToPath(import.meta.url));

const MIN_OPENCODE_VERSION = "1.4.0";
const OPENCODE_PLUGIN_PACKAGES = ["oh-my-opencode", "oh-my-openagent"];
const RENAME_NOTICE =
  "oh-my-openagent: the 'omo' command is now 'omo-agent-toolkit' (the old name was removed in this major release).";

/**
 * Parse version string into numeric parts
 * @param {string} version
 * @returns {number[]}
 */
function parseVersion(version) {
  return version
    .replace(/^v/, "")
    .split("-")[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

/**
 * Compare two version strings
 * @param {string} current
 * @param {string} minimum
 * @returns {boolean} true if current >= minimum
 */
function compareVersions(current, minimum) {
  const currentParts = parseVersion(current);
  const minimumParts = parseVersion(minimum);
  const length = Math.max(currentParts.length, minimumParts.length);

  for (let index = 0; index < length; index++) {
    const currentPart = currentParts[index] ?? 0;
    const minimumPart = minimumParts[index] ?? 0;
    if (currentPart > minimumPart) return true;
    if (currentPart < minimumPart) return false;
  }

  return true;
}

/**
 * Check if opencode version meets minimum requirement
 * @returns {{ok: boolean, version: string | null}}
 */
function checkOpenCodeVersion() {
  try {
    const result = require("child_process").execSync("opencode --version", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    const version = result.trim();
    const ok = compareVersions(version, MIN_OPENCODE_VERSION);
    return { ok, version };
  } catch {
    return { ok: true, version: null };
  }
}

/**
 * Detect libc family on Linux
 */
function getLibcFamily() {
  if (process.platform !== "linux") {
    return undefined;
  }
  
  try {
    const detectLibc = require("detect-libc");
    return detectLibc.familySync();
  } catch {
    return null;
  }
}

function readMainPackageJson() {
  try {
    return JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
  } catch {
    return null;
  }
}

function getPackageBaseName() {
  const packageJson = readMainPackageJson();
  return resolvePlatformPackageBaseName(packageJson?.name || "oh-my-opencode");
}

function getMainPackageVersion() {
  const packageJson = readMainPackageJson();
  return packageJson?.version ?? null;
}

function invalidateOpenCodePluginCache() {
  const cacheDir = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "opencode");
  const parentDirs = [cacheDir, join(cacheDir, "packages")];
  const prefixes = OPENCODE_PLUGIN_PACKAGES.map((packageName) => `${packageName}@`);

  for (const parentDir of parentDirs) {
    try {
      for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
        if (entry.isDirectory() && prefixes.some((prefix) => entry.name.startsWith(prefix))) {
          rmSync(join(parentDir, entry.name), { recursive: true, force: true });
        }
      }
    } catch {
      // Cache invalidation is best-effort; postinstall should not fail package installs.
    }
  }
}

function readPlatformPackageVersion(pkg) {
  try {
    const platformPackageJsonPath = require.resolve(`${pkg}/package.json`);
    const packageJson = JSON.parse(readFileSync(platformPackageJsonPath, "utf8"));
    return packageJson.version ?? null;
  } catch {
    return null;
  }
}

// 벤더 패치는 두 층이다.
//
//   baseline  patches/<name>@<version>.patch      — 동결. 재생성하지 않는다.
//   series    patches/<name>/<version>/*.patch    — 앞으로의 변경. 추가만 한다.
//
// 통짜 패치 하나를 계속 재생성하던 시절에 잃은 것들이 series 를 만든 이유다:
// 재생성이 남의 hunk 를 덮었고(마지막 저장자 승리), 사람이 파일 목록을 고르다
// 신규 파일을 빠뜨렸고(그것을 import 하는 변경만 남아 런타임에서 터졌다),
// 무엇보다 두 세션이 같은 패치 파일을 동시에 쓰면 조용히 하나가 사라졌다.
// series 는 세션마다 다른 파일에 쓰므로 그 셋이 구조적으로 불가능하다.
//
// 순서는 **파일명 오름차순**이다. 명시적 index 파일을 두지 않는 것이 요점이다 —
// 그건 다시 모두가 함께 쓰는 파일이 되어 우리가 없앤 경합을 되살린다.
export const VENDOR_PATCHES = [
  {
    packageName: "@code-yeongyu/senpi",
    patchName: "@code-yeongyu%2Fsenpi@2026.8.22.patch",
    seriesName: "@code-yeongyu%2Fsenpi",
    expectedVersion: "2026.8.22",
    resolveRoot() {
      const packageLink = join(rootDir, "node_modules", "@code-yeongyu", "senpi");
      return realpathSync(packageLink);
    },
  },
  {
    packageName: "@code-yeongyu/senpi-tui (installed as @earendil-works/pi-tui)",
    patchName: "@code-yeongyu%2Fsenpi-tui@2026.8.22.patch",
    seriesName: "@code-yeongyu%2Fsenpi-tui",
    expectedVersion: "2026.8.22",
    resolveRoot() {
      const senpiRoot = VENDOR_PATCHES[0].resolveRoot();
      return realpathSync(join(senpiRoot, "node_modules", "@earendil-works", "pi-tui"));
    },
  },
  {
    packageName: "@earendil-works/pi-ai (nested in @code-yeongyu/senpi)",
    patchName: "@earendil-works%2Fpi-ai@2026.8.22.patch",
    seriesName: "@earendil-works%2Fpi-ai",
    expectedVersion: "2026.8.22",
    resolveRoot() {
      // 루트에 hoist 된 사본이 아니라 senpi 가 자기 안에 품은 사본이 세션이 읽는 것이다
      // (`engine-paths.mjs` 의 `senpiNested()` 도 이 사본을 우선한다). pi-tui 에서 같은
      // 구분을 놓치면 "패치는 정확한데 도는 것은 원본"인 상태가 오래 간다.
      const senpiRoot = VENDOR_PATCHES[0].resolveRoot();
      return realpathSync(join(senpiRoot, "node_modules", "@earendil-works", "pi-ai"));
    },
  },
];

export function seriesDir(spec, root = rootDir) {
  return join(root, "patches", spec.seriesName, spec.expectedVersion);
}

/**
 * baseline 과 series 를 적용 순서대로 모은다. 각 층은 자기 이름을 달고 다닌다 —
 * 실패했을 때 어느 patch 가 걸렸는지 말할 수 있어야 한다.
 */
/**
 * 패치는 한 버전을 상대로 뜬 것이다. 다른 버전에 대면 hunk 가 안 맞아 어차피
 * 실패하는데, 그때의 메시지는 "패키지가 baseline 과 다르다"라 원인이 안 보인다.
 * 버전이 다르면 여기서 그렇게 말하고 멈춘다.
 */
export function assertExpectedVersion(spec, installedVersion) {
  if (installedVersion !== spec.expectedVersion) {
    throw new Error(
      `${spec.packageName} is ${installedVersion} but patches/ targets ${spec.expectedVersion}. ` +
      "Re-cut the patch series against the new version instead of forcing it.",
    );
  }
}

export function collectPatchLayers(spec, root = rootDir) {
  const baselinePath = join(root, "patches", spec.patchName);
  if (!existsSync(baselinePath)) throw new Error(`missing required vendor patch: ${baselinePath}`);
  const layers = [{
    name: spec.patchName,
    filePatches: parseFilePatches(readFileSync(baselinePath, "utf8"), spec.patchName),
  }];
  const dir = seriesDir(spec, root);
  if (existsSync(dir)) {
    const names = readdirSync(dir).filter((name) => name.endsWith(".patch")).sort();
    for (const name of names) {
      const label = `${spec.seriesName}/${spec.expectedVersion}/${name}`;
      layers.push({ name: label, filePatches: parseFilePatches(readFileSync(join(dir, name), "utf8"), label) });
    }
  }
  return layers;
}

/** 파일 하나에 걸리는 hunk 들을 적용 순서대로 쌓는다. */
export function stackByFile(layers) {
  const stacks = new Map();
  for (const layer of layers) {
    for (const filePatch of layer.filePatches) {
      const stack = stacks.get(filePatch.relativePath) ?? [];
      stack.push({ ...filePatch, patchName: layer.name });
      stacks.set(filePatch.relativePath, stack);
    }
  }
  return stacks;
}

function forwardThrough(source, stack) {
  let current = source;
  for (const filePatch of stack) {
    // 판정 중에는 실패가 답의 일부다. 실제 적용은 아래에서 throw 를 살려 부른다.
    let next;
    try {
      next = applyFilePatch(current, filePatch, filePatch.patchName);
    } catch {
      return false;
    }
    if (next === false) return false;
    current = next;
  }
  return current;
}

function reverseThrough(source, stack) {
  let current = source;
  for (let index = stack.length - 1; index >= 0; index--) {
    const previous = applyFilePatch(current, stack[index], stack[index].patchName, true);
    if (previous === false) return false;
    current = previous;
  }
  return current;
}

/**
 * 현재 바이트가 스택의 앞 k 개를 적용한 상태인지 찾는다. 마커를 보지 않고
 * 역적용 round-trip 으로만 판정하므로, 패치 내용이 바뀌어도 따라온다.
 * 가장 많이 적용된 상태부터 본다 — 이미 최신이면 첫 번째 시도에서 끝난다.
 */
export function locateInStack(current, stack) {
  // 신규 파일의 reverse patch 는 내용이 반복돼 있어도 마지막 복제본 하나만 지워
  // round-trip 을 통과할 수 있다. 그래서 빈 파일에서 정방향으로 만든 각 prefix와
  // 현재 바이트를 직접 비교한다. 같은 신규 파일에 후속 patch가 쌓여도 안전하다.
  if (stack[0]?.createsFile) {
    let expected = "";
    if (current === expected) return { pristine: "", applied: 0 };
    for (let k = 0; k < stack.length; k++) {
      try {
        expected = applyFilePatch(expected, stack[k], stack[k].patchName);
      } catch {
        return null;
      }
      if (current === expected) return { pristine: "", applied: k + 1 };
    }
    return null;
  }
  for (let k = stack.length; k >= 0; k--) {
    const head = stack.slice(0, k);
    const pristine = reverseThrough(current, head);
    if (pristine === false) continue;
    if (forwardThrough(pristine, head) !== current) continue;
    return { pristine, applied: k };
  }
  return null;
}

export function parseFilePatches(patchText, patchName) {
  const chunks = patchText.split(/(?=^diff --git )/m).filter((chunk) => chunk.startsWith("diff --git "));
  if (chunks.length === 0) throw new Error(`vendor patch ${patchName} contains no file hunks`);
  const files = chunks.map((text) => {
    const header = text.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    if (!header || header[1] !== header[2]) {
      throw new Error(`vendor patch ${patchName} has an unsupported rename or malformed header`);
    }
    // hunk 가 없는 diff(mode 변경, 바이너리)는 적용해도 원본 그대로라, 아래 검증이
    // "이미 적용됨"으로 읽고 영구히 지나친다. 받지 않는다.
    if (!/^@@ /m.test(text)) {
      throw new Error(
        `vendor patch ${patchName}: ${header[2]} has no hunks (mode-only and binary diffs are not supported)`,
      );
    }
    return { relativePath: header[2], text, createsFile: /^--- \/dev\/null$/m.test(text) };
  });
  const duplicates = files.filter((file, index) => files.findIndex((candidate) => candidate.relativePath === file.relativePath) !== index);
  if (duplicates.length > 0) throw new Error(`vendor patch ${patchName} repeats file hunks for ${duplicates[0].relativePath}`);
  return files;
}

export function applyFilePatch(source, filePatch, patchName, reverse = false) {
  // chunk 하나에 파일이 둘 이상 들어 있으면 [0] 만 쓰는 순간 나머지가 조용히 사라진다.
  // `diff --git` 헤더를 빠뜨린 hunk 가 앞 파일에 딸려 들어오는 것이 그 경로다.
  const parsedAll = parsePatch(filePatch.text);
  if (parsedAll.length !== 1) {
    throw new Error(
      `vendor patch ${patchName}: the chunk for ${filePatch.relativePath} contains ${parsedAll.length} ` +
      'file patches. Every file needs its own "diff --git" header.',
    );
  }
  const parsed = parsedAll[0];
  if (reverse) {
    for (const hunk of parsed.hunks) {
      [hunk.oldStart, hunk.newStart] = [hunk.newStart, hunk.oldStart];
      [hunk.oldLines, hunk.newLines] = [hunk.newLines, hunk.oldLines];
      hunk.lines = hunk.lines.map((line) => line.startsWith("+") ? `-${line.slice(1)}` : line.startsWith("-") ? `+${line.slice(1)}` : line);
    }
  }
  const result = applyPatch(source, parsed, { fuzzFactor: 0 });
  if (result === false && !reverse) {
    throw new Error(
      `cannot apply ${patchName} to ${filePatch.relativePath}; ` +
      "the installed package no longer matches the pristine baseline. Regenerate the patch from npm pack, not node_modules.",
    );
  }
  return result;
}

function applyAndVerifyVendorPatch(spec) {
  const packageRoot = spec.resolveRoot();
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  // 패치는 한 버전을 상대로 뜬 것이다. 다른 버전에 대면 hunk 가 안 맞아 어차피
  // 실패하는데, 그때의 메시지는 "패키지가 baseline 과 다르다"라 원인이 안 보인다.
  // 버전이 다르면 여기서 그렇게 말하고 멈춘다.
  assertExpectedVersion(spec, manifest.version);

  const layers = collectPatchLayers(spec);
  const stacks = stackByFile(layers);
  const writes = [];

  for (const [relativePath, stack] of stacks) {
    const targetPath = join(packageRoot, relativePath);
    const source = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";
    const located = locateInStack(source, stack);
    if (located === null) {
      throw new Error(
        `cannot place ${relativePath} in the patch series for ${spec.packageName}; ` +
        "the installed file matches neither the pristine baseline nor any prefix of the series. " +
        "Reinstall the package instead of editing node_modules.",
      );
    }
    if (located.applied === stack.length) continue;

    // 남은 층을 순서대로 얹는다. 여기서의 실패는 삼키지 않는다 — 같은 원본 줄을
    // 두 patch 가 건드리면 여기서 멈춰야 조용한 손실이 안 생긴다. 자동 병합은
    // 하지 않는다. 무엇이 어디서 부딪혔는지 말하고 사람에게 돌려준다.
    let contents = located.pristine;
    for (const [index, filePatch] of stack.entries()) {
      try {
        contents = applyFilePatch(filePatch.createsFile && contents === "" ? "" : contents, filePatch, filePatch.patchName);
      } catch (error) {
        if (index === 0) throw error;
        throw new Error(
          `${filePatch.patchName} does not apply to ${relativePath} on top of ${stack[index - 1].patchName}. ` +
          "Two patches in the series change the same lines. Open a fresh workspace " +
          "(`node harness/scripts/vendor-patch.mjs open <pkg>`), redo this change on top of the current " +
          "series, and save it as a new patch. Do not edit the existing patch.",
        );
      }
    }
    writes.push({ targetPath, contents });
  }

  for (const write of writes) {
    mkdirSync(dirname(write.targetPath), { recursive: true });
    writeFileSync(write.targetPath, write.contents);
  }

  for (const [relativePath, stack] of stacks) {
    const targetPath = realpathSync(join(packageRoot, relativePath));
    const patched = readFileSync(targetPath, "utf8");
    const located = locateInStack(patched, stack);
    if (located === null || located.applied !== stack.length) {
      throw new Error(`realpath verification failed for ${targetPath}`);
    }
  }
  const seriesCount = layers.length - 1;
  const suffix = seriesCount > 0 ? ` +${seriesCount} series patch${seriesCount === 1 ? "" : "es"}` : "";
  console.log(`✓ verified ${spec.packageName}@${manifest.version} at ${realpathSync(packageRoot)}${suffix}`);
}

function applyVendorPatches() {
  for (const spec of VENDOR_PATCHES) applyAndVerifyVendorPatch(spec);
}
function main() {
  applyVendorPatches();
  const { platform, arch } = process;
  const libcFamily = getLibcFamily();
  const packageBaseName = getPackageBaseName();

  // npm >= 7 hides lifecycle output unless --foreground-scripts, so this notice is
  // best-effort: the reliable migration surfaces are the CHANGELOG, docs, and README.
  console.log(RENAME_NOTICE);

  invalidateOpenCodePluginCache();

  // Check opencode version requirement
  const versionCheck = checkOpenCodeVersion();
  if (versionCheck.version && !versionCheck.ok) {
    console.warn(`⚠ oh-my-opencode requires OpenCode >= ${MIN_OPENCODE_VERSION}`);
    console.warn(`  Detected: ${versionCheck.version}`);
    console.warn(`  Please update OpenCode to avoid compatibility issues.`);
  }

  try {
    const packageCandidates = getPlatformPackageCandidates({
      platform,
      arch,
      libcFamily,
      packageBaseName,
    });

    const resolvedPackage = packageCandidates.find((pkg) => {
      try {
        require.resolve(getBinaryPath(pkg, platform));
        return true;
      } catch {
        return false;
      }
    });

    if (!resolvedPackage) {
      throw new Error(
        `No platform binary package installed. Tried: ${packageCandidates.join(", ")}`
      );
    }

    const mismatch = detectPlatformBinaryMismatch({
      mainVersion: getMainPackageVersion(),
      platformVersion: readPlatformPackageVersion(resolvedPackage),
      platformPackage: resolvedPackage,
    });
    if (mismatch) {
      console.warn(`⚠ oh-my-opencode platform binary version mismatch detected`);
      console.warn(`  ${packageBaseName}: ${mismatch.mainVersion}`);
      console.warn(`  ${mismatch.platformPackage}: ${mismatch.platformVersion}`);
      console.warn(`  The startup banner may show the stale version until the platform binary is updated.`);
      console.warn(`  Fix: npm install -g ${packageBaseName}@${mismatch.mainVersion} ${mismatch.platformPackage}@${mismatch.mainVersion}`);
    }

    console.log(`✓ oh-my-opencode binary installed for ${platform}-${arch} (${resolvedPackage})`);
  } catch (error) {
    console.warn(`⚠ oh-my-opencode: ${error.message}`);
    console.warn(`  The CLI may not work on this platform.`);
    // Don't fail installation - let user try anyway
  }
}

// 파서를 테스트에서 import 할 수 있게, 직접 실행일 때만 돈다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
