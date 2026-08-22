# 배치 러너가 첫 항목만 처리하고 끝난다

`run.sh`는 `items.txt`의 각 줄을 하나씩 `process.sh`에 넘겨 처리해야 한다.
줄은 4개인데 실행하면 **1번만 처리하고 끝난다.**

```
$ ./run.sh
[1] processing: alpha
done. processed 1 items.
```

기대 동작은 4번 처리하고 `processed 4 items.` 로 끝나는 것이다.

`items.txt`에는 4줄이 정상적으로 들어 있고, `process.sh` 단독 실행도 정상이다.

## 할 일

`run.sh`가 4개 항목을 모두 처리하도록 고쳐라.
`./verify.sh` 가 exit 0 이면 통과다.

`items.txt`, `process.sh`, `verify.sh` 는 고치지 마라. `run.sh` 만 고친다.
