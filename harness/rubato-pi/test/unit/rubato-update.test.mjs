import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const SCRIPT_SRC = join(dirname(fileURLToPath(import.meta.url)), "../../../scripts/rubato-update.sh");

function git(cwd, args, opts = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_OK: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
    ...opts,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return result;
}

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function setupFixture({ dirty = false, conflict = false, evidence = false, decoyStash = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "rubato-update-"));
  const bare = join(root, "origin.git");
  const seed = join(root, "seed");
  const local = join(root, "local");
  const home = join(root, "home");
  mkdirSync(home);

  git(root, ["init", "--bare", "-b", "rubato/base", bare]);
  git(root, ["clone", bare, seed]);
  git(seed, ["config", "user.email", "upd@example.com"]);
  git(seed, ["config", "user.name", "upd"]);
  git(seed, ["config", "commit.gpgsign", "false"]);
  write(join(seed, "note.txt"), "v1\n");
  write(join(seed, "keep.txt"), "keep\n");
  write(join(seed, ".omo/evidence/log.txt"), "evidence-v1\n");
  const scriptDest = join(seed, "harness/scripts/rubato-update.sh");
  mkdirSync(dirname(scriptDest), { recursive: true });
  cpSync(SCRIPT_SRC, scriptDest);
  chmodSync(scriptDest, 0o755);
  git(seed, ["add", "note.txt", "keep.txt", ".omo/evidence/log.txt", "harness/scripts/rubato-update.sh"]);
  git(seed, ["commit", "-m", "base"]);
  git(seed, ["branch", "-M", "rubato/base"]);
  git(seed, ["push", "-u", "origin", "rubato/base"]);

  git(root, ["clone", "-b", "rubato/base", bare, local]);
  git(local, ["config", "user.email", "upd@example.com"]);
  git(local, ["config", "user.name", "upd"]);
  git(local, ["config", "commit.gpgsign", "false"]);

  write(join(seed, "note.txt"), "remote\n");
  git(seed, ["add", "note.txt"]);
  git(seed, ["commit", "-m", "remote"]);
  git(seed, ["push", "origin", "rubato/base"]);

  write(join(local, "extra.txt"), "local-only\n");
  git(local, ["add", "extra.txt"]);
  git(local, ["commit", "-m", "local-only"]);
  const localOnly = git(local, ["rev-parse", "HEAD"]).stdout.trim();

  let decoySha = "";
  if (decoyStash) {
    write(join(local, "decoy.txt"), "decoy\n");
    git(local, ["add", "decoy.txt"]);
    git(local, ["stash", "push", "--include-untracked", "--message", "rubato-update 1"]);
    decoySha = git(local, ["rev-parse", "refs/stash"]).stdout.trim();
  }
  if (dirty) {
    write(join(local, "keep.txt"), "keep dirty\n");
    write(join(local, "scratch.txt"), "scratch\n");
  }
  if (conflict) {
    write(join(local, "note.txt"), "local-wip\n");
  }
  if (evidence) {
    write(join(local, ".omo/evidence/log.txt"), "evidence-dirty\n");
  }

  const dest = join(local, "harness/scripts/rubato-update.sh");
  return { root, local, home, dest, localOnly, decoySha };
}

function runUpdate(fixture) {
  return spawnSync("sh", [fixture.dest, "--yes"], {
    cwd: fixture.local,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: fixture.home,
      GIT_OK: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  });
}

function backupBranch(local) {
  const listed = git(local, ["for-each-ref", "--format=%(refname:short)", "refs/heads/rubato/update-backup-*"]).stdout
    .trim()
    .split("\n")
    .filter(Boolean);
  assert.equal(listed.length, 1, `expected one backup branch, got ${listed.join(",") || "(none)"}`);
  return listed[0];
}

test("unattended update hard-resets a diverged rubato/base and keeps local commits on a backup branch", () => {
  const fixture = setupFixture();
  const result = runUpdate(fixture);
  const out = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0, out);

  const head = git(fixture.local, ["rev-parse", "HEAD"]).stdout.trim();
  const remote = git(fixture.local, ["rev-parse", "origin/rubato/base"]).stdout.trim();
  const branch = git(fixture.local, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
  assert.equal(branch, "rubato/base");
  assert.equal(head, remote);

  const backup = backupBranch(fixture.local);
  assert.match(backup, /^rubato\/update-backup-\d{14}-\d+$/);
  git(fixture.local, ["merge-base", "--is-ancestor", fixture.localOnly, backup]);
  assert.equal(git(fixture.local, ["status", "--porcelain"]).stdout, "");
  assert.equal(git(fixture.local, ["stash", "list"]).stdout, "");
  assert.match(out, new RegExp(`git log --oneline origin/rubato/base\\.\\.${backup.replaceAll("/", "\\/")}`));
  assert.match(out, new RegExp(`git cherry-pick origin/rubato/base\\.\\.${backup.replaceAll("/", "\\/")}`));
});

test("unattended update restores non-conflicting dirty and untracked work after divergence", () => {
  const fixture = setupFixture({ dirty: true });
  const result = runUpdate(fixture);
  const out = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0, out);

  const head = git(fixture.local, ["rev-parse", "HEAD"]).stdout.trim();
  const remote = git(fixture.local, ["rev-parse", "origin/rubato/base"]).stdout.trim();
  assert.equal(head, remote);
  assert.equal(readFileSync(join(fixture.local, "note.txt"), "utf8"), "remote\n");
  assert.equal(readFileSync(join(fixture.local, "keep.txt"), "utf8"), "keep dirty\n");
  assert.equal(readFileSync(join(fixture.local, "scratch.txt"), "utf8"), "scratch\n");

  const backup = backupBranch(fixture.local);
  git(fixture.local, ["merge-base", "--is-ancestor", fixture.localOnly, backup]);
});

test("restoration conflict is nonzero, skips rebuild, and prints drop from the unmerged tree", () => {
  const fixture = setupFixture({ dirty: true, conflict: true });
  const result = runUpdate(fixture);
  const out = `${result.stdout}\n${result.stderr}`;
  assert.notEqual(result.status, 0, out);
  assert.match(out, /재빌드는 하지 않습니다/);
  assert.doesNotMatch(out, /업데이트를 마쳤습니다/);
  assert.doesNotMatch(out, /git stash pop/);

  const head = git(fixture.local, ["rev-parse", "HEAD"]).stdout.trim();
  const remote = git(fixture.local, ["rev-parse", "origin/rubato/base"]).stdout.trim();
  assert.equal(head, remote);
  assert.ok(backupBranch(fixture.local));

  assert.match(out, /git status/);
  assert.match(out, /git add -u/);
  const drop = out.match(/git stash drop (stash@\{\d+\})/);
  assert.ok(drop, `missing stash drop command in:\n${out}`);
  assert.match(out, /[0-9a-f]{40}/);

  const stashes = git(fixture.local, ["stash", "list"]).stdout;
  assert.match(stashes, /rubato-update /);
  assert.match(stashes, new RegExp(drop[1].replace(/[{}]/g, "\\$&")));
  const unmerged = git(fixture.local, ["ls-files", "-u"]).stdout;
  assert.match(unmerged, /note\.txt/);
});

test("tracked dirty .omo/evidence survives a diverged hard reset", () => {
  const fixture = setupFixture({ evidence: true });
  const result = runUpdate(fixture);
  const out = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0, out);

  const head = git(fixture.local, ["rev-parse", "HEAD"]).stdout.trim();
  const remote = git(fixture.local, ["rev-parse", "origin/rubato/base"]).stdout.trim();
  assert.equal(head, remote);
  assert.equal(readFileSync(join(fixture.local, ".omo/evidence/log.txt"), "utf8"), "evidence-dirty\n");
  assert.ok(backupBranch(fixture.local));
  git(fixture.local, ["merge-base", "--is-ancestor", fixture.localOnly, backupBranch(fixture.local)]);
});

test("updater pops only the stash it created when a substring decoy is already on the stack", () => {
  const fixture = setupFixture({ dirty: true, decoyStash: true });
  const result = runUpdate(fixture);
  const out = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0, out);

  assert.equal(readFileSync(join(fixture.local, "keep.txt"), "utf8"), "keep dirty\n");
  assert.equal(readFileSync(join(fixture.local, "scratch.txt"), "utf8"), "scratch\n");
  assert.equal(existsSync(join(fixture.local, "decoy.txt")), false);

  const stashes = git(fixture.local, ["stash", "list", "--format=%H %gs"]).stdout;
  assert.match(stashes, new RegExp(`^${fixture.decoySha} `, "m"));
  assert.equal(stashes.trim().split("\n").length, 1);
});
