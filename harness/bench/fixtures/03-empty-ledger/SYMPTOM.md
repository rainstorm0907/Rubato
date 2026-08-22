# 사용량 원장(ledger)이 계속 비어 있다

`collector.js` 는 업스트림(`relay.js`)이 보내는 SSE 스트림을 받아
generation 단위 토큰 사용량을 `ledger.jsonl` 에 기록한다.

요청은 정상적으로 처리되고 응답 본문도 제대로 온다. 그런데 `ledger.jsonl` 에는
`{"kind":"incident","completeness":"incomplete"}` 만 쌓이고 실제 사용량 레코드가 **한 건도 없다.**

```
$ ./run.sh
response ok: 42 chars
$ cat ledger.jsonl
{"kind":"incident","completeness":"incomplete"}
```

`collector.log` 에는 이런 줄이 남는다.

```
usage dropped: reason=generation_identity_missing
```

토큰 수치 자체는 relay 가 분명히 내려보내고 있다.

## 할 일

`ledger.jsonl` 에 `{"kind":"generation", ...}` 레코드가 토큰 수치와 함께 쌓이도록 고쳐라.
`collector.js` 는 업스트림 계약을 구현한 쪽이므로 **고치지 마라.** `relay.js` 만 고친다.

`./verify.sh` 가 exit 0 이면 통과다. `verify.sh`, `collector.js` 는 고치지 마라.
