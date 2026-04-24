# 특허 테스트 스위트

당사가 출원한 두 건의 특허의 청구항 구성요소와 1:1로 정렬된
테스트 케이스:

- **APP2026-0324** — Swarm Memory (7개 청구항 구성요소)
- **APP2026-0325** — SoulRollback (6개 청구항 구성요소)

목표: 검토자(사내 또는 사외 — 예를 들어 BLT 지원 자료를 요청하는
KIPO 심사관)가 프로토콜 중 하나를 읽고, 현재
`feature/embedded-engine` 빌드에 대해 각 청구항 구성요소를
기계적으로 재현할 수 있을 것.

---

## 구성 파일

| 파일 | 유형 | 커버 범위 |
|------|------|----------|
| `soulscan.patent.test.ts` | 자동화 (node:test) | APP2026-0325 ③ — 다층 오염 감지 |
| `APP2026-0324-swarm-memory.manual.ko.md` | 수동 프로토콜 | Swarm Memory 7개 청구항 전부 |
| `APP2026-0325-soul-rollback.manual.ko.md` | 수동 프로토콜 | SoulRollback 6개 청구항 전부 |
| `fixtures/clean-soul/` | 픽스처 | 기준선 정상 soul — 감지 0건 기대 |
| `fixtures/contaminated-soul/` | 픽스처 | SEC + PII + QUA 레이어 트리거 — 유닛 테스트 및 수동 ③에서 공용 |

---

## 자동 테스트 실행

devDependency 추가 설치 불필요:

    npx tsx tests/patent/soulscan.patent.test.ts

`tsx`는 `npx -y tsx …`가 필요 시 받아옴. Exit code 0 = 모든 단정
성공. 6개 테스트 커버 항목:

1. 클린 픽스처 → SEC 0, PII 0, A-band 점수.
2. 오염 픽스처 → SEC 레이어 fire.
3. 오염 픽스처 → 올바른 category로 PII 레이어 fire.
4. 오염 픽스처 → QUA 레이어 fire.
5. 레이어 분리 불변: SEC 규칙 id는 `category: 'security'` 아래
   에서만, PII 규칙 id는 `'pii'` 아래에서만, QUA 규칙 id는
   `'quality'` 아래에서만 나타남.
6. 등급 구간 일관성 — 점수→등급 매핑이 WasmClaw 0.5.0 구간
   (A≥90, B≥75, C≥50, D≥25, F<25)과 일치.

---

## 수동 프로토콜 실행

각 `.manual.ko.md`는 번호 매겨진 체크리스트. Extension Development
Host 창에서 순서대로 수행하며 각 `§` 구성요소 옆에 PASS / FAIL /
N/A 기록. 완료 후 각 프로토콜 하단에 제안된 파일명으로 `clawsouls-
internal/docs/`에 복사본 저장 — 그게 곧 BLT 지원 자료 요청 시
심사관 응답에 인용 가능한 증빙이 됨.

---

## 왜 `soulscan`만 자동화했는가

Swarm Memory와 SoulRollback의 대부분은 VS Code 확장 프로그램
표면(TreeDataProvider, FileSystemWatcher, git subprocess,
`vscode.window.show*Message`)임. 이를 유닛 테스트에서 구동하려면
Extension Host가 필요 — `@vscode/test-electron` 도입 및 통합
하네스 설계로 이어져 훨씬 큰 부담. 특허 증빙 용도에는 구조화된
수동 프로토콜이 (a) 만들기 저렴하고 (b) "사람이 30분 안에 확인
가능"이라는 산출물 요건에 더 적합.

`soulscan.ts`는 `vscode` import가 없는 순수 TS — 따라서 빠른
리그레션 게이트 용도로 자동화 대상에 선정.

---

## 스위트를 정확히 유지하기

- 특허 명세서에서 청구항 구성요소 번호를 변경/재번호 부여 시
  수동 프로토콜 파일의 `§` 헤딩을 동시 갱신. 청구항 번호가 정답의
  기준(normative reference).
- 새 SEC / PII / QUA 규칙 카테고리 추가 시 해당 규칙을 트리거
  하는 픽스처 라인 추가 + `soulscan.patent.test.ts`에 대응하는
  단정 추가.
- 수동 `§` 단계가 특정 명령에 의존하게 될 경우 — 예를 들어
  `clawsouls.checkpoint.autoRestore` — 해당 명령 id를 단계에
  명시하여 검토자가 명령 팔레트에서 짐작 없이 실행 가능하도록
  유지.
