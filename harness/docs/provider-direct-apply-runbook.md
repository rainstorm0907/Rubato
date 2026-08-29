# provider 직결 전환 적용 절차

이 문서는 shadow 워크트리에서 검증한 provider 직결 전환을 **라이브 설치로 옮기는 순서**다.
설계 근거는 [`provider-direct-routing-design.md`](provider-direct-routing-design.md), 삭제·개명
계약은 [`rubato-engine-cutover-manifest.md`](rubato-engine-cutover-manifest.md)를 봐라. 여기는
"무엇을 왜"가 아니라 "어떤 순서로, 무엇을 확인하며"만 적는다.

## 이 기기에 있는 세 클론

세 개가 서로 다른 것을 가리키고, 그것을 섞으면 사고가 난다.

| 경로 | 무엇 | 이 전환에서 |
|---|---|---|
| `~/Github-repos/rubato-provider-direct-shadow` | 이 작업의 워크트리 (`feat/provider-direct-shadow`) | **원본** |
| `~/Github-repos/Rubato` | `rubato` 명령이 실행하는 설치본 | **적용 대상** |
| `~/Github-repos/agent-taskforce/rubato` | 공유 브릿지(pid)가 실행 중인 클론 | 마지막에 별도 판단 |

LaunchAgent(`~/Library/LaunchAgents/dev.rubato.bridge.plist`)는
`~/Github-repos/rubato/harness/scripts/start.sh` 를 가리킨다. **shadow가 아니다.** 그래서
shadow에서 무엇을 지워도 살아 있는 listener는 죽지 않았다 — 작업 중 그 사실을 서브에이전트가
확인해서 내 반대 가정을 정정했다.

## 순서

### 0. 다른 세션을 확인한다

```sh
ps -ax -o pid=,etime=,command= | rg "senpi/dist/cli.js" | rg -v "rg "
```

돌고 있는 세션이 있으면 그 세션들이 이 전환 중에 자격증명 저장소를 만질 수 있다. 급하지 않으면
비었을 때 한다.

### 1. shadow의 검증 상태를 다시 찍는다

옮기기 전에 원본이 초록인지 확인한다. 남의 기억이 아니라 지금 명령으로.

```sh
cd ~/Github-repos/rubato-provider-direct-shadow
( cd harness/rubato-pi && node --test test/unit/*.test.mjs )   # 450 pass 0 fail
bun test patch-tests                                            # 180 pass 0 fail
```

실 vendor 검증은 자격증명이 필요하고 vendor 왕복이 20분쯤 걸린다. 마지막 기록으로 갈음해도
되지만, 옮긴 뒤 2단계에서 라이브로 다시 돌린다.

```sh
( cd harness/rubato-pi && node test/smoke/direct-real.mjs )
```

이 러너의 판정 규칙을 알고 읽어라. **SKIP은 자격증명을 못 쓴다는 뜻이고 FAIL은 쓸 수 있는
자격증명으로 gate가 깨졌다는 뜻이다.** 둘을 섞어 읽으면 없는 회귀를 믿게 된다 — 실제로 독립
리뷰가 만료된 Codex 토큰의 FAIL을 코드 회귀로 판정한 적이 있다.

### 2. 라이브 클론에 옮긴다

shadow는 브랜치가 있고 커밋돼 있으므로 git으로 옮긴다. **손으로 파일을 복사하지 않는다** —
삭제가 7,000줄 넘고 빠뜨리면 반쪽 상태가 된다.

```sh
cd ~/Github-repos/Rubato
git remote add shadow ~/Github-repos/rubato-provider-direct-shadow   # 최초 1회
git fetch shadow feat/provider-direct-shadow
git switch -c provider-direct shadow/feat/provider-direct-shadow
```

`main` 에 바로 넣지 않는다. 브랜치에서 아래 확인을 통과한 뒤 병합한다.

벤더 패치가 25개 series다. 설치본에 반영한다:

```sh
bun install
node postinstall.mjs        # "+25 series patches"
node postinstall.mjs        # 두 번 돌려 같은 결과인지 (멱등)
```

### 3. 자격증명을 다시 만든다

**이것이 이 전환에서 사용자 손이 필요한 유일한 단계다.**

`~/.rubato-pi/agent/auth.json` 에 broker 시절 sentinel이 남아 있을 수 있다.
`access: "local"`, `refresh: "rubato-broker"` 가 그것이고, 실 토큰이 아니라 "bridge로 보내라"는
표지다. 지금은 bridge가 없으니 무의미하다.

확인:

```sh
node --input-type=module -e 'import fs from "node:fs";import os from "node:os";import path from "node:path";
const j=JSON.parse(fs.readFileSync(path.join(os.homedir(),".rubato-pi/agent/auth.json"),"utf8"));
for(const[k,v]of Object.entries(j))console.log(k.padEnd(20),"accessLen="+String(v.access||"").length,v.expires?new Date(v.expires).toISOString():"")'
```

`accessLen` 이 5면 sentinel이다. 수백~수천이면 실 토큰이다.

sentinel인 provider는 `/login` 을 다시 한다. `rubato` 로 뜬 세션에서 하면 된다 — 2단계를
마쳤으면 broker-overlay가 없으므로 실 vendor OAuth로 간다.

```
/login
```

**손으로 JSON을 편집하거나 토큰을 파일 사이로 복사하지 않는다.** OpenAI는 refresh token을 쓸 때
회전시키므로, 같은 토큰을 두 저장소가 들면 먼저 갱신한 쪽이 다른 쪽을 영구히 무효로 만든다.
이 작업 중 실제로 겪었다.

### 4. 라이브에서 확인한다

```sh
cd ~/Github-repos/Rubato/harness/rubato-pi
node --test test/unit/*.test.mjs
node test/smoke/direct-real.mjs
```

그다음 실제로 써 본다. 이것이 유닛보다 중요하다:

```sh
rubato
```

- provider를 두세 개 바꿔 가며 한 턴씩 돌린다 (`/model`)
- 도구를 쓰는 턴을 하나 돌린다 — exec journal이 붙는 경로다
- Kiro 모델로 한 턴 돌린다 — 사이드카 `:8990` 의존이 남은 유일한 자리다

### 5. 브릿지를 물러나게 한다 (선택, 마지막)

여기까지는 저장소에서 bridge를 지운 것이고, **살아 있는 listener는 그대로다.** 다른 클론에서
돌고 있어서 이 작업이 닿지 않았다.

물러나게 하려면 그 클론과 LaunchAgent를 따로 처리해야 하고, 그 순간 **그 브릿지에 붙어 있는
모든 세션이 멈춘다.** 급할 이유가 없으므로 다음 조건이 다 맞을 때 한다:

- 위 1~4단계가 라이브에서 통과했다
- 그 브릿지를 쓰는 다른 세션이 없다
- `agent-taskforce` 정본의 `skills/agent-taskforce/runtimes/pi.md` 를 같이 갱신한다 — 지금 그
  파일은 "모델 호출은 `:8788` broker로 간다"고 적고, 그것은 **라이브 하네스에 대해 아직 맞는
  서술**이다. 브릿지를 물러나게 하는 시점에 함께 고쳐야 에이전트가 없는 경로를 향하지 않는다

## 되돌리기

전부 git 안에 있다.

```sh
cd ~/Github-repos/Rubato
git switch main          # 병합 전이면 이것으로 끝
bun install && node postinstall.mjs
```

병합한 뒤라면 병합 커밋을 되돌린다. 자격증명은 되돌릴 필요가 없다 — 실 토큰은 직결에서도
bridge에서도 같은 파일을 쓴다.

삭제한 Cursor fallback lane을 되살려야 한다면 이 네 파일이다:
`cursor-fallback-route.mjs`, `cursor-opencodex.mjs`, `cursor-authority-lease.mjs`,
`cursor-pi-shapes.mjs`.

## 옮긴 뒤 달라지는 것

- **Cursor에 우회가 없다.** HTTP/2로 `api2.cursor.sh` 에 닿지 못하는 망에서는 Cursor 경로가
  없고, 오류가 그 사실을 말한다(`Cursor requires HTTP/2 ...; there is no proxy fallback.`).
  이 기기에서는 native canary가 통과했다 — `~/.rubato-pi/agent/cursor-activation.json` 의
  `route: "native"`, `modelCount: 113` 이 그 기록이다. **다른 망은 그 망에서 확인해야 한다.**
- **OpenCodex `:10100` 을 더 쓰지 않는다.** 사용자의 OpenCodex 설치와 `~/.opencodex` 는
  건드리지 않았으므로 그 도구 자체는 계속 쓸 수 있다.
- **Kiro ensure는 첫 `kiro/*` 호출에만 돈다.** 세션 시작은 자격만 `heal`하고 Docker는
  띄우지 않는다. Codex나 xAI로 여는 세션이 Kiro 복구를 기다리지 않는다.
- **`RUBATO_CLAUDE_ACCOUNT` 가 정식 이름이다.** 예전 `FX_CLAUDE_ACCOUNT` 는 정식 이름이 없을
  때만 읽히고 한 번 알린다. 배포 대상이 다 옮겨지면 그 fallback을 제거한다.

## 미해결을 알고 옮긴다

- **Antigravity 3턴 이어짐이 실패한다.** `Cannot read properties of undefined (reading
  'includes')`. 다른 다섯 provider는 실 vendor 호출로 통과했으므로 Antigravity를 쓰지 않는다면
  옮겨도 된다. 쓴다면 이것이 고쳐진 뒤에 옮겨라.
- **`openai-codex-fast` 의 `service_tier` 계약이 실 wire로 미계측이다.** 유닛 커버리지는 있다.
  모델은 정상 응답한다.
- **`cursorCatalogGeneration` 이 모델 id만 해시한다.** 자식이 카탈로그를 다시 받지는 않지만,
  context window 같은 descriptor 필드가 바뀌어도 generation이 같다.
