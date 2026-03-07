# ClawSouls Agent — VSCode Extension Test Cases

## 환경 준비
- Windows amd64, Node v24+
- VSCode 1.85+
- `.vsix` 설치: Extensions → `...` → Install from VSIX
- 아무 프로젝트 폴더 열기

---

## 1. Setup Wizard

| # | 테스트 | 기대 결과 | Pass |
|---|--------|-----------|------|
| S-01 | Extension 설치 후 최초 실행 | Setup Wizard 패널 자동 표시 |  |
| S-02 | Anthropic API key 입력 | key 저장, Gateway 연결 시작 |  |
| S-03 | Ollama 선택 → URL 입력 | Ollama 모드로 설정 |  |
| S-04 | 잘못된 API key 입력 | 에러 메시지 표시 |  |
| S-05 | Command Palette → "ClawSouls: Setup" | Setup Wizard 재실행 |  |

---

## 2. Gateway Connection

| # | 테스트 | 기대 결과 | Pass |
|---|--------|-----------|------|
| G-01 | Setup 완료 후 | Status bar "🟢 connected" 표시 |  |
| G-02 | Gateway 연결 끊김 | Status bar "⚪ disconnected" 표시 |  |
| G-03 | "🔄" 버튼 클릭 | Gateway 재시작, 재연결 |  |
| G-04 | Chat 패널에서 연결 상태 확인 | "● Gateway: connected" 실시간 업데이트 |  |

---

## 3. Chat Panel

| # | 테스트 | 기대 결과 | Pass |
|---|--------|-----------|------|
| C-01 | Status bar "💬 Chat" 클릭 | Chat 패널 열림 |  |
| C-02 | 메시지 입력 → Send | 메시지 전송, 유저 메시지 표시 |  |
| C-03 | Enter 키로 전송 | Shift+Enter 없이 Enter만 누르면 전송 |  |
| C-04 | Shift+Enter | 줄바꿈 (전송 아님) |  |
| C-05 | AI 응답 수신 | Assistant 메시지 표시 (마크다운 렌더링) |  |
| C-06 | 긴 대화 후 새 메시지 | 스크롤 점프 없이 메시지 append |  |
| C-07 | Chat 패널 닫기 → 다시 열기 | 이전 대화 내용 유지 (최대 200개) |  |
| C-08 | VSCode 재시작 후 Chat 열기 | 대화 히스토리 유지 |  |
| C-09 | 파일 drag & drop | 파일 내용 텍스트에 삽입 (100KB 이하) |  |
| C-10 | 100KB 초과 파일 drag & drop | 경고 메시지 |  |
| C-11 | 스트리밍 응답 중 | "typing..." 인디케이터 표시 |  |

---

## 4. Status Bar

| # | 테스트 | 기대 결과 | Pass |
|---|--------|-----------|------|
| SB-01 | soul.json 있는 프로젝트 열기 | "🔮 {displayName}" 표시 |  |
| SB-02 | soul.json 없는 프로젝트 열기 | "🔮 No Soul" 표시 |  |
| SB-03 | Soul Explorer에서 soul apply 후 | Status bar soul name 업데이트 |  |
| SB-04 | soul.json 수동 삭제 | "🔮 No Soul"로 변경 |  |
| SB-05 | soul.json 수동 생성/수정 | soul name 자동 업데이트 |  |
| SB-06 | "🐝 agent/main" 표시 확인 | agent 이름 표시 |  |

---

## 5. Soul Explorer

| # | 테스트 | 기대 결과 | Pass |
|---|--------|-----------|------|
| SE-01 | 사이드바 ClawSouls 아이콘 클릭 | Soul Explorer 패널 열림 |  |
| SE-02 | Browse 모드 | 카테고리별 soul 목록 로드 (89개) |  |
| SE-03 | 검색 아이콘 클릭 → 키워드 입력 | 이름/태그/설명 검색 필터링 |  |
| SE-04 | Soul 항목 클릭 → Preview | Webview에 soul 상세 정보 표시 |  |
| SE-05 | Apply 버튼 (☁↓) 클릭 | 확인 다이얼로그 → "Apply" 선택 |  |
| SE-06 | Apply 완료 후 | "✅ Soul applied" 메시지 + Gateway 재시작 |  |
| SE-07 | Apply 후 Chat에서 대화 | 해당 soul 페르소나로 응답 |  |
| SE-08 | Toggle View (로컬/브라우즈) | 로컬 파일 ↔ API 목록 전환 |  |
| SE-09 | Refresh 버튼 | soul 목록 새로고침 |  |

---

## 6. Checkpoint

| # | 테스트 | 기대 결과 | Pass |
|---|--------|-----------|------|
| CP-01 | "ClawSouls: Create Checkpoint" 실행 | 체크포인트 이름 입력 프롬프트 |  |
| CP-02 | 이름 입력 → 생성 | `.clawsouls/checkpoints/{id}/` 에 파일 저장 |  |
| CP-03 | Checkpoints 패널에 목록 표시 | 생성한 체크포인트 보임 |  |
| CP-04 | Restore 버튼 클릭 | 확인 다이얼로그 → soul.json 복원 |  |
| CP-05 | Diff 버튼 클릭 | 파일 선택 → VSCode diff viewer 열림 |  |
| CP-06 | Delete 버튼 클릭 | 체크포인트 삭제 |  |
| CP-07 | 체크포인트 없는 상태 | "No checkpoints" 메시지 |  |
| CP-08 | **저장 위치** | `~/.openclaw/workspace/.clawsouls/checkpoints/`에 저장 (프로젝트 폴더 아님) |  |
| CP-09 | **Restore 후 gateway restart** | 복원 후 gateway 자동 재시작, 에이전트가 복원된 soul 사용 |  |

---

## 7. Swarm Memory

| # | 테스트 | 기대 결과 | Pass |
|---|--------|-----------|------|
| SW-01 | 초기 상태 | "Initialize Swarm Memory" 버튼만 표시 |  |
| SW-02 | Initialize 클릭 → URL 비움 | globalStorage에 로컬 git repo 생성 |  |
| SW-03 | Initialize 클릭 → URL 입력 | git clone 실행 |  |
| SW-04 | 초기화 후 패널 | Join/Push/Pull/Merge/Encryption 버튼 표시 |  |
| SW-05 | "👤 Join as Agent" 클릭 | branch 이름 입력 → `agent/{name}` 생성 |  |
| SW-06 | "⬆ Push" 클릭 | 터미널에서 `npx clawsouls swarm push` 실행 |  |
| SW-07 | "⬇ Pull" 클릭 | 터미널에서 `npx clawsouls swarm pull` 실행 |  |
| SW-08 | "🔀 Merge" 클릭 | branch 선택 → 전략 선택 (Git/LLM) |  |
| SW-09 | Git merge 선택 | 직접 git merge 실행 |  |
| SW-10 | LLM merge 선택 | 터미널에서 `--strategy llm` 실행 |  |
| SW-11 | "🔐 Encryption Keys" 클릭 | QuickPick: init/show/add/list/rotate |  |
| SW-12 | Keys → Init 선택 | 터미널에서 `swarm keys init` 실행 |  |
| SW-13 | Keys → Add 선택 | public key 입력 프롬프트 → 실행 |  |
| SW-14 | Branch 목록 표시 | 현재 branch에 ★ 표시 |  |
| SW-15 | Branch 항목 클릭 | branch 전환 |  |
| SW-16 | **프로젝트 repo 무영향 확인** | `git branch` — agent/* 브랜치 없음 |  |
| SW-17 | 터미널 명령어 구분자 | `;` 사용 (PowerShell 호환) |  |
| SW-18 | **Swarm dir 위치** | `~/.openclaw/swarm/`에 git repo 생성 (globalStorage 아님) |  |
| SW-19 | **Pull 후 workspace sync** | Pull → `~/.openclaw/workspace/`에 메모리 파일 복사됨 |  |
| SW-20 | **Pull 후 gateway restart** | Pull 완료 5초 후 gateway 재시작 |  |
| SW-21 | **Merge 후 workspace sync** | Merge → workspace에 메모리 파일 복사 + gateway 재시작 |  |
| SW-22 | **joinAgent prefix 자동추가** | "brad" 입력 → `agent/brad` 브랜치 생성 |  |
| SW-23 | **Push/Pull 비agent 브랜치 경고** | main 브랜치에서 Push → "not an agent branch" 경고 |  |
| SW-24 | **여러 workspace에서 같은 swarm** | 다른 프로젝트 열어도 같은 `~/.openclaw/swarm/` 참조 |  |

---

## 8. SoulScan

| # | 테스트 | 기대 결과 | Pass |
|---|--------|-----------|------|
| SC-01 | "ClawSouls: Run SoulScan" 실행 | 터미널에서 `npx clawsouls scan` 실행 |  |
| SC-02 | soul.json 있는 프로젝트에서 실행 | 스캔 결과 터미널 출력 |  |
| SC-03 | soul.json 없는 프로젝트에서 실행 | 에러 메시지 |  |

---

## 9. Edit Soul

| # | 테스트 | 기대 결과 | Pass |
|---|--------|-----------|------|
| ES-01 | "ClawSouls: Edit Soul" — soul.json 있음 | soul.json 에디터에서 열림 |  |
| ES-02 | "ClawSouls: Edit Soul" — soul.json 없음 | "Create?" 다이얼로그 → 생성 |  |
| ES-03 | Create 선택 후 | 기본 soul.json 템플릿 생성 + 에디터 열림 |  |

---

## 10. Activity Bar & UI

| # | 테스트 | 기대 결과 | Pass |
|---|--------|-----------|------|
| UI-01 | Activity bar 아이콘 확인 | 새 SVG 아이콘 표시 |  |
| UI-02 | Swarm Memory 패널 이름 | "Swarm Memory" (not "Swarm") |  |
| UI-03 | Swarm Memory 아이콘 | 다이아몬드+화살표 PNG 아이콘 |  |
| UI-04 | 다크 테마에서 전체 UI | 가독성 확인 |  |
| UI-05 | 라이트 테마에서 전체 UI | 가독성 확인 |  |

---

## 11. Cross-Platform

| # | 테스트 | 기대 결과 | Pass |
|---|--------|-----------|------|
| XP-01 | Windows + Anthropic | Chat 정상 동작 |  |
| XP-02 | Windows + Ollama | Chat 정상 동작 |  |
| XP-03 | Mac + Anthropic | Chat 정상 동작 |  |
| XP-04 | Mac + Ollama | Chat 정상 동작 |  |

---

## Summary

| 카테고리 | 항목 수 |
|----------|---------|
| Setup Wizard | 5 |
| Gateway | 4 |
| Chat | 11 |
| Status Bar | 6 |
| Soul Explorer | 9 |
| Checkpoint | 7 |
| Swarm Memory | 17 |
| SoulScan | 3 |
| Edit Soul | 3 |
| UI | 5 |
| Cross-Platform | 4 |
| **Total** | **74** |
