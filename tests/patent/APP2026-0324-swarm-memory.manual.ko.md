# 특허 테스트 프로토콜 — APP2026-0324 (Swarm Memory)

확장 프로그램 개발 호스트(Extension Development Host)에서 Tom이 직접
단계별로 따라가며, Swarm Memory 특허의 7개 청구항 구성요소를 하나씩
검증할 수 있도록 만든 수동 워크스루입니다. 각 `§` 섹션의 번호는
특허 명세서의 청구항 구성요소 번호와 1:1로 대응됩니다 — 모든
"예상 결과"는 해당 번호로 추적됩니다.

---

## 사전 준비

- **두 개의** VS Code 창을 서로 다른 로컬 워크스페이스에서 실행 —
  같은 팀의 두 에이전트를 시뮬레이션. 이하 `agent-A`, `agent-B`로
  지칭.
- `feature/embedded-engine` 빌드가 로드된 Extension Development
  Host.
- 두 창 모두에서 접근 가능한 임시 리모트 git 저장소. 가장 간단한
  방법:

        mkdir -p /tmp/swarm-remote && git -C /tmp/swarm-remote init --bare

  그리고 swarm git URL로 `file:///tmp/swarm-remote` 사용.
- `age` 바이너리 설치 (암호화 swarm 테스트용). 암호화가 필요한
  단계는 별도로 표시되며, 그 외에는 평문 리모트로 충분.

---

## § 구성요소 ① — VCS 기반 저장소

**목표:** swarm이 메모리 내부 저장소가 아닌 실제 git 저장소에
영속화됨을 증명.

1. `agent-A`에서 Swarm 패널을 열고 **"Init Swarm"** 실행.
2. 주소로 `file:///tmp/swarm-remote` 지정 후 기본값으로 진행.
3. 초기화 완료 후 실행:

        git -C /tmp/swarm-remote log --all --oneline

   **예상 결과:** 하나 이상의 커밋 존재, `branches --all`에
   메인 브랜치 보임. 브랜치에 `.soulscan/swarm.json` 포함.

---

## § 구성요소 ② — 에이전트별 브랜치

**목표:** 각 에이전트가 자신의 독립된 브랜치로만 push함.

1. `agent-A`에서 **"Join Swarm"** 실행, 에이전트 이름 `alice`.
2. `agent-B`에서 같은 `/tmp/swarm-remote`에 대해 **"Join Swarm"**
   실행, 에이전트 이름 `bob`.
3. 양쪽 join 완료 후:

        git -C /tmp/swarm-remote branch --all

   **예상 결과:** `agent/alice`, `agent/bob` 브랜치 둘 다 존재.
   어느 쪽도 상대 브랜치에 쓰지 않음. 만약 확장 프로그램이 어느
   한쪽에서 `main` 또는 상대 브랜치로 fallback 한다면 본 구성요소
   FAIL — 하드닝된 `pushWithSync`가 fallback을 반드시 거부해야 함.

---

## § 구성요소 ③ — 변경 감지

**목표:** 워크스페이스 파일 편집이 swarm 동기화를 트리거함.

1. `agent-A`에서 `SOUL.md` 편집 후 저장.
2. 약 2초 이내에 FileSystemWatcher가 `agent/alice`로 커밋 + push
   해야 함.
3. `agent-B`에서 **"Pull Swarm"** 실행.

   **예상 결과:** `agent-B` 워크스페이스의 `SOUL.md`에
   `agent-A`의 편집 내용이 반영됨.

**음성 테스트(Negative):** `.git/`, `.soulscan/` (단 `swarm.json`
제외), `.age` 아래 파일을 건드림. Watcher가 이들에 대해서는 sync
fire를 절대 하지 않아야 함 — 하드닝된 패턴 무시 목록에 등록되어
있음.

---

## § 구성요소 ④ — 공유 브랜치 병합

**목표:** 에이전트 브랜치들이 공통 `swarm/shared` (또는 `main`)
브랜치로 병합됨.

1. 구성요소 ②, ③ 완료 후, 양 에이전트가 각자 독립된 커밋을
   push한 상태.
2. `agent-A`에서 **"Sync Swarm"** 실행 (또는 watcher 자동 트리거).
3. 확인:

        git -C /tmp/swarm-remote log --all --graph --oneline

   **예상 결과:** `agent/alice`, `agent/bob` 헤드를 부모로 하는
   merge 커밋 존재, 또는 두 헤드가 공유 브랜치로 fast-forward됨.

---

## § 구성요소 ⑤ — 충돌 감지

**목표:** 같은 라인에 대한 동시 편집이 조용히 덮어써지지 않고
감지됨.

1. `agent-A`에서 `SOUL.md` 5번 라인을 `"Alice's edit"`로 수정.
   저장은 하되 자동 sync 대기하지 말고 **수동으로** push 트리거.
2. `agent-B`에서 (pull 전에) 같은 5번 라인을 `"Bob's edit"`로
   수정. 저장 후 push.
3. 어느 한쪽에서 **"Sync Swarm"** 실행.

   **예상 결과:** 확장 프로그램이 `SOUL.md` 충돌 알림을 띄움.
   한쪽 변경을 조용히 수용하면 안 됨.

---

## § 구성요소 ⑥ — LLM 통합 해결

**목표:** ⑤의 내용 기반 충돌이 설정된 LLM으로 해결되고, 내용과
무관한 파일(바이너리, lock 파일, 로그)은 분류기가 LLM 없이 자동
해결함.

1. ⑤의 충돌을 그대로 둔 상태에서 **"Auto-Resolve Conflicts"**
   실행.
2. 출력 채널 관찰.

   **예상 결과 (내용 기반 파일):**
   - 패널이 설정된 LLM 엔드포인트에 `--data-binary @-` 및 stdin
     방식으로 POST — 셸 인젝션이 불가능해야 함 (로그의 호출
     라인에서 직접 확인).
   - 해결된 `SOUL.md`는 양쪽 의도를 병합 (한쪽을 선택하지 않음).
   - 로그에 `LLM resolved: 1` 명시 (last-write 추정이 아닌 명시적
     `totalConflicts` 카운터 사용).

**분류기 서브 테스트:** ⑤를 `SOUL.md` 대신 `package-lock.json`
으로 반복. 예상: `isNonContentFile()` 분류기가 LLM 호출 없이 자동
해결하고, 로그에 각 파일이 `non-content → auto-resolved`로 명시
표시됨.

---

## § 구성요소 ⑦ — 브랜치 동기화

**목표:** ⑥ 해결 이후 양 에이전트 브랜치가 해결된 tip으로
fast-forward됨.

1. 구성요소 ⑤ + ⑥ 완료 후.
2. `agent-A`에서:

        git -C $WORKSPACE_A log agent/alice --oneline | head -3

3. `agent-B`에서:

        git -C $WORKSPACE_B log agent/bob --oneline | head -3

   **예상 결과:** 양쪽 모두 같은 merge/resolution 커밋을 tip에
   보여줌. 공유 브랜치에서 어느 쪽도 divergent 하지 않음.

---

## 리그레션 체크 (v0.8.1 버그 수정 배치)

- **셸 인젝션 제거 확인**: 구성요소 ⑥ 실행 중 확장 프로그램 로그의
  `curl` 호출을 확인. 반드시 `--data-binary @-`로 되어 있어야 하고,
  프롬프트 내용이 argv 목록에 보간되어서는 안 됨.
- **에이전트 브랜치 fallback 방지**: push 실패를 시뮬레이션(리모트
  URL을 일시적으로 망가뜨림)했을 때, push는 반드시 THROW해야 하며
  `main`이나 상대 에이전트 브랜치로 조용히 fallback 하면 안 됨.
- **스테이징 범위**: `joinAgent` 실행 직후 워크스페이스에서
  `git status --porcelain` 실행. `.soulscan/swarm.json` 하나만
  스테이징 되어야 함, 트리 전체가 스테이징 되면 안 됨.
- **삭제 동기화**: `agent-A` 워크스페이스에서 `NOTES.md` 삭제.
  sync 후 `agent-B`가 pull 하면 역시 `NOTES.md`가 삭제되어야 함.
- **Watcher 제외**: `.age` 또는 `.soulscan/` (단 `swarm.json` 제외)
  아래 파일 편집. Watcher가 이들을 무시해야 함.

---

## 합/불 기록 양식

7개 구성요소 각각에 대해 다음 중 하나 기록:

- `PASS` — 관찰된 동작이 예상과 일치
- `FAIL` — 관찰된 동작이 예상과 다름 (스크린샷 + 로그 스니펫 첨부)
- `N/A` — 본 환경에서 해당 구성요소를 실행할 수 없음 (이유 명시 —
  예: `age` 미설치)

완료된 리포트는 `clawsouls-internal/docs/` 하위에
`SWARM_MEMORY_PATENT_TEST_REPORT_<날짜>.md` 로 저장하여 BLT 응답
시 KIPO가 요청할 수 있는 증빙 자료로 보관.
