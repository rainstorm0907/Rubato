const FAMILIES = [
  ["opus", "Opus"],
  ["sonnet", "Sonnet"],
  ["haiku", "Haiku"],
  ["fable", "Fable"],
  ["mythos", "Mythos"],
  ["grok", "Grok"],
  ["gemini", "Gemini"],
  ["kimi", "Kimi"],
  ["gpt", "GPT"],
];

export function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, "");
}

export function shortModelLabel(modelId) {
  if (!modelId) return "unknown";
  const bare = String(modelId).split("/").pop();
  const lc = bare.toLowerCase();
  const sol = solLabel(lc);
  if (sol) return sol;
  for (const [key, label] of FAMILIES) {
    const idx = lc.indexOf(key);
    if (idx < 0) continue;
    const tail = lc.slice(idx + key.length).replace(/^[-.]/, "");
    const version = parseVersion(tail);
    return version ? `${label} ${version}` : label;
  }
  const colon = bare.indexOf(":");
  return colon >= 0 ? bare.slice(0, colon) : bare;
}

function solLabel(lc) {
  const idx = lc.lastIndexOf("sol");
  if (idx < 0) return "";
  if (idx > 0 && lc[idx - 1] !== "-" && lc[idx - 1] !== ".") return "";
  const before = lc.slice(0, idx).replace(/[-.]$/, "").replace(/^gpt[-.]/, "");
  const version = parseVersion(before.replace(/^[a-z]+[-.]/, "")) || parseVersion(before);
  return version ? `${version} Sol` : "Sol";
}

export function formatEffort(level) {
  if (!level || level === "off") return "";
  if (level === "xhigh") return "Xhigh";
  if (level === "max") return "Max";
  return String(level);
}

export function formatModelWithEffort(modelId, level) {
  const model = shortModelLabel(modelId);
  const effort = formatEffort(level) || effortFromModelId(modelId);
  return effort ? `${model} ${effort}` : model;
}

function effortFromModelId(modelId) {
  if (!modelId) return "";
  const bare = String(modelId).split("/").pop();
  const colon = bare.lastIndexOf(":");
  if (colon < 0) return "";
  return formatEffort(bare.slice(colon + 1).toLowerCase());
}

function parseVersion(tail) {
  const parts = [];
  let part = "";
  for (const ch of tail) {
    if (ch >= "0" && ch <= "9") {
      part += ch;
    } else if ((ch === "-" || ch === ".") && part) {
      parts.push(part);
      part = "";
    } else {
      break;
    }
  }
  if (part) parts.push(part);
  while (parts.length > 0 && parts[parts.length - 1].length >= 6) parts.pop();
  if (parts.length === 0) return "";
  if (parts.length >= 2) return `${parts[0]}.${parts[1]}`;
  return parts[0];
}

export function remainingPercent(usedPercent) {
  if (usedPercent == null || Number.isNaN(Number(usedPercent))) return null;
  const remaining = Math.round(100 - Number(usedPercent));
  if (remaining < 0) return 0;
  if (remaining > 100) return 100;
  return remaining;
}

export function formatWindow(count) {
  const n = Math.round(Number(count) || 0);
  if (n <= 0) return "";
  if (n < 1_000) return String(n);
  if (n < 10_000) return trim1(n / 1_000) + "K";
  if (n < 1_000_000) return `${Math.round(n / 1_000)}K`;
  if (n < 10_000_000) return trim1(n / 1_000_000) + "M";
  if (n < 1_000_000_000) return `${Math.round(n / 1_000_000)}M`;
  return trim1(n / 1_000_000_000) + "B";
}

function trim1(n) {
  const s = n.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

export function formatContext(remaining, window) {
  const size = formatWindow(window);
  if (remaining == null) return size ? `?(${size})` : "?";
  return size ? `${remaining}%(${size})` : `${remaining}%`;
}

export function cacheHitPercent(usage) {
  if (!usage) return null;
  const input = Number(usage.input) || 0;
  const cacheRead = Number(usage.cacheRead) || 0;
  const cacheWrite = Number(usage.cacheWrite) || 0;
  const prompt = input + cacheRead + cacheWrite;
  if (prompt <= 0) return null;
  return Math.round((cacheRead / prompt) * 100);
}

export function repoBasename(cwd) {
  if (!cwd) return "";
  const normalized = String(cwd).replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? "";
}

export function latestAssistantUsage(entries) {
  if (!Array.isArray(entries)) return null;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry?.type !== "message") continue;
    const message = entry.message;
    if (message?.role !== "assistant" || !message.usage) continue;
    return message.usage;
  }
  return null;
}

export function statuslineSegments({ model, remaining, window, branch, repo }) {
  const parts = [`✦ ${model}`, formatContext(remaining, window)];
  if (branch) parts.push(branch);
  if (repo) parts.push(repo);
  return parts;
}

export function formatCacheHit(cache) {
  if (cache == null) return "";
  return ` (${cache}%)`;
}

export function formatStatusline(input) {
  return `${statuslineSegments(input).join(" · ")}${formatCacheHit(input.cache)}`;
}

export function truncateToWidth(text, width) {
  const plain = stripAnsi(text);
  if (width <= 0) return "";
  if (plain.length <= width) return text;
  if (width === 1) return "…";
  return `${plain.slice(0, width - 1)}…`;
}
