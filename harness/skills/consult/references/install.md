# Installation Notes

This skill follows the open Agent Skills layout: a directory containing `SKILL.md` plus optional `scripts/`, `references/`, and `agents/` resources.

## Codex

Install as a personal skill:

```bash
mkdir -p ~/.agents/skills
cp -R consult ~/.agents/skills/consult
```

Or install as a project skill:

```bash
mkdir -p .agents/skills
cp -R consult .agents/skills/consult
```

Install `agbrowse` before using the web execution path:

```bash
npm install -g agbrowse
```

When verified provider drift requires a newer `agbrowse`, review the release evidence and obtain authorization before changing the global install:

```bash
npm install -g agbrowse@latest
```

Use from a desktop session because this skill attaches to one shared local headed Chrome profile. The ZIP includes the owner and runtime checker:

```bash
python3 scripts/check_consult_runtime.py
python3 scripts/ensure_consult_chrome.py --ensure
```

The packaged runtime fixes CDP to `127.0.0.1:9222` and uses `~/.codex/browser-profiles/consult-agbrowse/browser-profile`. Every helper forces `AGBROWSE_WEB_AI_AUTO_START=0`, so `agbrowse` cannot create another browser. `CONSULT_BROWSER_AGENT_HOME` is available only for an intentional installation-level relocation; all concurrent calls must use the same value.

The helper reads the Work project URL from `CONSULT_CHATGPT_URL` first, then from `~/.codex/consult.env`.

Consult packets are sent by file upload by default. The helper saves the latest web-ai `sessionId` in `.consult/agbrowse-consult-session.json` so later follow-up questions can continue the same consult conversation.

Invoke explicitly:

```text
$consult use ChatGPT web through agbrowse for a focused second opinion and save the verified response under .consult/
```

## Claude Code

Install as a personal skill:

```bash
mkdir -p ~/.claude/skills
cp -R consult ~/.claude/skills/consult
```

Or install as a project skill:

```bash
mkdir -p .claude/skills
cp -R consult .claude/skills/consult
```

Claude Code environments without `agbrowse`, Google Chrome, and access to the packaged local headed Chrome owner can still write packet and prompt files, but they cannot complete the required automatic web submission and response capture. Do not fall back to private endpoints, token extraction, hosted browsers, stealth, or API calls.

For explicit-only Claude invocation, add this line to `SKILL.md` frontmatter after installation if your Claude runtime supports it:

```yaml
disable-model-invocation: true
```
