# vscode-md-html-preview — ① 편집↔프리뷰 y 불일치 조사 · ② 슬라이드 모드 PDF = VOD 화면 계획 (2026-09-16)

교수자 요청: ① 「텍스트를 수정하면 프리뷰 창의 위치가 바뀌고, 그러면 수정 중인 텍스트 위치가 바뀌어 버린다 — 특히 주석과 그림 첨부가 있을 때」 조사. ② 「PDF 내보내기의 슬라이드 모드 출력을 영상 VOD 화면과 동등하게」 계획 + 한 슬라이드를 넘는 장면의 처리 계획.

대상 판: 0.4.3(작업 트리에 미커밋 변경 있음 — `src/htmlTemplate.ts`·`media/preview.css`·`package.json`·`dist/*.vsix`). 이 문서는 **읽기만** 했고 코드는 바꾸지 않았다.

---

## ① 편집 ↔ 프리뷰 y 불일치 — 조사 결과

### 1. 재현되는 사슬 (코드 인용)

| # | 일어나는 일 | 자리 |
|---|---|---|
| 1 | 키를 칠 때마다 `onDidChangeTextDocument` → 200 ms 디바운스 → `render()` → **`webview.html = html`** — 문서 전체를 다시 싣는다(부분 갱신이 아니다) | `src/previewPanel.ts:100`, `:484-489`, `:570` |
| 2 | 다시 실린 클라이언트는 `init()` 에서 **화소 값**으로 자리를 되돌린다: `window.scrollTo(0, prev.scrollY)` (localStorage 의 `scrollY`) | `src/htmlTemplate.ts` `init()` — `readState().scrollY` |
| 3 | 곧바로 `buildMap()` 이 `[data-source-line]` 블록의 `getBoundingClientRect()` 를 재어 줄↔화소 지도를 만든다 — **그림은 아직 높이가 없다**: `<img loading="lazy" decoding="async">`(`src/markdownRenderer.ts:539`)라 화면 아래쪽 그림은 스크롤해 가까워질 때까지 내려받지 않고, `.figure` 상자는 0 px 로 잡힌다. Mermaid 도 `runMermaid()` 뒤에야 크기가 생긴다 | `htmlTemplate.ts` `buildMap()`·`pixelForLine()` |
| 4 | 그림이 뒤늦게 실리면 아래 내용이 그림 높이만큼 **통째로 밀린다**. 화소로 되돌린 자리는 이제 다른 문장을 가리키고, `pixelForLine()`(편집기→프리뷰)도 그림 위쪽까지는 맞고 아래는 그림 높이 합만큼 짧게 계산한다 | 아래 §2 실측 |
| 5 | 이 밀림과 되돌리기 스크롤이 `scroll` 이벤트를 내고 → `onScroll()` → **`revealLine`** 을 편집기로 보낸다. 이때 `currentLine()` 은 낡은 지도로 계산한 줄이다 → 확장은 `editor.revealRange(…, InCenter)` 로 **편집기를 그 줄로 옮긴다** → 「수정 중인 텍스트 위치가 바뀐다」 | `htmlTemplate.ts` `onScroll()`, `previewPanel.ts:171-185` |
| 6 | 되돌림 스크롤은 `suppressPostUntil` 을 걸지 않는다(편집기→프리뷰 `scrollToLine()` 만 250 ms 건다). 확장 쪽 `ignoreEditorScrollUntil` 도 250 ms — 그림이 실리는 데 걸리는 시간보다 짧다 | 같은 자리 |

### 2. 실측 — 4-1주차 덱(그림 3·머메이드·NOTE 주석 41장), 폭 1280 px, Edge 헤드리스

`render_md_html.js --mode document --theme dark` 로 만든 같은 렌더러 출력에서 첫 레이아웃(DOMContentLoaded)과 완전 로드 뒤를 대조했다(`scratchpad/_ext_probe.js`).

| 항목 | 첫 레이아웃 | 로드 뒤 |
|---|---:|---:|
| 문서 높이 | 18 347 px | **19 681 px (+1 334)** |
| `.figure` 높이 셋 | 0 · 0 · 0 | 450 · 434 · 450 |
| 위치가 2 px 넘게 움직인 블록 | — | **53 중 20** (첫 이동 = 첫 그림 바로 뒤 H2, +450 px; 누적 +1 334 px) |

곧 「그림 하나 아래의 모든 줄」은 편집 직후 450 px, 그림 셋 아래는 1 334 px 어긋난다. 편집기 폭의 프리뷰(더 좁음)에서는 그림이 더 커져 어긋남도 커진다.

### 3. 주석(`<!-- NOTE … -->`)이 있을 때 왜 더 자주 겪나
- 편집기→프리뷰: `commentLineMask` 가 편집기 중앙 줄이 주석 안이면 프리뷰를 **얼린다**(`previewPanel.ts:145`) — 이 방향은 옳다. 렌더러도 주석 줄을 빈 줄로 남겨 뒤 블록의 `data-source-line` 을 보존한다(`markdownRenderer.ts:263-300`).
- 그러나 **프리뷰→편집기 방향은 마스크가 없다.** NOTE 안에서 타자할 때마다 (1)~(5) 가 돌아 프리뷰가 스스로 스크롤하고 `revealLine` 을 보내 편집기를 옮긴다. NOTE 는 보통 그림 바로 뒤에 있어 §2 의 밀림이 정확히 그 자리에 떨어진다.
- 주석 한 줄을 늘리거나 줄이면 뒤 블록의 줄 번호가 한꺼번에 바뀐다 — 다시 싣기 전의 `scrollY` 는 옛 줄 배치의 화소라, 화소 복원은 여기서도 틀린 문장에 앉는다(줄 기준 복원이면 맞는다).

### 4. 슬라이드 모드
다시 실릴 때 `slideIndex` 는 복원되지만 `showSlide()` 가 매번 `scrollTop = 0` 을 건다 — 긴 슬라이드를 아래로 내려 보며 편집하면 키를 칠 때마다 맨 위로 튄다. 편집기 이동은 `activateSlideForLine` 이 슬라이드만 바꾸므로 약하다.

### 5. 처방 (작은 것 → 근본)

| 단계 | 무엇 | 어디 | 기대 효과 |
|---|---|---|---|
| **F1** | 다시 실린 뒤 **정착 창**을 둔다: `init()`·`afterRender()` 에서 `suppressPostUntil = now + 800`, 그리고 `document.readyState !== 'complete'` 이거나 미완 `img` 가 있으면 `revealLine` 을 보내지 않는다. 확장 쪽 `ignoreEditorScrollUntil` 도 다시 싣기 뒤 800 ms | `htmlTemplate.ts` 클라이언트, `previewPanel.ts` | 편집기가 튀는 증상(5) 제거 |
| **F2** | **줄 기준 복원**: 상태에 `anchorLine`(마지막 스크롤 때의 `currentLine()`)을 함께 저장하고, `init()` 뒤 `scrollToLine(anchorLine)`; 그 뒤 `img.load`·`afterRender` 때마다 사용자가 스크롤하기 전이면(휠·키·터치로만 세우는 `userScrolled` 플래그) 같은 줄로 다시 맞춘다. 확장은 다시 싣는 HTML 에 `data-anchor-line`(편집기 중앙 줄)을 박아 첫 그림부터 맞게 앉힌다 | 같은 자리 + `previewPanel.ts render()` | 화소 복원의 어긋남(2)(4) 제거, 주석 편집으로 줄 수가 바뀌어도 같은 문장에 머무름 |
| **F3** | **밀림 자체를 없앤다**: (a) 프리뷰 모드에서 `loading="lazy"` 를 `eager` 로(웹뷰의 로컬/임베드 그림에 지연 로드는 이득이 없다) (b) 렌더러가 PNG/JPEG 헤더에서 크기를 읽어 `<img width height>` 를 찍어 상자가 먼저 비율을 갖게 한다(`aspect-ratio` 로 62vh 캡과 공존) (c) Mermaid 는 다이어그램 소스 해시별로 마지막 SVG 높이를 상태에 저장해 재렌더 전까지 `min-height` 로 잡아 둔다 | `markdownRenderer.ts:539`, `htmlTemplate.ts runMermaid` | §2 의 +1 334 px 가 0 에 가깝게 |
| **F4** | **전체 다시 싣기를 없앤다**: `webview.html` 대신 `postMessage({type:'update', articleHtml})` 로 `article.innerHTML` 만 갈아 넣고 KaTeX·hljs·Mermaid 를 새 노드에만 다시 돌린 뒤 `buildMap()`; 창 스크롤은 그대로. 가장 큰 변경이라 F1~F3 다음 판에 | `previewPanel.ts render()`, `htmlTemplate.ts` | 깜빡임·상태 복원 자체가 사라짐 |
| **F5** | 슬라이드 모드: `showSlide()` 가 `scrollTop` 을 슬라이드별 상태로 보존(다시 싣기 뒤 복원), 사용자가 슬라이드를 넘길 때만 0 | `htmlTemplate.ts showSlide` | §4 제거 |

검증: 오늘의 프로브(`_ext_probe.js`)를 확장해 **프리뷰 모드 HTML**(`cspSource` 를 가짜로 주고 `acquireVsCodeApi` 를 stub) 을 Playwright 로 열고 (가) 다시 싣기 뒤 화면 중앙 블록의 `data-source-line` 이 편집 전과 ±1 줄 안인가 (나) 800 ms 안에 `revealLine` post 가 0 건인가 (다) F3 뒤 첫 레이아웃의 `.figure` 높이가 로드 뒤와 같은가 — 4-1주차 덱(그림·머메이드·NOTE)과 4주차 덱(스캔 그림 여럿)을 고정 시험 자료로. 예상 작업량: F1~F3 하루, F5 반나절, F4 이틀.

---

## ② 슬라이드 모드 PDF = VOD 화면 — 계획

### 1. 지금 상태와 VOD 가 만들어지는 길
- 지금 「Print / Save as PDF」는 독립 HTML 을 임시 파일로 써 외부 브라우저에서 Ctrl+P 로 인쇄한다(`previewPanel.ts:241-275`). 인쇄 CSS 는 **모드와 무관하게 문서 모드·A4·밝은 팔레트**로 되돌린다(`media/preview.css:395-430`: `.deck{display:none}`, `main{display:block}`, 팔레트 리셋).
- VOD 프레임은 **같은 렌더러·같은 CSS** 로 만든다: `tts/render_md_html.js` 가 확장의 `markdownRenderer`·`htmlTemplate` 모듈과 `media/preview.css` + 과목 `_deck.css` 를 그대로 쓰고(`--mode slide --theme dark`), `tts/render_slide_pngs.js` 가 `--layout 1280x720 --scale 3 --pages --fit-images 62 --zoom 1.5` 로 굽는다 → 실효 CSS 뷰포트 **853×480 px**(deviceScaleFactor 4.5 → 3840×2160), 그림 `max-height: 62vh`, 쪽 나누기는 아래 §3 의 규칙.
- 그러므로 「VOD 와 동등」은 새 렌더러가 아니라 **인쇄 시 슬라이드 모드 전용 레이아웃 한 벌**과 **같은 쪽 나누기 알고리즘**을 붙이는 일이다.

### 2. 계획

| 단계 | 무엇 | 세부 |
|---|---|---|
| **P1 인쇄 레이아웃(슬라이드)** | `<html data-mode="slide" data-print="frames">` 일 때만 적용되는 `@media print` 가지 | `@page { size: 853.33px 480px; margin: 0 }`(Chromium 은 px 크기를 받는다; 16:9). 어두운 팔레트 **유지**(리셋 가지를 `data-print="frames"` 아닌 경우로 한정), `print-color-adjust: exact`. `.deck` 은 `position: static`, 각 쪽 `.slide-page { width: 853.33px; height: 480px; overflow: hidden; break-after: page; padding: 6vh clamp(28px,7vw,160px) 12vh }`(지금 `.slide` 와 같은 식 → 480×853 에서 같은 값). 글꼴·KaTeX·Mermaid 는 이미 인라인(오프라인 내보내기)이라 그대로. `.slide img { max-height: 62vh }` 로 `--fit-images 62` 와 같게 |
| **P2 쪽 나누기 = 영상 규칙** | `render_slide_pngs.js` 의 분할 함수를 **공용 모듈**(`tts/slidePages.js` ↔ 확장 `src/slidePages.ts`, 한 소스에서 양쪽으로)로 뽑아 인쇄용 HTML 의 클라이언트가 로드 뒤(`fonts.ready`·Mermaid 완료 뒤) 슬라이드마다 돌린다 | 규칙(현행 그대로): 블록 `offsetTop/offsetHeight` 를 재어 **`bottom − pageStart > H` 이면 그 블록 앞에서 끊고**, `<div class="pagebreak">` 앞에서는 **무조건** 끊는다(자동 규칙에 더하기만). 쪽마다 `first..last` 블록만 보이게 하고 그 쪽의 시작 y 를 `first` 블록의 top 으로 둔다. 인수 시험: 4주차(60장)·4-1주차(41장) 덱에서 슬라이드별 쪽 수가 `output/wNN/png_dark/_pages.json` 과 **전부 일치** |
| **P3 한 슬라이드를 넘는 장면** | 아래 §3 | 기본 A, 옵션 B, C 는 별도 처리 |
| **P4 슬라이드 번호** | VOD PNG 엔 배지가 없다(`render_md_html.js --mode slide` 플래그 없음). 강의자료 PDF(`vodpdf slice_deck`)엔 덱 인덱스 배지가 있다 | 설정 `showSlideNumbers` 를 따르고, 나눈 쪽은 `N` · `N (2/2)` 꼴. 기본은 VOD 처럼 배지 없음 |
| **P5 UX·명령** | `mdHtmlPreview.print` 가 **현재 모드**를 알아야 한다 | 클라이언트가 모드를 바꿀 때 `post({type:'modeChanged', mode})` → 패널이 기억 → 인쇄 때 `mode:'slide'` 면 `data-print="frames"` 로 독립 HTML 을 만든다. 팔레트용 명령 「Print Slides as 16:9 PDF」도 따로 둔다(프리뷰 없이도). 임시 HTML 에 `?autoprint=1` 을 주면 로드·분할 뒤 `window.print()` 를 스스로 부른다(브라우저에서는 막히지 않는다). 상태바 문구 「16:9 슬라이드 PDF — 배경 그래픽 켜기」 |
| **P6 검증** | 프레임 대조 | Playwright 로 임시 HTML 을 열어 `.slide-page` 마다 `screenshot` → `png_dark/slide-NNN[-pK].png` 를 853×480 으로 줄인 것과 화소 차(>25 화소 비율)로 대조; 4-1주차 41장 전 쪽. `page.pdf({width:'853.33px', height:'480px', printBackground:true})` 로 PDF 쪽 수 = 쪽 수 합 |

### 3. 한 슬라이드를 넘는 장면(2쪽 이상)의 처리 — 선택지

| 안 | 모습 | 장점 | 단점 | 권고 |
|---|---|---|---|---|
| **A 같은 분할 · 겹침 없음** | 영상과 **같은 자리**에서 끊고, 둘째 쪽은 `first..last` 블록만 위 정렬로 인쇄. 작은 회색 머리글 「제목 (계속 2/2)」을 슬라이드 H2 에서 복제 | 쪽 수·내용이 영상 큐표(`_pages.json`)와 1:1 — 자막 PDF·큐표와 같은 번호 축; 읽기 좋다 | 영상 둘째 쪽엔 없는 머리글이 생긴다(끌 수 있게) | **기본값** |
| **B 영상 그대로** | 둘째 쪽 = 슬라이드를 `first` 블록 top 까지 스크롤한 모습(앞 쪽 마지막 블록 띠가 겹쳐 오르는 것까지 — 메모리 「쪽 스크롤은 마지막 불릿을 겹쳐 올린다」), 뒤 블록은 숨김 | 프레임과 화소 단위로 같아 영상 대조·교정용 | 인쇄물로는 띠가 어색 | 설정 `mdHtmlPreview.slidePrintPages = "video"` |
| **C 블록 하나가 한 쪽을 넘을 때**(긴 코드·표) | 영상은 `--autofit` 을 안 써 **잘린다** | — | — | PDF 는 그 쪽만 `transform: scale(H/blockH)` 로 줄여 담고 보고서에 「영상과 다름」 표시; 코드 블록 줄 단위 분할은 하지 않는다 |

공통: 쪽을 나눈 뒤에도 **하나의 슬라이드 = 연속된 쪽들**이라 슬라이드 번호 축은 덱 인덱스(메모리 「강의자료 PDF 슬라이드 번호는 덱 인덱스」)를 유지하고 쪽 번호만 `(k/n)` 으로 붙인다.

### 4. 순서와 분량
P1 → P2(공용 모듈 + `_pages.json` 일치 시험) → P3-A → P5 → P6, 그 뒤 P3-B·P4. P1~P3-A 이틀, P5 반나절, P6 반나절. ①의 F1~F3 와는 파일이 겹치지 않아(F 는 클라이언트 스크립트의 동기 부분, P 는 인쇄 CSS·분할 모듈) 같은 판(0.5.0)에 함께 실을 수 있다.

### 5. 결정을 부탁드릴 것
1. ②-3 의 기본을 **A(같은 분할·겹침 없음 + 「(계속)」 머리글)** 로 두어도 되는지, 머리글 없이 둘째 쪽을 빈 위쪽으로 둘지.
2. 슬라이드 PDF 의 기본 테마 — VOD 와 같은 **어두운 배경**(권고) / 인쇄용 밝은 배경 옵션.
3. 슬라이드 번호 배지 기본 — 없음(VOD) / 덱 인덱스(강의자료 PDF 와 같게).
4. ①의 F4(부분 갱신)까지 이번에 갈지, F1~F3·F5 로 먼저 판을 내고 볼지(권고: 먼저 판).

---

## 구현 결과 (2026-09-16 저녁, v0.5.0 — 교수자 결정: ② B 영상 프레임 그대로 · 테마는 HTML 사용자 선택 · 배지 없음 · ① F1~F3·F5 먼저)

### ① 편집↔프리뷰 (F1·F2·F3·F5)
- `src/htmlTemplate.ts` 클라이언트: 정착 창 `SETTLE_MS=800`(`settle()`, 그림 미완이면 `revealLine` 안 보냄) · 줄 기준 복원(`data-anchor-line` → `restoreAnchor()`; 그림 `load`·`afterRender` 때 재적용; 휠·터치·키로 사용자가 움직이면 중단) · Mermaid 높이 캐시(`mermaidH`, 소스 해시별 `min-height`) · 슬라이드별 `scrollTop` 보존(`slideScroll`, 사용자 넘김만 0) · `uiState` 보고(모드·테마).
- `src/markdownRenderer.ts`: `eagerImages`·`imageSize` 옵션 → `<img width height loading="eager">`. `src/imageSize.ts`: PNG/JPEG/GIF/WebP 헤더에서 크기(64 KB 안).
- `src/previewPanel.ts`: 편집기 중앙 줄을 기억해 다시 실린 HTML 에 `anchorLine` 으로, 다시 실린 뒤 0.8 s 편집기 스크롤 무시, `imageSize` 캐시(경로+mtime).
- **검증**(`scratchpad/_sync_test.js`, Edge, 4-1 덱, 앵커 481): 첫 로드 중앙 = 481 · 주석 세 줄 끼운 뒤 다시 싣기(앵커 484) 중앙 = 484 **같은 문장** · 1.2 s 안 `revealLine` 0건(uiState 만) · 사용자 휠 뒤에는 `revealLine` 1건(정상) · 그림 셋이 첫 배치부터 `width/height` 를 갖고 높이 440·434·440.
- F4(부분 갱신)는 다음 판.

### ② 슬라이드 모드 PDF = VOD (P1·P2·P3-B·P5)
- `printFrames` 템플릿 옵션: `<html data-print="frames">` + `<style id="frames-style">`(`@page 853.333px×480px margin 0`, `.slide-page` 고정 상자, `.slide` 패딩 28.8/59.733/57.6px = 6vh/7vw/12vh, `img max-height 297.6px` = 62vh) · 클라이언트 `buildFrames()`: 영상과 같은 greedy 분할 + `pagebreak`, 뒤 블록 `visibility:hidden`, **스크롤 클램프까지 재현**(`min(y, scrollHeight−clientHeight)` — 마지막 쪽이 짧을 때 영상처럼 앞 쪽 끝이 위에 보인다) 를 `translateY` 로 · `disablePrintRules()` 가 preview.css·_deck.css 의 `@media print`·`@page` 를 지워 화면 CSS 그대로 인쇄.
- `print()` 는 프리뷰가 슬라이드 모드면 프레임으로, 문서 모드면 A4 로. 새 명령 `mdHtmlPreview.printSlides`(팔레트). 테마 = 프리뷰의 현재 테마(브라우저 우클릭 메뉴로 바꿔도 됨). 배지 없음.
- **검증**(`scratchpad/_frames_test.js`, 4-1 덱 41장): 쪽 수 **55 = 55**(`_pages.json` 과 장별 전부 일치, 2쪽 장 14개) · `.slide-page` 스크린숏 vs `png_dark` 프레임 화소 차(>25) **p1 0.4~0.9 %, p2 0.7~1.3 %**(클램프 전 p2 는 3.7~4.9 %) · `page.pdf` **55쪽**, pdftoppm 래스터 vs 프레임 0.6 %/1.2 %.
- 남은 차이: 화면 스크린숏 폭 3843 vs 영상 3839(853.33×4.5 반올림) · 스크롤바 자리(투명)는 레이아웃만 같게 유지 · 한 블록이 한 쪽을 넘는 경우(C)는 영상처럼 잘린다(따로 안 함).

### 산출물
`dist/vscode-md-html-preview.vsix` 0.5.0(17:44) — 이 기계에 `code --install-extension --force` 로 설치함(VS Code 재시작 필요). 작업 트리는 **미커밋**(0.4.3 작업분 포함).

### 마무리 (같은 날 저녁, 「남은 사항들 진행」)
- **F4 부분 갱신**: 편집은 `webview.html` 대신 `{type:'update', articleHtml, anchorLine}` 메시지 → 클라이언트 `applyUpdate()` 가 `article.innerHTML` 만 갈아 넣고 KaTeX·hljs·Mermaid 를 새 노드에 다시 돌린 뒤 지도·덱·앵커를 갱신. 설정 변경·문서 바뀜·코드/머메이드 유무가 바뀌면(`pageSignature`) 전체 재구축. 검증(`_update_test.js`, 4-1 덱, 앵커 = 「3부 — 표면에서 무슨 일이 일어나나」 H2): 주석 셋 삽입 → 같은 제목 중앙(483→486) · 위쪽에 문단 삽입 → 같은 제목 중앙(→489, scrollY +47 자동 보정) · 페이지 로드 1회 · 편집기로 보낸 메시지 0.
- **C 한 블록이 한 쪽을 넘는 경우**: 그 쪽은 클램프 없이 블록에서 시작해 프레임 좌상단 기준 `scale(H/pageH)` 로 축소, `data-fit` 기록. 검증(`_fit_test.js`, 48줄 코드 블록 덱): fit 0.351, 마지막 블록 아래끝 480 = 프레임(첫 판은 래퍼 원점 기준 축소라 499 였다 — 원점을 `0 −offsetTop` 으로 고침). 영상은 이 경우 잘리므로 PDF 만 다르다.
- 4-1 덱 회귀: 쪽 수 55=55, 화소 차 ≤1.3 %, 다시 싣기 동기 시험 통과. `dist/release.sh` 로 커밋·푸시.

### 교수자 보고 「pdf 인쇄시 슬라이드 화면이 나오지 않는다」 (같은 날 18:3x)
- 실측: `%TEMP%/mdpreview-04_PDE-*.html` 18:33·18:34 두 판이 **새 코드**(`SETTLE_MS` 있음)인데 `<html data-mode="document" data-theme="light">` — 문서 레이아웃으로 결정됐다. 즉 `print()` 의 `webviewMode === 'slide'` 가 거짓이었다(마지막으로 받은 `uiState` 에 의존).
- 처방 둘: ① `print()` 가 인쇄 직전에 웹뷰에 `queryState` 를 보내 **살아 있는 모드**를 받아 결정(700 ms 안 답 없으면 마지막 값 → 설정 `defaultMode`); ② 브라우저에 열린 인쇄용/저장 HTML 도 우클릭 「16:9 슬라이드(영상 프레임) 레이아웃으로」로 그 자리에서 프레임 레이아웃으로 바뀐다(`enterFrames()` — 프레임 CSS 를 스크립트에 품고 있어 `<style>` 을 동적으로 붙임; 배지 `.slide-no` 는 프레임에서 뺀다). 프리뷰 우클릭에도 「16:9 슬라이드(영상 프레임) PDF…」 항목 추가.
- 검증: 문서 모드 인쇄 HTML(배지 41개)을 열어 메뉴로 전환 → `data-print=frames`, 쪽 55 = `_pages.json` 일치 0 어긋남; 정적 프레임 경로 회귀 55/55·화소 차 0.8 %.

