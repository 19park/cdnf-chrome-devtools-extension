# Task Spec: Auto Network Domain Filter (Chrome DevTools Extension)

## 1. 목표 (Objective)

Chrome DevTools의 **Network 탭에서 현재 브라우저 탭의 도메인(hostname)을 기준으로 필터를 자동 적용**하여,
개발 환경(local / dev / prod)을 오갈 때마다 필터를 수동 입력하지 않아도 되도록 한다.

* 핵심 필터 형태: `domain:{현재_접속_도메인}`
* 대상 사용자: 프론트엔드/풀스택 개발자
* 사용 맥락: Chrome DevTools → Network 탭

---

## 2. 문제 정의 (Problem)

* Network 탭 Filter는 정규식 및 `domain:` 키워드를 지원하지만,

    * 매번 도메인을 직접 입력해야 함
    * 환경(dev / local / prod) 전환 시 반복 작업 발생
* DevTools 기본 기능만으로는 "현재 탭 도메인 자동 필터링"이 불가능

---

## 3. 해결 전략 (Solution Overview)

### 접근 방식

* **Chrome DevTools Extension**을 사용
* 공식 API를 통해 *현재 inspected tab의 hostname*을 안전하게 획득
* DevTools 내부에 **전용 패널(Panel)** 을 추가하여 UX로 해결
* 버튼 클릭(또는 자동 옵션)을 통해 Network filter input에 값을 주입

### 핵심 아이디어

> `chrome.devtools.inspectedWindow.eval("location.hostname")`
> 를 사용해 현재 도메인을 얻고,
> 이를 `domain:현재도메인` 형태로 Network 필터에 적용

---

## 4. 기능 요구사항 (Functional Requirements)

### 필수 기능

1. DevTools에 전용 패널을 추가한다

    * 패널 이름: `Net Filter`

2. 패널에서 현재 inspected tab의 도메인을 표시한다

    * 예: `dev.example.com`

3. 버튼 클릭 시 Network 탭 filter에 아래 값을 적용한다

   ```
   domain:dev.example.com
   ```

4. 필터 적용 시 즉시 Network 요청 목록이 갱신되어야 한다

---

## 5. 비기능 요구사항 (Non-Functional Requirements)

* Chrome 공식 DevTools API만 사용하여 **도메인 추출**
* 크롬 업데이트에 최대한 안정적인 구조
* 개인 사용 및 사내 배포 가능
* 유지보수가 단순할 것 (selector 1~2줄 수정 수준)

---

## 6. 기술 스택 / 환경 (Tech Stack)

* Chrome Extension Manifest v3
* DevTools Extension API

    * `chrome.devtools.panels`
    * `chrome.devtools.inspectedWindow`

---

## 7. 시스템 구조 (Architecture)

```
Chrome DevTools
 ├── Network Tab (기존)
 └── Custom Panel: Net Filter
       ├── 현재 도메인 표시
       └── [Apply Network Filter] 버튼
             ↓
       Network Filter Input에 domain:{hostname} 주입
```

---

## 8. 파일 구조 (File Structure)

```
auto-network-domain-filter/
├── manifest.json
├── devtools.html
├── devtools.js
├── panel.html
└── panel.js
```

---

## 9. 주요 구현 포인트 (Implementation Details)

### 9.1 manifest.json

* `manifest_version`: 3
* `devtools_page` 지정
* 최소 권한만 사용 (`tabs`)

### 9.2 도메인 획득

```js
chrome.devtools.inspectedWindow.eval(
  "location.hostname",
  (hostname) => { /* use hostname */ }
);
```

* 공식 API 사용
* iframe / SPA 환경에서도 안정적으로 동작

### 9.3 Network Filter 적용 방식

* DevTools 내부 DOM의 Network filter input에 값 주입
* input 이벤트를 강제로 발생시켜 필터 반영

예시 개념 코드:

```js
const filter = `domain:${hostname}`;
input.value = filter;
input.dispatchEvent(new Event('input', { bubbles: true }));
```

※ Network filter DOM selector는 비공식이며 변경 가능성 있음

---

## 10. UX 설계 (User Experience)

### 기본 UX

* DevTools 상단 탭에 `Net Filter` 패널 표시
* 패널 내부 구성:

    * 현재 도메인 텍스트 표시
    * `Apply Network Filter` 버튼

### 사용 흐름

1. 개발자가 DevTools를 연다
2. `Net Filter` 패널을 클릭한다
3. `Apply Network Filter` 버튼 클릭
4. Network 탭에 현재 도메인 기준 필터 적용 완료

---

## 11. 확장 가능성 (Optional Enhancements)

* DevTools 열릴 때 자동 적용 옵션
* `type:xhr` 등과 조합한 고급 필터
* subdomain 포함 옵션 (`domain:(.*\.example.com)`)
* Network + Console 필터 동시 적용
* 옵션 페이지 제공

---

## 12. 제약 및 리스크 (Constraints & Risks)

* Network filter input selector는 비공식

    * 크롬 업데이트 시 변경 가능
    * 대응: selector만 수정

* DevTools 내부 직접 제어는 제한적

    * 완전 자동화 대신 UX 기반 해결책 채택

---

## 13. 성공 기준 (Success Criteria)

* 현재 도메인 기준 Network 요청만 즉시 필터링 가능
* 환경(local/dev/prod) 전환 시 추가 작업 불필요
* 개발자가 반복 입력 없이 Network 디버깅 가능

---

## 14. 산출물 (Deliverables)

* Chrome DevTools Extension 소스 코드
* 설치 가능한 확장 폴더(zip 또는 디렉토리)
* 간단한 사용 가이드

---

## 15. 한 줄 요약

> **DevTools에서 현재 접속 도메인을 자동 인식해 Network 필터를 한 번에 적용하는 생산성용 Chrome 확장**
