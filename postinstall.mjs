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

const VENDOR_PATCHES = [
  {
    packageName: "@code-yeongyu/senpi",
    patchName: "@code-yeongyu%2Fsenpi@2026.8.22.patch",
    resolveRoot() {
      const packageLink = join(rootDir, "node_modules", "@code-yeongyu", "senpi");
      return realpathSync(packageLink);
    },
  },
  {
    packageName: "@code-yeongyu/senpi-tui (installed as @earendil-works/pi-tui)",
    patchName: "@code-yeongyu%2Fsenpi-tui@2026.8.22.patch",
    resolveRoot() {
      const senpiRoot = VENDOR_PATCHES[0].resolveRoot();
      return realpathSync(join(senpiRoot, "node_modules", "@earendil-works", "pi-tui"));
    },
  },
];

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
  const patchPath = join(rootDir, "patches", spec.patchName);
  if (!existsSync(patchPath)) throw new Error(`missing required vendor patch: ${patchPath}`);
  const filePatches = parseFilePatches(readFileSync(patchPath, "utf8"), spec.patchName);
  const writes = [];

  for (const filePatch of filePatches) {
    const targetPath = join(packageRoot, filePatch.relativePath);
    const source = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";

    // Idempotence is exact, not marker-based: reverse the hunk and require the
    // current bytes to be precisely the intended patched output.
    const pristine = applyFilePatch(source, filePatch, spec.patchName, true);
    if (pristine !== false) {
      const roundTrip = applyFilePatch(pristine, filePatch, spec.patchName);
      if (roundTrip !== source) throw new Error(`vendor patch verification failed for ${filePatch.relativePath}`);
      continue;
    }

    const expected = applyFilePatch(filePatch.createsFile ? "" : source, filePatch, spec.patchName);
    writes.push({ targetPath, contents: expected });
  }

  for (const write of writes) {
    mkdirSync(dirname(write.targetPath), { recursive: true });
    writeFileSync(write.targetPath, write.contents);
  }

  for (const filePatch of filePatches) {
    const targetPath = realpathSync(join(packageRoot, filePatch.relativePath));
    const patched = readFileSync(targetPath, "utf8");
    const pristine = applyFilePatch(patched, filePatch, spec.patchName, true);
    if (pristine === false || applyFilePatch(pristine, filePatch, spec.patchName) !== patched) {
      throw new Error(`realpath verification failed for ${targetPath}`);
    }
  }
  console.log(`✓ verified ${spec.packageName}@${manifest.version} at ${realpathSync(packageRoot)}`);
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
