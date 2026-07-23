# VoiceOver Manual Checklist — P1-F2 #161

Manual residual for WCAG 2.1 AA screen-reader acceptance on the **merchant main
product**. Complements automated axe / keyboard / merchant-language gates in
[`a11y-visual-gates.md`](./a11y-visual-gates.md).

**Out of scope:** Pro Studio / Canvas.

**Devices (minimum):**

1. macOS Safari + VoiceOver (desktop light, 1440×900 or default)
2. iOS Safari + VoiceOver (375×812 or iPhone SE 2nd-gen; dark theme once)

**Prep:**

- Local or staging production-build Web + Core + fixture/recorded providers
- Fresh merchant workspace (or E2E-style empty workspace)
- VoiceOver: rotor includes Headings, Form Controls, Links, Status
- Note browser + OS version, commit SHA, viewport, theme in the evidence table below

**Pass rule:** every row is `pass` or `n/a` with reason. Any `fail` blocks #161 a11y closure.

---

## 1. Composer — Lens

| # | Step | Expected VO behavior | Pass? | Notes |
|---|---|---|---|---|
| L1 | Open `/dashboard` (Composer empty) | Landmark / main content announced; product shell title readable in Chinese (default) | | |
| L2 | Move to Lens group (`data-testid="composer-lens-radiogroup"`) | Group announced as **required radiogroup** with visible group label (not “radio 1 of 3” only) | | |
| L3 | Arrow / swipe through Lens options | Each option announces merchant label (文案 / 图文 / 视频 or current product copy); no internal lens id / enum | | |
| L4 | Select one Lens | Selection state announced (`selected` / 已选中); no second live announcement spam | | |
| L5 | Attempt submit without Lens when required | Invalid state / required hint announced (`aria-invalid` / describedby hint); no technical validation code | | |
| L6 | Progressive fact card / single question | Question region receives focus on change; `aria-live` (if any) announces new question once, not per keystroke | | |

**Automated support:** `lens-radiogroup.tsx` radiogroup semantics; identity flow E2E focus/announce pattern.

---

## 2. Streaming content

| # | Step | Expected VO behavior | Pass? | Notes |
|---|---|---|---|---|
| S1 | Submit a copy generation (fixture/recorded OK) | Status region announces merchant progress once (e.g. 生成中), not raw `running` / job UUID | | |
| S2 | While tokens stream | **No** per-token VoiceOver chatter; partial text may update visually but SR uses throttled stage announcement (`result-token-stream-a11y` / shell a11y) | | |
| S3 | First usable candidate / stage ready | One polite completion-oriented announcement (e.g. 可发布); does not re-read entire body | | |
| S4 | Stop / disconnect mid-stream (if available) | Arrived content remains; recovery path announced in merchant language; no provider error dump | | |
| S5 | Reload Result mid-run | Same Work deep link; status re-announced once; no duplicate candidate set announced as two jobs | | |

**Automated support:** single aggregate `aria-live` on Result shell; E2E `waitForResultJourney` merchant status; copy-stream slots.

---

## 3. Candidates / result chips

| # | Step | Expected VO behavior | Pass? | Notes |
|---|---|---|---|---|
| C1 | Three copy candidates (A/B/C or primary + alternatives) | Each option has accessible name (not “radio”); recommendation (if any) is labeled without implying fake ranking jargon | | |
| C2 | Move selection with VO + keyboard | Checked state announced; exactly one selection; primary action label updates if needed | | |
| C3 | Expand “alternatives” (if present) | Expansion announced; alternatives are optional, not forced | | |
| C4 | Outcome / publication result chips (咨询 / 到店 / …) | Chip labels are merchant Chinese; **no** causal ROI language; no raw source-tier enum (`verified` as bare English) unless localized | | |
| C5 | Support reference (error / help) | Short `MY-xxxxxx` code only; **never** full Work UUID | | |

**Automated support:** merchant-support-reference; result-merchant-truth; shell model single primary.

---

## 4. Media roles (image / video)

| # | Step | Expected VO behavior | Pass? | Notes |
|---|---|---|---|---|
| M1 | Image worksurface ready | Meaningful name/role for primary image (not empty `img`); decorative chrome `aria-hidden` | | |
| M2 | Open lightbox / preview | Dialog or complementary region announced; focus moves inside; Esc returns focus to trigger | | |
| M3 | Video player | Control names (播放 / 暂停 / 字幕) readable; time scrubber operable; no raw shot UUID in shot list | | |
| M4 | Video subtitle free vs re-encode fee path | Fee / free distinction announced in merchant language before confirm | | |
| M5 | Image set / suite tray | Role of “set selection” vs single image clear; adopt set action named 采用这组 (or current copy) | | |

**Automated support:** video shot label unit tests; image primary action labels; keyboard dialog trap (admin) as pattern.

---

## 5. State changes

| # | Step | Expected VO behavior | Pass? | Notes |
|---|---|---|---|---|
| T1 | Progress: submitting → running → ready | Status uses ProductStatus labels (生成中 / 可发布 / …); tone not color-only | | |
| T2 | Recoverable failure | Failure + next action announced; no `TIMEOUT` / provider slug; support code if shown is short | | |
| T3 | Adopt candidate | Confirmation / new state announced once; primary becomes 交付 (or equivalent) | | |
| T4 | Delivery outcomes | Four distinct announcements: 下载已开始 / 已交给系统分享 / 已交接 / 已发布 — never collapse to vague “完成” | | |
| T5 | Revision drift banner | Banner readable; 恢复 / 对比 / 丢弃 are focusable buttons with names | | |
| T6 | Async task center update | Task center trigger has name; completion does not steal focus unexpectedly | | |

**Automated support:** `delivery-outcomes-a11y`; ProductStatus unit tests; keyboard journey `aria-live` Job status.

---

## 6. Share degrade

| # | Step | Expected VO behavior | Pass? | Notes |
|---|---|---|---|---|
| H1 | Device supports file share | Primary share action announces file-share intent | | |
| H2 | File share unavailable; one-shot link available | Fallback announced in user language (link / 72h handoff), not “navigator.canShare false” | | |
| H3 | Link + download only | Download alternative announced; cancel does **not** claim 已发布 | | |
| H4 | Cancel system share sheet | Stay on Result; publication status unchanged; no false “分享完成” | | |
| H5 | After successful system accept | 已交给系统分享 (or share_done phrase) — **not** platform published | | |

**Automated support:** `delivery-share-degrade` pure matrix. Real sheet is manual.

---

## 7. Reduced motion + Save-Data (VO-adjacent)

| # | Step | Expected VO behavior | Pass? | Notes |
|---|---|---|---|---|
| R1 | Enable Reduce Motion (OS) + reload Result during generation | Status text still announced; no reliance on animation for meaning | | |
| R2 | Publish celebration under reduced motion | Completion text announced; particles not required | | |
| R3 | Save-Data / Low Data Mode (if available) | Same as R1 until product Save-Data hook ships; record as residual if decorative loops continue | | |

---

## 8. Evidence log

| Field | Value |
|---|---|
| Date | |
| Operator | |
| Commit SHA | |
| Build | production / local production-candidate |
| Desktop: OS + Safari + VO version | |
| Mobile: iOS + Safari + VO version | |
| Viewport / theme used | |
| Fixture / provider mode | fixture / recorded |
| Overall result | pass / fail |
| Blocking fails (IDs) | |
| Attachments (screenshots / screen recording paths) | `docs/evidence/p1-f2-161/…` |

---

## 9. Quick failure taxonomy

| Symptom | Likely owner | Related automation |
|---|---|---|
| UUID or `work_…` spoken | Result projection / support reference | merchant-support-reference, ui-journey fixture |
| Raw `running` / `candidate_ready` spoken | ProductStatus mapping | status.test.ts, locale RAW_ENUM_LEAK |
| Provider slug spoken (`openai/…`) | Run detail / error surface | result-live-projection tests |
| Token spam | Live region too hot | result-token-stream-a11y design |
| Focus lost after dialog | Missing focus return | keyboard-governance Impact Dialog pattern |
| Dead primary (silent button) | Shell action matrix | result-shell-model enabled assert |
| Share cancel marks published | Delivery command boundary | delivery-share-degrade + outcomes a11y |

---

## 10. Sign-off

| Role | Name | Date | Signature |
|---|---|---|---|
| Executor (VO pass) | | | |
| Reviewer (#161 a11y) | | | |
