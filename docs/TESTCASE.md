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
| S-06 | Step 4: Soul 브라우저 로딩 | API에서 soul 목록 fetch, 카드 그리드 표시 |  |
| S-07 | Step 4: 검색 입력 | 이름/설명/태그로 실시간 필터링 |  |
| S-08 | Step 4: 카테고리 필터 클릭 | 해당 카테고리만 표시 |  |
| S-09 | Step 4: 인기 soul ⭐ 배지 | 상위 3개에 "Popular" 배지 표시 |  |
| S-10 | Step 3: Soul 카드 클릭 → Next | 선택한 soul이 workspace에 apply |  |
| S-11 | Step 3: "Create Custom" 선택 → Next | Custom soul 생성 플로우 |  |
| S-12 | Step 3: "Start Empty" 선택 → Next | Soul 없이 진행 |  |
| S-13 | Step 3: 다운로드 수/스캔 상태 표시 | 각 카드에 ⬇ count, ✅/⚠️ 배지 |  |
| S-14 | Step 3: API 장애 시 | "No souls found" 표시, Custom/Empty로 진행 가능 |  |
| S-15 | Port 설정 단계 없음 | 4단계 wizard (Provider → Key → Soul → Done) |  |

---

## 2. Engine

| # | 테스트 | 기대 결과 | Pass |
|---|--------|-----------|------|
| E-01 | Setup 완료 후 | Status bar "🟢 connected" 표시 (engine ready) |  |
| E-02 | API key 없음/잘못됨 | Status bar "🔴 error" 표시 |  |
| E-03 | "🔄" 버튼 클릭 | Engine 재시작 |  |
| E-04 | Chat 패널에서 상태 확인 | "● Engine: connected" 실시간 업데이트 |  |
| E-05 | Extension 활성화 즉시 | Engine 즉시 ready (npm install/WS 대기 없음) |  |

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
| C-12 | 코드블록 Apply 버튼 클릭 | Diff 프리뷰 표시 → Accept/Reject 선택 |  |
| C-13 | Apply → Accept 선택 | 코드가 에디터/파일에 적용 |  |
| C-14 | Apply → Reject 선택 | 변경 취소, 원본 유지 |  |
| C-15 | 응답 중 Stop 버튼 클릭 | 스트리밍 즉시 중단, 부분 응답 표시 |  |
| C-16 | 대화 내보내기 (Markdown) | 파일 저장 다이얼로그 → .md 파일 저장 |  |
| C-17 | 대화 내보내기 (JSON) | 파일 저장 다이얼로그 → .json 파일 저장 |  |
| C-18 | Tool 실행 로그 표시 | 🔧 도구명 + 인자 + 결과 실시간 표시 |  |

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
| SC-04 | soul.json 저장 시 자동 스캔 | `scanOnSave` 설정 켜진 상태 → 저장 시 스캔 자동 실행 |  |
| SC-05 | `scanOnSave` 끈 상태에서 저장 | 스캔 실행 안됨 |  |

---

## 9. Security & Safety

| # | 테스트 | 기대 결과 | Pass |
|---|--------|-----------|------|
| SEC-01 | API key 저장 확인 | SecretStorage에 저장됨 (Settings에 평문 아님) |  |
| SEC-02 | 이전 Settings API key → SecretStorage 자동 마이그레이션 | 기존 유저 자동 이전 |  |
| SEC-03 | `rm -rf /` 명령 실행 요청 | 확인 다이얼로그 표시, 거부 가능 |  |
| SEC-04 | `sudo` 명령 실행 요청 | 확인 다이얼로그 표시 |  |
| SEC-05 | `git push --force` 실행 요청 | 확인 다이얼로그 표시 |  |
| SEC-06 | 워크스페이스 외부 파일 쓰기 시도 | 차단 + 에러 메시지 |  |
| SEC-07 | `.env` 파일 읽기 시도 | 경고 메시지 표시 |  |
| SEC-08 | `credentials`, `id_rsa` 등 민감 파일 | 경고 메시지 표시 |  |
| SEC-09 | S-12: Setup에서 API key Validate 버튼 | 실제 API 호출 → 성공/실패 피드백 |  |
| SEC-10 | 잘못된 API key Validate | "Invalid API key" 에러 표시 |  |

---

## 10. Edit Soul

| # | 테스트 | 기대 결과 | Pass |
|---|--------|-----------|------|
| ES-01 | "ClawSouls: Edit Soul" — soul.json 있음 | soul.json 에디터에서 열림 |  |
| ES-02 | "ClawSouls: Edit Soul" — soul.json 없음 | "Create?" 다이얼로그 → 생성 |  |
| ES-03 | Create 선택 후 | 기본 soul.json 템플릿 생성 + 에디터 열림 |  |

---

## 11. Chat History

| # | 테스트 | 기대 결과 | Pass |
|---|--------|-----------|------|
| CH-01 | Chat History 패널 열기 | 과거 세션 목록 표시 |  |
| CH-02 | 세션 항목 클릭 | 해당 세션 대화 내용 Chat에 로드 |  |
| CH-03 | 여러 세션 전환 | 각 세션 히스토리 정확히 표시 |  |

---

## 12. Workspace Tracker

| # | 테스트 | 기대 결과 | Pass |
|---|--------|-----------|------|
| WT-01 | 프로젝트 폴더 열기 | TOOLS.md에 `## Current Project` 섹션 자동 추가 |  |
| WT-02 | 다른 프로젝트로 전환 | TOOLS.md 프로젝트 경로 업데이트 |  |
| WT-03 | Agent 대화에서 프로젝트 컨텍스트 | Agent가 현재 프로젝트 경로 인식 |  |

---

## 13. Code Actions

| # | 테스트 | 기대 결과 | Pass |
|---|--------|-----------|------|
| CA-01 | 코드 선택 → 우클릭 → "Ask SoulClaw" | Chat에 선택 코드 + 질문 프롬프트 |  |
| CA-02 | 코드 선택 → 우클릭 → "Explain This" | Chat에 코드 설명 요청 |  |
| CA-03 | 코드 선택 → 우클릭 → "Fix This" | Chat에 코드 수정 요청 |  |
| CA-04 | 코드 선택 → 우클릭 → "Add to Context" | Context buffer에 추가, Chat에 알림 |  |
| CA-05 | Context buffer에 여러 코드 추가 → Send | 모든 context가 메시지에 포함 |  |
| CA-06 | "Clear Context" 실행 | Context buffer 초기화 |  |
| CA-07 | Cmd+Shift+L 키 바인딩 | Ask SoulClaw 실행 |  |
| CA-08 | Cmd+Shift+; 키 바인딩 | Add to Context 실행 |  |
| CA-09 | 우클릭 → "Refactor" | Chat에 리팩토링 요청 |  |
| CA-10 | 우클릭 → "Generate Test" | Chat에 테스트 코드 생성 요청 |  |
| CA-11 | 우클릭 → "Generate Docs" | Chat에 JSDoc/docstring 생성 요청 |  |
| CA-12 | CodeLens: 함수 위 "Ask SoulClaw" 클릭 | 함수 본문 자동 선택 → Chat에 전송 |  |
| CA-13 | CodeLens: TypeScript 파일 | 함수/클래스 위에 CodeLens 표시 |  |
| CA-14 | CodeLens: Python 파일 | def/class 위에 CodeLens 표시 |  |
| CA-15 | `codeLensEnabled` 끈 상태 | CodeLens 미표시 |  |

---

## 14. Tool Calling

| # | 테스트 | 기대 결과 | Pass |
|---|--------|-----------|------|
| TC-01 | "이 프로젝트 파일 목록 보여줘" | list_files 도구 실행, 결과 표시 |  |
| TC-02 | "src/index.ts 읽어줘" | read_file 실행, 내용 표시 |  |
| TC-03 | "새 파일 만들어줘" | write_file 실행, 파일 생성 + 에디터 자동 열림 |  |
| TC-04 | "이 함수 수정해줘" | edit_file 실행, 수정 + 에디터 자동 열림 |  |
| TC-05 | "TODO 검색해줘" | search_files 실행, grep 결과 |  |
| TC-06 | "npm test 실행해줘" | run_command 실행, 30초 타임아웃 |  |
| TC-07 | Multi-turn tool use | 도구 결과 → 추가 도구 호출 → 최종 응답 (최대 10라운드) |  |
| TC-08 | Anthropic provider tool calling | tool_use 블록 정상 파싱 |  |
| TC-09 | OpenAI provider tool calling | function_call 정상 파싱 |  |
| TC-10 | 파일 생성 후 에디터 열림 | write_file 완료 → 해당 파일 에디터 탭 열림 |  |

---

## 15. Checkpoint (Auto)

| # | 테스트 | 기대 결과 | Pass |
|---|--------|-----------|------|
| CPA-01 | SOUL.md 수정 → 저장 | 자동 체크포인트 생성 |  |
| CPA-02 | 자동 체크포인트 라벨 | "auto: SOUL.md changed" 형태 |  |
| CPA-03 | 자동 체크포인트 패널 표시 | Checkpoint 패널에 auto-생성 항목 보임 |  |

---

## 16. Token & Status

| # | 테스트 | 기대 결과 | Pass |
|---|--------|-----------|------|
| TS-01 | 대화 진행 중 토큰 카운트 | Status bar에 "~1.2k tokens" 형태 표시 |  |
| TS-02 | 새 세션 시작 시 | 토큰 카운트 리셋 |  |
| TS-03 | 긴 대화 시 | 토큰 수 증가 반영 |  |

---

## 17. Activity Bar & UI

| # | 테스트 | 기대 결과 | Pass |
|---|--------|-----------|------|
| UI-01 | Activity bar 아이콘 확인 | 새 SVG 아이콘 표시 |  |
| UI-02 | Swarm Memory 패널 이름 | "Swarm Memory" (not "Swarm") |  |
| UI-03 | Swarm Memory 아이콘 | 다이아몬드+화살표 PNG 아이콘 |  |
| UI-04 | 다크 테마에서 전체 UI | 가독성 확인 |  |
| UI-05 | 라이트 테마에서 전체 UI | 가독성 확인 |  |

---

## 18. Cross-Platform

| # | 테스트 | 기대 결과 | Pass |
|---|--------|-----------|------|
| XP-01 | Windows + Anthropic | Chat 정상 동작 |  |
| XP-02 | Windows + Ollama | Chat 정상 동작 |  |
| XP-03 | Mac + Anthropic | Chat 정상 동작 |  |
| XP-04 | Mac + Ollama | Chat 정상 동작 |  |

---

## Summary

| # | 카테고리 | 항목 수 |
|---|----------|---------|
| 1 | Setup Wizard | 15 |
| 2 | Engine | 5 |
| 3 | Chat Panel | 18 |
| 4 | Status Bar | 6 |
| 5 | Soul Explorer | 9 |
| 6 | Checkpoint | 9 |
| 7 | Swarm Memory | 24 |
| 8 | SoulScan | 5 |
| 9 | Security & Safety | 10 |
| 10 | Edit Soul | 3 |
| 11 | Chat History | 3 |
| 12 | Workspace Tracker | 3 |
| 13 | Code Actions | 15 |
| 14 | Tool Calling | 10 |
| 15 | Checkpoint (Auto) | 3 |
| 16 | Token & Status | 3 |
| 17 | Activity Bar & UI | 5 |
| 18 | Cross-Platform | 4 |
| | **Total** | **150** |
