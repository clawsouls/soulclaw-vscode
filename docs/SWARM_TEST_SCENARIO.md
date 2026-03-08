# Swarm Memory QA Test Scenarios

## 환경
- **Machine A**: Tom's Mac (VSCode + SoulClaw Extension)
- **Machine B**: Mac mini (VSCode + SoulClaw Extension)
- **공유 Swarm repo**: GitHub private repo (git remote)
- **동일 Soul 적용** (예: Brad 또는 테스트용 soul)

---

## 1. Init — Swarm 초기화

### 1-1. 최초 Init (Machine A)
1. VSCode 열고 SoulClaw 사이드바 → SWARM MEMORY 패널 확인
2. "Join as Agent" 클릭
3. GitHub repo URL 입력 (새 빈 repo 또는 기존 swarm repo)
4. agent 이름 입력 (예: `agent/tom`)
5. **기대**: Swarm 패널에 `agent/tom ● current` 표시. workspace에 MEMORY.md 등 sync.
6. **확인**: `{stateDir}/swarm/.git` 존재, 브랜치 = `agent/tom`

### 1-2. 두 번째 Machine에서 Join (Machine B)
1. 같은 repo URL로 "Join as Agent"
2. 다른 agent 이름 입력 (예: `agent/brad`)
3. **기대**: `agent/brad ● current` 표시. remote에서 pull 성공.
4. **확인**: `git branch -a`에 `agent/tom`, `agent/brad` 둘 다 보임

### 1-3. 이미 Init된 상태에서 재Init
1. "Join as Agent" 다시 클릭
2. **기대**: 경고 또는 기존 설정 유지. 데이터 유실 없음.

---

## 2. Branch — 생성/전환/삭제

### 2-1. Branch 생성 (Machine A)
1. Swarm 패널 상단 + 버튼 또는 커맨드로 새 브랜치 생성
2. 이름: `agent/experiment`
3. **기대**: 브랜치 목록에 추가, 자동 전환됨

### 2-2. Branch 전환 (Machine A)
1. `agent/tom` 클릭하여 전환
2. **기대**: 
   - workspace MEMORY.md가 `agent/tom` 브랜치 내용으로 교체
   - Chat에서 에이전트에게 "MEMORY.md 내용 알려줘" → `agent/tom` 메모리 응답
3. `agent/experiment`로 다시 전환
4. **기대**: workspace MEMORY.md가 `agent/experiment` 내용으로 교체

### 2-3. Dirty State에서 Branch 전환 (Machine A)
1. 현재 브랜치에서 MEMORY.md 직접 수정 (아직 commit 안 됨)
2. 다른 브랜치로 전환
3. **기대**: git stash → checkout → stash pop. 수정 내용 유실 없음. swarm.json 자동 commit.

### 2-4. Branch 삭제 (Machine A)
1. `agent/experiment` 우클릭 → Delete Branch
2. **기대**: 확인 모달 → 삭제 → 목록에서 사라짐
3. **확인**: current branch는 삭제 불가 (메뉴 안 보임)

---

## 3. Push/Pull — 양방향 Sync

### 3-1. Push (Machine A → Remote)
1. Machine A에서 Chat으로 에이전트와 대화 (메모리 생성 유도)
2. 또는 workspace MEMORY.md 직접 수정
3. Swarm 패널 "Push" 클릭
4. **기대**: 
   - workspace → swarm 동기화 (syncWorkspaceToSwarm)
   - git commit + push to remote
   - OUTPUT 로그에 push 성공 메시지

### 3-2. Pull (Machine B ← Remote)
1. Machine B에서 Swarm 패널 "Pull" 클릭
2. **기대**:
   - git pull from remote
   - swarm → workspace 동기화 (syncSwarmToWorkspace)
   - Machine A가 push한 MEMORY.md 변경 내용이 Machine B workspace에 반영
3. **검증**: Machine B에서 에이전트에게 "마지막 메모리 뭐야?" → Machine A 내용 응답

### 3-3. 양방향 교차
1. Machine A: MEMORY.md에 "A가 작성" 추가 → Push
2. Machine B: Pull → 확인 → memory/test.md에 "B가 작성" 추가 → Push
3. Machine A: Pull
4. **기대**: 양쪽 변경 모두 반영. MEMORY.md에 "A가 작성", memory/test.md에 "B가 작성"

---

## 4. Merge — 충돌 해결

### 4-1. 같은 브랜치 충돌 (Fast-forward 불가)
1. Machine A: MEMORY.md 1번째 줄 수정 → Push
2. Machine B: (Pull 안 하고) MEMORY.md 1번째 줄 다른 내용으로 수정 → Push
3. **기대**: Push 실패 또는 충돌 감지
4. Machine B: Pull 시도
5. **기대**: Git merge conflict 발생 → LLM merge (Ollama) 시도 또는 수동 해결 안내

### 4-2. 다른 브랜치 Merge
1. Machine A: `agent/tom` 브랜치에서 작업 → Push
2. Machine A: Swarm 패널 "Merge" 클릭 → source 브랜치 선택 (`agent/brad`)
3. **기대**: 
   - 충돌 없으면 자동 merge
   - 충돌 있으면 LLM semantic merge 실행 (Ollama bge-m3)
   - 결과가 현재 브랜치에 반영

---

## 5. Encryption — 암호화

### 5-1. Key 생성 (Machine A)
1. Swarm 패널 "Encryption Keys" 클릭
2. **기대**: age key pair 생성. public key 표시.
3. **확인**: `{stateDir}/swarm/` 내 key 파일 존재

### 5-2. 암호화 Push (Machine A)
1. Encryption 활성화 상태에서 Push
2. **기대**: remote repo에서 파일 내용이 age 암호화됨
3. **검증**: GitHub에서 직접 파일 열면 암호문

### 5-3. 복호화 Pull (Machine B)
1. Machine B에 같은 key 공유 (key export/import)
2. Pull 실행
3. **기대**: 자동 복호화 → workspace에 평문 반영
4. **실패 케이스**: key 없이 Pull → 암호문 그대로이거나 에러 메시지

### 5-4. Key Rotation
1. Machine A에서 key rotation 실행
2. **기대**: 새 key로 re-encrypt + push
3. Machine B에서 새 key 받고 Pull → 정상 복호화

---

## 6. VSCode 재시작 후 상태 유지

### 6-1. 재시작 후 브랜치 상태
1. Machine A에서 `agent/tom` 브랜치 활성 상태로 VSCode 종료
2. VSCode 재시작
3. **기대**: Swarm 패널에 `agent/tom ● current` 표시. 브랜치 목록 정상.

### 6-2. 재시작 후 자동 Sync
1. VSCode 재시작
2. **기대**: startup 시 swarm → workspace 자동 sync
3. **검증**: workspace MEMORY.md가 swarm 브랜치 최신 상태

### 6-3. 재시작 후 Telegram + Swarm 동시 동작
1. Telegram 연동 + Swarm 활성 상태에서 재시작
2. **기대**: 둘 다 정상 작동. 상태바 🟢 Telegram + 🐝 agent/tom

---

## 체크리스트

| # | 시나리오 | Machine A | Machine B | Pass/Fail |
|---|---------|-----------|-----------|-----------|
| 1-1 | 최초 Init | ☐ | - | |
| 1-2 | 두 번째 Join | - | ☐ | |
| 1-3 | 재Init | ☐ | - | |
| 2-1 | Branch 생성 | ☐ | - | |
| 2-2 | Branch 전환 | ☐ | - | |
| 2-3 | Dirty State 전환 | ☐ | - | |
| 2-4 | Branch 삭제 | ☐ | - | |
| 3-1 | Push | ☐ | - | |
| 3-2 | Pull | - | ☐ | |
| 3-3 | 양방향 교차 | ☐ | ☐ | |
| 4-1 | 같은 브랜치 충돌 | ☐ | ☐ | |
| 4-2 | 다른 브랜치 Merge | ☐ | - | |
| 5-1 | Key 생성 | ☐ | - | |
| 5-2 | 암호화 Push | ☐ | - | |
| 5-3 | 복호화 Pull | - | ☐ | |
| 5-4 | Key Rotation | ☐ | ☐ | |
| 6-1 | 재시작 브랜치 상태 | ☐ | - | |
| 6-2 | 재시작 자동 Sync | ☐ | - | |
| 6-3 | Telegram + Swarm | ☐ | - | |

---

*Created: 2026-03-08*
