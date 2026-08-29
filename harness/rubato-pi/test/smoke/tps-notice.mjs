// 실제 브로커에 붙는 한 턴을 돌려 tps 알림 줄과 그 뒤의 호출별 timing 을 찍는다.
// 자동 테스트가 아니라 손으로 돌리는 확인용: `node test/smoke/tps-notice.mjs`.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { adapterPath, providerOverlayPath, leadOverlayPath, senpiCliPath } from "../../src/launch.mjs";
import { launchEnv } from "../../src/brand.mjs";

const agentDir = join(homedir(), ".rubato-pi", "agent");
const prompt = process.argv[2] ??
  "Prove that for every positive integer n, 2^(2^n) + 5 is composite. Show the full argument.";

const child = spawn(
  process.execPath,
  [
    senpiCliPath(),
    "--mode",
    "rpc",
    "--no-context-files",
    "--model",
    "anthropic/claude-opus-5",
    "-e",
    leadOverlayPath(),
    "-e",
    providerOverlayPath(),
    "-e",
    adapterPath(),
  ],
  {
    cwd: process.cwd(),
    env: { ...launchEnv(process.env, agentDir), PATH: process.env.PATH },
    stdio: ["pipe", "pipe", "inherit"],
  },
);

let buf = "";
child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.type === "extension_ui_request" && rec.method === "notify") {
      console.log("NOTICE:", rec.message);
    }
    if (rec.type === "agent_end" && rec.willRetry !== true) {
      for (const message of rec.messages ?? []) {
        if (message?.role === "assistant" && message.timing) {
          // 사고가 실제로 있었는지를 같이 찍는다 — think 평균에 뭐가 들어갔는지 눈으로 맞춰보려고.
          const thinkingChars = (message.content ?? [])
            .filter((part) => part?.type === "thinking")
            .map((part) => (part.thinking ?? "").length);
          console.log("TIMING:", JSON.stringify(message.timing), "thinkingChars:", JSON.stringify(thinkingChars));
        }
      }
      setTimeout(() => {
        child.kill("SIGKILL");
        process.exit(0);
      }, 500);
    }
  }
});

child.stdin.write(`${JSON.stringify({ id: "t", type: "set_thinking_level", level: "high" })}\n`);
setTimeout(() => {
  child.stdin.write(`${JSON.stringify({ id: "p", type: "prompt", message: prompt })}\n`);
}, 1500);
