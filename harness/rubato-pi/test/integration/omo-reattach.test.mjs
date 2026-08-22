import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { adapterPath, leadOverlayPath, senpiCliPath } from "../../src/launch.mjs";
import { launchEnv } from "../../src/brand.mjs";
import { startMockOpenAI } from "../helpers/mock-openai.mjs";

function startParent({ home, agentDir, cwd, mockUrl }) {
  return spawn(
    process.execPath,
    [
      senpiCliPath(),
      "--mode",
      "rpc",
      "--no-context-files",
      "--no-prompt-templates",
      "--approve",
      "--permission-preset",
      "full-access",
      "--model",
      "mock/stub",
      "-e",
      leadOverlayPath(),
      "-e",
      adapterPath(),
    ],
    {
      cwd,
      env: {
        ...launchEnv(process.env, agentDir),
        HOME: home,
        PATH: process.env.PATH,
        OMO_CODING_AGENT_DIR: agentDir,
      },
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    },
  );
}

function killTree(child) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
}

function waitForEvent(child, match, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => {
      child.stdout.off("data", onData);
      reject(new Error(`timeout waiting for event`));
    }, timeoutMs);
    const onData = (chunk) => {
      buf += chunk.toString("utf8");
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let rec;
        try {
          rec = JSON.parse(line);
        } catch {
          continue;
        }
        if (match(rec)) {
          clearTimeout(timer);
          child.stdout.off("data", onData);
          resolve(rec);
        }
      }
    };
    child.stdout.on("data", onData);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`parent exited ${code}/${signal}`));
    });
  });
}

function findFiles(root, match) {
  const found = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let names = [];
    try {
      names = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of names) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") stack.push(path);
      } else if (match(entry.name, path)) found.push(path);
    }
  }
  return found;
}

function findTaskDirs(root) {
  const found = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let names = [];
    try {
      names = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of names) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "tasks" && dir.endsWith("senpi-task")) found.push(path);
        if (entry.name !== "node_modules") stack.push(path);
      }
    }
  }
  return found;
}

function taskRecords(root) {
  const records = [];
  for (const dir of findTaskDirs(root)) {
    for (const name of readdirSync(dir).filter((item) => item.endsWith(".json"))) {
      records.push(JSON.parse(readFileSync(join(dir, name), "utf8")));
    }
  }
  return records;
}

function waitForRecords(root, timeoutMs, ready = (records) => records.length > 0) {
  return new Promise((resolve, reject) => {
    const existing = taskRecords(root);
    if (ready(existing)) {
      resolve(existing);
      return;
    }
    const watcher = watch(root, { recursive: true }, () => {
      const records = taskRecords(root);
      if (ready(records)) {
        watcher.close();
        clearTimeout(timer);
        resolve(records);
      }
    });
    const timer = setTimeout(() => {
      watcher.close();
      reject(new Error(`timeout waiting for task records: ${JSON.stringify(taskRecords(root))}`));
    }, timeoutMs);
  });
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("OMO process child keeps the same task id after parent restart", async () => {
  const home = mkdtempSync(join(tmpdir(), "rubato-pi-omo-re-"));
  const agentDir = join(home, "agent");
  const cwd = join(home, "cwd");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  writeFileSync(
    join(agentDir, "settings.json"),
    `${JSON.stringify({ defaultProjectTrust: "always", permissionPreset: "full-access", compaction: { enabled: false } })}\n`,
  );
  const taskConfig = {
    "[senpi]": {
      task: {
        default_execution_mode: "process",
        reattach_on_reconcile: true,
        resume_children: true,
      },
    },
  };
  mkdirSync(join(home, ".omo"), { recursive: true });
  mkdirSync(join(cwd, ".omo"), { recursive: true });
  writeFileSync(join(home, ".omo", "omo.jsonc"), `${JSON.stringify(taskConfig, null, 2)}\n`);
  writeFileSync(join(cwd, ".omo", "omo.jsonc"), `${JSON.stringify(taskConfig, null, 2)}\n`);
  writeFileSync(
    join(agentDir, "models.json"),
    `${JSON.stringify({
      providers: {
        mock: {
          baseUrl: "http://127.0.0.1:0/v1",
          api: "openai-completions",
          apiKey: "dummy",
          models: [{ id: "stub", reasoning: false, contextWindow: 1000000, maxTokens: 256 }],
        },
      },
    })}\n`,
  );

  let calls = 0;
  const mock = await startMockOpenAI({
    onRequest() {
      calls += 1;
      if (calls === 1) {
        return {
          type: "tool",
          name: "task",
          args: {
            prompt: "hold this process open",
            category: "quick",
            run_in_background: true,
            execution_mode: "process",
          },
        };
      }
      return { type: "hang" };
    },
  });
  const models = {
    providers: {
      mock: {
        baseUrl: mock.url,
        api: "openai-completions",
        apiKey: "dummy",
        models: [{ id: "stub", reasoning: false, contextWindow: 1000000, maxTokens: 256 }],
      },
    },
  };
  writeFileSync(join(agentDir, "models.json"), `${JSON.stringify(models)}\n`);

  const parent = startParent({ home, agentDir, cwd, mockUrl: mock.url });
  let stderr = "";
  parent.stderr.on("data", (c) => {
    stderr += c.toString("utf8");
  });

  try {
    const set = waitForEvent(parent, (rec) => rec.type === "response" && rec.command === "set_model", 20000);
    parent.stdin.write('{"id":"m","type":"set_model","provider":"mock","modelId":"stub"}\n');
    const setRes = await set;

    const events = [];
    parent.stdout.on("data", (chunk) => {
      String(chunk).split("\n").forEach((line) => {
        if (!line.trim()) return;
        let rec;
        try {
          rec = JSON.parse(line);
        } catch {
          return;
        }
        events.push(rec);
        if (rec.type === "extension_ui_request" && rec.method !== "notify") {
          const value = rec.method === "confirm" ? true : rec.options?.[0] ?? "Allow";
          parent.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: rec.id, value })}\n`);
        }
      });
    });
    const spawned = waitForEvent(
      parent,
      (rec) => rec.type === "tool_execution_start" || rec.type === "tool_execution_end",
      25000,
    );
    parent.stdin.write('{"id":"p","type":"prompt","message":"spawn a helper and keep it running"}\n');
    try {
      await spawned;
    } catch (error) {
      throw new Error(`${error.message}; set=${JSON.stringify({ success: setRes.success, error: setRes.error })}; reqs=${JSON.stringify(mock.requests)}; types=${events.map((e) => e.type + (e.command ? ":" + e.command : "")).join(",")}; stderr=${stderr.slice(-800)}`);
    }

    let first;
    try {
      first = await waitForRecords(
        home,
        20000,
        (records) =>
          records.some((item) => item.execution_mode === "process" && item.pid) &&
          findFiles(home, (name, path) => name.endsWith(".jsonl") && path.includes(`${sep}children${sep}`)).length > 0,
      );
    } catch (error) {
      const starts = events.filter((e) => String(e.type).includes("tool"));
      throw new Error(`${error.message}; tools=${JSON.stringify(starts)}; types=${events.map((e) => e.type).join(",")}; stderr=${stderr.slice(-1000)}`);
    }
    const record = first.find((item) => item.execution_mode === "process" && item.pid) ?? first[0];
    assert.ok(record.task_id, record);
    assert.equal(
      record.execution_mode,
      "process",
      `expected process child, got ${JSON.stringify({
        execution_mode: record.execution_mode,
        status: record.status,
        pid: record.pid,
        residency_state: record.residency_state,
      })}`,
    );
    const childPid = record.pid;
    if (childPid) assert.equal(pidAlive(childPid), true);

    parent.kill("SIGKILL");

    const restarted = startParent({ home, agentDir, cwd, mockUrl: mock.url });
    try {
      const ready = waitForEvent(restarted, (rec) => rec.type === "response" && rec.command === "get_commands", 20000);
      restarted.stdin.write('{"id":"g","type":"get_commands"}\n');
      await ready;
      const after = await waitForRecords(
        home,
        15000,
        (records) => {
          const same = records.find((item) => item.task_id === record.task_id);
          return Boolean(same) && same.status !== "lost";
        },
      ).catch(() => taskRecords(home));
      const same = after.find((item) => item.task_id === record.task_id);
      assert.ok(same, `task ${record.task_id} missing after restart`);
      assert.notEqual(
        same.status,
        "lost",
        JSON.stringify({
          status: same.status,
          pid: same.pid,
          jsonl: findFiles(home, (name) => name.endsWith(".jsonl")),
          execution_mode: same.execution_mode,
        }),
      );
      const replayed = after.filter((item) => item.task_id !== record.task_id);
      assert.equal(replayed.length, 0, "parent restart replayed the spawn prompt");
    } finally {
      killTree(restarted);
    }
  } finally {
    killTree(parent);
    if (taskRecords(home).length > 0) {
      for (const rec of taskRecords(home)) {
        if (rec.pid && pidAlive(rec.pid)) process.kill(rec.pid, "SIGKILL");
      }
    }
    await mock.close();
  }
});
