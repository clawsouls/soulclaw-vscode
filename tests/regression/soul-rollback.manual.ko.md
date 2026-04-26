# 리그레션 테스트 프로토콜 — SoulRollback

확장 프로그램 개발 호스트에서 Tom이 직접 따라가며 SoulRollback의
6개 기능 구성요소를 하나씩 검증할 수 있도록 만든 수동 워크스루.
구성요소 ③ (다층 오염 감지)은 자동 노드 테스트로도 함께 커버되며
— 본 문서는 유닛 테스트가 건드릴 수 없는 VS Code 가시(可視) 면을
다룹니다.

③의 자동 파트는 다음으로 실행:

    npx tsx tests/regression/soulscan.test.ts

위 명령이 exit 0으로 끝난 다음에야 본 수동 프로토콜을 시작합니다.

---

## 사전 준비

- `feature/embedded-engine` 빌드가 로드된 Extension Development
  Host.
- 최소 `soul.json` + `SOUL.md`를 포함한 워크스페이스
  (`tests/regression/fixtures/clean-soul/`를 임시 워크스페이스로 복사
  해서 시작 — 픽스처 자체를 변형하지 말 것).
- `tests/regression/fixtures/contaminated-soul/` 디렉터리는 구성요소
  ③의 붙여넣기 소스로 사용.

---

## § 구성요소 ① — 체크포인트 저장

**목표:** 사용자 요청 시, 확장 프로그램이 매니페스트와 함께 soul
파일 전체 스냅샷을 `.clawsouls/checkpoints/<id>/`에 기록.

1. 임시 워크스페이스(클린 soul)를 엶.
2. Checkpoints 패널에서 **"Create Checkpoint"** 클릭.
3. 라벨로 `baseline-clean` 입력.
4. 디스크 확인:

        ls .clawsouls/checkpoints/<id>/
        cat .clawsouls/checkpoints/<id>/checkpoint.json

   **예상 결과:**
   - 디렉터리에 캡처 시점의 모든 `SOUL_FILES` 사본이 존재.
   - `checkpoint.json`에 `id`, `label="baseline-clean"`,
     `createdAt`, `fileCount`, `scanScore`, `hashes` 맵 (파일당
     SHA-256) 포함.

**해시 검증 서브 테스트:** `.clawsouls/checkpoints/<id>/` 내 임의
파일에 수동으로 1바이트 추가. 이후 구성요소 ④의 복원 경로에서
해시 불일치 경고와 함께 해당 체크포인트 로드를 거부해야 함.

---

## § 구성요소 ② — 체크포인트 이력 생성 및 관리

**목표:** 타임스탬프로 인덱싱되고 TreeDataProvider로 렌더링되는
시간순 체크포인트 이력 축적.

1. 임시 워크스페이스에서 **5개**의 체크포인트를 서로 다른 라벨
   (`state-1` … `state-5`)로 생성. 약 5초 간격으로 생성하여
   ISO-8601 id가 달라지도록.
2. 디스크 확인:

        ls -1 .clawsouls/checkpoints/ | sort

   **예상 결과:** 5개 디렉터리, 시간순 정렬. 각각 `checkpoint.json`
   에 `label`, `timestamp`, `id`, `files`, `hashes`, `score` 포함.
3. Checkpoints 패널 열기.

   **예상 결과:** 트리가 5개 엔트리를 **최신순**으로 렌더링. 설명
   텍스트에 `<date> · <fileCount> files · <✅/⚠️/❌> <score>` 표시
   (`checkpointPanel.ts`의 `CheckpointNode` 렌더러 참조).

**음성 테스트 (손상 항목 스킵):** 임의의 체크포인트 디렉터리에서
`checkpoint.json`만 삭제, 다른 파일은 유지. `loadCheckpoints()`가
예외 없이 해당 항목을 건너뛰어야 함 — 나머지 4개는 정상 렌더링.

(`MAX_CHECKPOINT_HISTORY = 50` 보관 상한은 아래 "리그레션 체크"
섹션에서 별도로 검증.)

---

## § 구성요소 ③ — 다층 오염 감지 파이프라인

**목표:** 다층 오염 감지 파이프라인 실행. 현재 구현은 마켓플레이스
README "Run 4-layer contamination detection on any checkpoint"
문구에 부합하는 **4개 계층**을 노출함:

| # | 계층 | 구현 | 활성 조건 |
|---|------|------|-----------|
| 1 | SECURITY (53건 규칙) | `SECURITY_RULES` 정규식 배터리 | 항상 |
| 2 | PII (2건 규칙) | `PII_RULES` 정규식 배터리 | 항상 |
| 3 | QUALITY (11건 규칙) | `soul.json` / `SOUL.md` 구조/스키마 | 항상 |
| 4 | INTEGRITY | 호출자 제공 `expectedHashes` vs SHA-256 비교 | 옵트인 (체크포인트 컨텍스트) |

(자동 테스트 `soulscan.test.ts`가 4개 계층 전부 커버. 본 수동
단계는 VS-Code-가시 면을 검증.)

1. 임시 워크스페이스에서 `SOUL.md`를 열고
   `tests/regression/fixtures/contaminated-soul/SOUL.md`의 전체 내용을
   맨 아래에 붙여넣고 저장.
2. SoulScan 패널에서 **"Run Scan"** 클릭.

   **예상 결과:**
   - 결과 헤더에 4개 레이어 카운트 표시: Security (≥3), PII (≥2),
     Quality (≥1), Integrity (체크포인트 컨텍스트 유무에 따라 0 또는
     ≥1).
   - 각 이슈 행에 올바른 카테고리 배지 (SEC / PII / QUA / INT)
     표시. 규칙 id prefix와 카테고리 일치 — 자동 "multi-layer
     separation" 테스트가 보증.
3. `score` 확인 — 90 미만으로 낮아져야 함 (A-band 탈락).

**Integrity 계층 서브 테스트:** 임시 워크스페이스 터미널에서 실행:

        npx tsx -e "const s = require('./out/engine/soulscan'); \
            console.log(s.scanSoulFiles('.', { expectedHashes: { \
            'SOUL.md': '0'.repeat(64) } }).categories);"

   **예상 결과:** 출력 `categories`에 `integrity: 1`. 옵트인 4번째
   계층이 연결되어 해시 불일치 시 fire함을 증명.

---

## § 구성요소 ④ — 오염 판정

**목표:** `CLEAN_THRESHOLD` (= 75) 미만 점수는 해당 체크포인트를
"안전한 복원 앵커가 아님"으로 플래그함.

1. ③ 이어서 — 오염된 워크스페이스 상태.
2. `after-contamination` 라벨로 체크포인트 생성.
3. `checkpoint.json` 확인 — `scanScore`가 75 미만이어야 함.
4. Checkpoints 패널 재열기.

   **예상 결과:** `after-contamination` 엔트리가 시각적으로
   오염 표시됨 (아이콘 / 툴팁). 구성요소 ⑥의 자동 복원 대상으로
   절대 선택되어선 안 됨.

---

## § 구성요소 ⑤ — 최초 오염 발생 시점 식별

**목표:** 오염이 최초로 발생한 시점 식별. 이 단계는
`diffCheckpoint()` 커맨드 (내부적으로 `vscode.diff(cpUri, curUri)`
호출)에 매핑됨 — 검토자가 인접 체크포인트들을 diff 뷰로 비교
하여 최초 오염 시점을 시각적으로 식별.

1. 단일 임시 워크스페이스에서 의도적 타임라인 구성:

   1. 클린 상태로 시작. 체크포인트 `t0-clean`.
   2. 오염 붙여넣기. 체크포인트 `t1-dirty`.
   3. 추가 오염 편집. 체크포인트 `t2-dirtier`.
   4. (t1과 t2 사이에 정리 절대 안 함.)

2. Checkpoints 패널에서 `t0-clean` 우클릭 → **"Compare with
   current"** (또는 팔레트에서 `clawsouls.checkpoint.diff` 실행,
   `t0-clean` 선택). `t1-dirty`에도 반복.

   **예상 결과:**
   - `vscode.diff`가 워크스페이스와 side-by-side로 열림.
   - `t0-clean` 대비 diff에 모든 오염 라인이 추가로 표시됨.
   - `t1-dirty` 대비 diff에는 3단계에서 추가된 오염만 표시됨.
   - 이 diff들을 훑어보면 검토자가 `t1-dirty`를 최초 오염
     체크포인트로, `t0-clean`을 식별된 오염 시점 **직전**의
     체크포인트로 식별 가능.

3. 자동 복원 경로: 팔레트에서 `ClawSouls: Checkpoint — Auto-Restore`
   실행.

   **예상 결과:** 확장 프로그램이 `t0-clean`을 복원 대상으로
   선택 — `t1-dirty`(최초 오염 시점) 직전의 체크포인트. 대신
   `t2-dirtier`로 복원하거나 최신 오염 체크포인트를 조용히 지나
   치면 구성요소 ⑤ FAIL.

**용어 주의:** 복원 대상은 "식별된 시점 **직전의** 체크포인트"
이며, 식별된 오염 시점에 상대적으로 정의됨. 절대 기준 "가장 최근
클린 앵커"로 정의되지 않음. 히스토리가 연속적 clean → dirty일 때
두 정의는 일치하지만, 의도적으로 clean → dirty → clean → dirty
타임라인을 만들면 *가장 이른* dirty 직전으로 복원해야 하며
최신-clean이 아님. PASS/FAIL 행에 편차를 명시.

---

## § 구성요소 ⑥ — 식별된 시점 직전의 체크포인트 기준 복원

**목표:** §⑤에서 식별된 오염 시점 **직전**의 체크포인트를 기준
으로 복원. SHA-256 해시 검증 및 사전 안전 스냅샷 기록은 하드닝
추가 사항.

1. ⑤ 이어서 — 히스토리에 `t0-clean`, `t1-dirty`, `t2-dirtier`
   존재.
2. 자동 복원 다이얼로그 확인.

   **예상 결과, 순서대로:**
   1. 새로운 silent 체크포인트 `pre-restore-<timestamp>` 생성
      (구성요소 ⑥의 사전 복원 스냅샷 — 복원 완료 후 패널에
      나타남을 확인).
   2. `t0-clean`에서 가져온 각 파일을 해싱하여 `hashes` 맵과 대조.
      불일치 발생 시 복원이 경고와 함께 중단 — 2단계 전에
      `.clawsouls/checkpoints/t0-clean/` 내 파일을 손상시켜
      강제 테스트.
   3. 워크스페이스 soul 파일이 `t0-clean` 내용으로 덮어써짐.
   4. `clawsouls.restartGateway` 호출. 실패 시 v0.8.1 수정에 의한
      경고가 반드시 떠야 함: `"⚠️ Checkpoint restored but engine
      restart failed ..."` — 게이트웨이 포트를 미리 막아 restart
      실패를 강제 유도하여 확인.

3. 복원 성공 후 새로 스캔.

   **예상 결과:** 점수가 A-band (≥90)로 복귀, 보안/PII 이슈 0.

4. 패널에서 `pre-restore-<timestamp>` 체크포인트 열기.

   **예상 결과:** `t2-dirtier` 상태 포함 — 복원 자체가 실수였을
   경우 Tom이 되돌릴 수 있는 escape hatch.

---

## 리그레션 체크 (v0.8.1 롤백 배치)

- **해시 검증 존재**: 체크포인트 파일의 단 1바이트 손상/삭제 후
  복원 시도. 반드시 거부.
- **보관 상한 강제 (MAX_CHECKPOINT_HISTORY = 50)**: 체크포인트
  **52개** 생성 (스크립트 또는 heartbeat 활용, 라벨 `auto-1` …
  `auto-52`). 실행 `ls -1 .clawsouls/checkpoints/ | wc -l` —
  정확히 50 반환해야 함. 가장 오래된 2개 (`auto-1`, `auto-2`)가
  디스크에서 제거됨.
- **사전 안전 스냅샷**: 복원이 파일을 덮어쓰기 전에
  `createCheckpointSilent` 경로가 반드시 실행되어야 함.
- **Restart 실패 UI 노출**: `clawsouls.restartGateway`가 throw할
  때 경고 배너가 보이는지 확인.

---

## 합/불 기록 양식

Swarm Memory 프로토콜과 동일 형식. 서명된 리포트를 해당 빌드의
릴리스 노트와 함께 보관.
