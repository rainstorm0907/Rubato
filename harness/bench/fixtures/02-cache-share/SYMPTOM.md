# alpha 하네스의 캐시 효율이 beta의 절반로 나온다

`usage.jsonl` 에 두 하네스(`alpha`, `beta`)의 provider generation 사용량이 각각 40건씩 있다.
두 하네스는 같은 워크로드를 같은 설정으로 돌렸고, **캐시 효율은 실제로 거의 같아야 한다.**

`analyze.py` 로 cache-read share 를 뽑으면 이렇게 나온다.

```
alpha  cache-read share = 46.7%
beta   cache-read share = 92.0%
```

alpha 쪽 인프라를 뒤져봤지만 캐시가 깨질 만한 원인을 찾지 못했다.
provider 응답 자체는 정상이고, alpha 의 로그에 에러도 없다.

## 할 일

`analyze.py` 가 두 하네스의 cache-read share 를 올바르게 계산하도록 고쳐라.
`usage.jsonl` 은 provider가 준 값 그대로이므로 **데이터를 고치면 안 된다.**

`./verify.sh` 가 exit 0 이면 통과다. `verify.sh` 와 `usage.jsonl` 은 고치지 마라.
