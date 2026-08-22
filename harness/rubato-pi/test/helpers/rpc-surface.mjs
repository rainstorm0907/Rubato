import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function readJsonlResponses(child, wanted, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const got = new Map();
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timeout after ${timeoutMs}ms; have ${[...got.keys()].join(",") || "nothing"}`));
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
        if (rec.type === "response" && rec.command && !got.has(rec.command)) {
          got.set(rec.command, rec);
          if (wanted.every((name) => got.has(name))) {
            clearTimeout(timer);
            child.stdout.off("data", onData);
            resolve(got);
          }
        }
      }
    };
    child.stdout.on("data", onData);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code, signal) => {
      if (wanted.every((name) => got.has(name))) return;
      clearTimeout(timer);
      reject(new Error(`senpi exited ${code}/${signal} before responses`));
    });
  });
}

export async function probeRpc({ nodeBin, senpiCli, extensionArgs, extraArgs = [], env = {} }) {
  const home = mkdtempSync(join(tmpdir(), "rubato-pi-test-"));
  const agentDir = join(home, "agent");
  const cwd = join(home, "cwd");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  const child = spawn(nodeBin, [senpiCli, "--mode", "rpc", "--no-context-files", "--no-prompt-templates", ...extensionArgs, ...extraArgs], {
    cwd,
    env: {
      PATH: process.env.PATH,
      HOME: home,
      SENPI_CODING_AGENT_DIR: agentDir,
      PI_OFFLINE: "1",
      DO_NOT_TRACK: "1",
      OMO_DISABLE_POSTHOG: "1",
      OMO_SENPI_DISABLE_POSTHOG: "1",
      ...env,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (c) => {
    stderr += c.toString("utf8");
  });
  child.stdin.write('{"id":"c1","type":"get_commands"}\n');
  child.stdin.write('{"id":"c2","type":"get_loaded_surfaces"}\n');
  try {
    const result = await readJsonlResponses(child, ["get_commands", "get_loaded_surfaces"], 45000);
    const commands = result.get("get_commands")?.data?.commands ?? [];
    const surfaces = result.get("get_loaded_surfaces")?.data ?? {};
    return {
      home,
      stderr,
      commands,
      skills: commands.filter((c) => c.source === "skill").map((c) => c.name),
      extensionCommands: commands.filter((c) => c.source !== "skill").map((c) => c.name),
      extensions: (surfaces.extensions ?? []).map((e) => ({ name: e.name, path: e.path })),
      mcpServers: (surfaces.mcpServers ?? []).map((s) => s.name ?? s),
    };
  } finally {
    child.kill("SIGKILL");
  }
}
