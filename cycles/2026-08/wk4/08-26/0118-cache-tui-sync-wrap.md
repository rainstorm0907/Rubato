---
date: 2026-08-26
scope: [rubato-pi, prompt-cache, tui, vendor-patches]
type: feature
---

## TL;DR
모델별 프롬프트 캐시의 의미를 TUI에 거짓 없이 표시하고, 한 턴의 도구 사용을 성공·실패 기호가 붙은 한 불릿으로 접었다. Claude broker는 요청한 1시간 sliding TTL을 표시하고, direct OpenAI GPT-5.6은 최소 보장 창을 `Cache ≥`로, Codex 제품·Gemini implicit·Grok은 최근 hit/miss 관측으로만 표시한다. 신규 vendor 파일 patch가 반복 적용될 때 파일 본문을 덧붙이던 idempotency 결함도 막았다.

## Keywords
`prompt-cache` `statusline` `Cache Expired` `turn-work-summary` `vendor-patch` `idempotency`

## 판단 기록
- 모델 이름만으로 TTL을 합치지 않았다. Claude exact sliding, OpenAI GPT-5.6 minimum sliding, 명시적 Google fixed expiry, opaque implicit cache는 서로 다른 의미다.
- Rubato의 실제 모델 shape를 기준으로 정책을 정했다. broker Claude는 `provider: anthropic`, `api: openai-completions`지만 broker catalog가 `cacheRetention: long`을 요청하므로 1시간이다.
- foreground safe-wait에서 TTL을 역산하지 않는다. safety buffer는 사용자 설정이라 표시 시간이 왜곡된다.
- 실패한 도구 이름을 빨갛게 칠하지 않고 `✓`/`✗`로 상태를 표시한다. 긴 이름 목록은 터미널 폭 안에서 `…+N`으로 접는다.
- 신규 파일 patch는 reverse round-trip으로 적용 상태를 판정하면 반복 본문을 정상본으로 오인할 수 있다. 빈 파일에서 각 prefix를 정방향으로 만들어 바이트를 직접 비교한다.

## 검증
- `bun run test:patches`: 75 pass, exit 0.
- statusline + broker 집중 테스트: 80 pass, exit 0.
- `bun run build`: exit 0.
- `node postinstall.mjs` 두 번: 모두 exit 0, `+10 series patches`, drift 없음.
- LSP diagnostics: 변경한 JS/MJS 파일 오류 없음.
- Opus 5 독립 리뷰: 1차 FAIL의 실제 broker 모델 shape, safety buffer, Gemini provider, 폭 초과를 수정한 뒤 재검증 PASS.

## 미결
- `bun test` 전체 병렬 suite는 16,757 pass, 7 skip, 99 fail, 1 error로 exit 1이었다. 삭제된 옛 `system/persona.md` seed를 기대한 이 작업트리의 테스트 1건은 현재 `skills/memory-discipline/SKILL.md` 계약으로 교정했고 집중 실행 5/5가 통과했다.
- 별도 격리에서 reflection finalization 9건은 이번 diff가 건드리지 않은 worktree branch cleanup(`Reflection cleanup incomplete`)에서 실패했다.
- tmux 실패군 중 `packages/tmux-core` 10건은 통과했고 `packages/omo-opencode` 4건은 현재 cmux 환경에서 eager attach 경로를 타며 placeholder 기대와 달랐다. 둘 다 이번 캐시/TUI 변경의 초록 판정 근거로 쓰지 않았다.

## 주의
- 작업트리에는 다른 세션이 만든 omo-senpi/omo-codex 생성물과 onboarding memory 경로 변경도 함께 있었고, 사용자가 모든 변경을 푸시하라고 명시해 이번 동기화 커밋에 함께 포함한다.
