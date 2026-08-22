# consult-chatgpt-pro

A self-contained Agent Skill for consulting ChatGPT GPT-5.6 Pro through the visible web UI with `agbrowse`.

It packages the prompt contract, one-browser/multi-tab runtime, file-based packet transport, submit receipts, response correlation, follow-up history and recovery, code-artifact workflow, tests, and operating references. It does not bundle Chrome, Python, Node.js, or `agbrowse`.

## Requirements

- macOS with Google Chrome
- Python 3
- Node.js
- `agbrowse` 0.1.18 or a compatibility-verified newer release
- A ChatGPT account already signed in through the managed visible Chrome profile

## Install

Clone the repository and link or copy it into an Agent Skills root:

```bash
git clone https://github.com/keepitmello/consult-chatgpt-pro.git
ln -s "$(pwd)/consult-chatgpt-pro" ~/.codex/skills/consult
```

Use a different target root such as `~/.claude/skills/consult` when appropriate. Keep one canonical checkout and link other active skill roots to it.

## Verify

Run from the repository root:

```bash
python3 scripts/check_consult_runtime.py
python3 scripts/ensure_consult_chrome.py --ensure
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -q
```

## Usage

Read `SKILL.md` before using the workflow. The normal runner uploads `--packet` and `--follow-up-file` inputs as attachments; packet bodies are never pasted into the ChatGPT composer. A short literal `--follow-up "..."` may stay inline.

Detailed commands, parallel execution, recent-topic lookup, follow-up, and recovery are documented in `references/runbook.md`.

## Security boundary

The skill automates the visible ChatGPT web UI. It does not use private ChatGPT endpoints, extract cookies or tokens, bypass access controls, or bundle browser credentials. Never put secrets, private keys, customer data, or unnecessary personal data in a consult packet.
