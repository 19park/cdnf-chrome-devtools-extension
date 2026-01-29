# CDNF — Chrome DevTools Extension

> **C**urrent **D**omain **N**etwork **F**ilter

Chrome DevTools 확장 프로그램으로, 현재 탭의 도메인을 자동 인식하여 해당 도메인의 네트워크 요청만 필터링해서 보여줍니다.

로컬 / 개발 / 운영 환경을 오갈 때 Network 탭에서 매번 도메인 필터를 수동 입력할 필요가 없습니다.

## 주요 기능

- **자동 도메인 필터링** — 현재 접속한 도메인의 요청만 자동으로 표시
- **자체 Network 뷰어** — DevTools 내 `Net Filter` 탭에서 Method, Status, Name, Type, Size, Time 확인
- **리소스 타입 필터** — All, API, Fetch/XHR, Doc, CSS, JS, Img, Media, Font, WS, Other
- **요청 상세 보기** — 행 클릭 시 Headers, Payload, Preview, Response 탭 제공
- **JSON 트리 뷰** — Preview 탭에서 JSON 응답을 접기/펼치기 가능한 트리로 표시
- **Pending 표시** — 요청 시작 시점부터 실시간 표시, 완료 시 업데이트
- **캐시 표시** — (memory cache) / (disk cache) 구분 표시
- **경로 하이라이트** — Name 컬럼에서 마지막 경로 세그먼트 강조
- **자동 스크롤** — 새 요청 발생 시 자동 스크롤 + 신규 행 flash 애니메이션
- **다크 모드** — 시스템 설정에 따라 자동 전환

## 설치

1. 이 저장소를 클론하거나 다운로드합니다
2. Chrome에서 `chrome://extensions` 접속
3. 우측 상단 **개발자 모드** 활성화
4. **압축해제된 확장 프로그램을 로드합니다** 클릭
5. 이 프로젝트 폴더를 선택

## 사용 방법

1. 아무 웹페이지에서 DevTools 열기 (`⌘⌥I` / `F12`)
2. 상단 탭에서 **Net Filter** 클릭
3. 현재 도메인의 네트워크 요청이 자동으로 필터링되어 표시됩니다

브라우저 툴바의 **Net Filter** 아이콘을 클릭하면 현재 도메인과 DevTools 단축키를 확인할 수 있습니다.

## 파일 구조

```
├── manifest.json      # 확장 프로그램 설정 (Manifest V3)
├── background.js      # webRequest 이벤트 감지 및 패널 통신
├── devtools.html      # DevTools 진입점
├── devtools.js        # Net Filter 패널 등록
├── panel.html         # 패널 UI (테이블, 필터 바, 상세 뷰)
├── panel.js           # 패널 로직 (요청 수집, 필터링, 트리 뷰)
├── popup.html         # 툴바 팝업 UI
└── popup.js           # 팝업 로직 (현재 도메인 표시)
```

## 기술 스택

- Chrome Extension Manifest V3
- `chrome.devtools.network` — HAR 기반 요청 수집
- `chrome.devtools.inspectedWindow` — 현재 탭 도메인 감지
- `chrome.webRequest` — Pending 요청 실시간 감지
- Vanilla JS / CSS (외부 의존성 없음)
