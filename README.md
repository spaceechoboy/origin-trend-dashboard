# origin-trend-dashboard

Origin/LGNS 조직도 지표의 **추세 + 라이브** 정적 대시보드. 의존성 0 · 빌드 0 · 파일만 올리면 GitHub Pages에서 그대로 돕니다.

- `index.html` — 단일 파일 대시보드(인라인 CSS/JS, 인라인 SVG 차트, 라이브러리 없음)
- `data/series.json` — 사이트가 읽는 공개 시계열(커밋에 포함)
- `tools/export_series.mjs` — 배치 스냅샷 → `data/series.json` 생성기

## 데이터 출처와 갱신

원천은 조직도 야간 배치(일 1회)가 쌓는 두 로그입니다.

- `backend/batch/data/summary.jsonl` — 스냅샷 1행/회(노드 수·시세·등급 기준 가치·등급별 인원·슬롯·경계)
- `backend/batch/data/drift.jsonl` — 온체인 파라미터 기록 1행/일(매도세·할인 배수·진입 한도)

갱신은 두 줄입니다.

```sh
node tools/export_series.mjs                       # 기본 경로 사용
node tools/export_series.mjs <summary.jsonl> <drift.jsonl>   # 경로 지정
git add data/series.json && git commit -m "chore: 시계열 갱신"
```

라이브 값(시세·매도세·진입 한도)은 **브라우저가 공개 RPC를 직접 호출**합니다. 빌드 단계에는 네트워크가 필요 없습니다.

## 공개 범위

산출 데이터는 **집계와 순위만** 담습니다. 지갑 주소는 들어가지 않습니다 — 슬롯은 `1`~`6`+`rest` 순위로만 식별하고, spine·경계 지갑 목록은 아예 내보내지 않습니다. `index.html` 안의 `0x…`는 전부 공개 온체인 컨트랙트 주소입니다.

```sh
grep -cE '0x[0-9a-fA-F]{40}' data/series.json   # 0 이어야 정상
node --test tools/export.test.mjs
```

## 한계

- 수량·인원·점유율은 전부 **야간 스냅샷 시점** 값이며, 화면의 「지금 기준」 가치는 그 수량에 라이브 시세만 곱한 **추정치**입니다.
- 「신규」는 두 스냅샷의 노드 수 차이(관측 신규)이지 가입 이벤트가 아니고, 마일스톤 도달일은 **선형 외삽**입니다.
- V6 등급 판정 규칙은 미확정이라 V6 인원은 참고치이며, 등급 기준 가치는 지갑 자산 표시 합계와 성분이 다릅니다.

## 로컬 확인

`file://` 로는 `fetch`가 막힙니다. 정적 서버로 여십시오.

```sh
python3 -m http.server 8123
open http://localhost:8123/
```
