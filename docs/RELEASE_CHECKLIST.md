# Release checklist

Run through this list before cutting an alpha release. All boxes should be checked before tagging a version and updating `README.md`, `CHANGELOG.md`, and `docs/DEVLOG.md`.

## Automated checks

- [ ] `pnpm -r typecheck` passes for every package and app.
- [ ] `pnpm -r test` passes for every package and app.
- [ ] `pnpm lint` passes with no errors.
- [ ] `pnpm build` succeeds (Next.js production build).

## v0.7.0-alpha Phase 0 (contracts and architecture)

Phase 0 adds types, package boundaries, and local persistence/migration only — there is no new or changed UI behavior, so no new manual browser check applies. Automated checks above cover this phase's verification surface; `packageDependencyBoundaries.test.ts` additionally guards against a circular dependency between `model-router`, `ai-runtime`, `model-registry`, and `device-profiler`. Later v0.7 phases (Model Registry v2, Local Benchmark v1, Adaptive Router Core, runtime integration, router UI) will add real manual checks here as they land — see `docs/roadmap.md`.

## v0.7.0-alpha Phase 1A (Capability Profiler v2)

- [ ] Open Home, onboarding device, Settings, and Debug; confirm device detection completes locally and shows the same plain-language capability class/tier boundaries as before.
- [ ] In Settings, use "Re-check this device" and confirm the profile refreshes without navigation, network calls, or errors.
- [ ] Export a diagnostic report from `/debug` and confirm it may contain coarse capability fields but no raw GPU adapter string, device ID, driver string, exact VRAM, raw user-agent, or prompt/response/conversation/document content.
- [ ] On a high-memory mobile device or mobile emulation, confirm memory alone does not grant a performance-class recommendation.
- [ ] On iPadOS Safari desktop-style mode (`Macintosh` user agent plus multitouch), confirm the form factor remains tablet/conservative, not normal desktop.
- [ ] On a normal macOS desktop, confirm the form factor remains desktop.
- [ ] If the browser reports a fallback/software WebGPU adapter, confirm the capability stays conservative.

## v0.7.0-alpha Phase 1B (Model Registry v2)

- [ ] Run the model-registry tests and confirm all v2 records match the installed WebLLM `prebuiltAppConfig`, including exact model IDs, model URLs, model libraries, required features, and runtime-memory metadata.
- [ ] Confirm every record has an upstream source, exact license source, download estimate, runtime-memory estimate, known issues, conservative language/task/form-factor/mode scores, and ordered context presets.
- [ ] Confirm duplicate IDs, unknown fallback IDs, fallback cycles, incomplete verification, unsafe URLs, and unknown fields are rejected.
- [ ] Review `docs/model-verification.md` and `docs/model-attributions.md`; confirm browser evidence and license claims match the exact artifact and model size, not another family member.
- [ ] In a Chromium/WebGPU desktop environment, load each curated model and run synthetic English, French where claimed, Stop, worker recycle/cached reload, and post-recovery generation checks. Record only technical status/timings, never generated content or raw hardware identifiers.
- [ ] Confirm the fixed default `SmolLM2-360M-Instruct-q4f32_1-MLC` loads through the existing client worker and Stop/recovery still succeeds.
- [ ] Confirm the active UI still does not silently select or download models from Registry v2; the pure adaptive-router core exists, while runtime integration and explicit download UX remain later phases.
- [ ] Confirm no registry field, log, or diagnostic contains prompt/response/conversation/document content and no registry production module adds `fetch`, `sendBeacon`, or server-side WebLLM.

## v0.7.0-alpha Phase 2 (Local Benchmark v1)

- [ ] Complete onboarding in a WebGPU browser; confirm the local capability check settles once and a refresh reuses the cached result.
- [ ] Cancel the check and confirm setup can continue without an error or page refresh.
- [ ] Rerun the check from Settings and confirm the previous result is replaced only after a non-cancelled result.
- [ ] Background the tab during a run and confirm the Worker is stopped and the throttled measurement is not trusted.
- [ ] Confirm mobile/tablet uses the reduced workload and the page remains responsive.
- [ ] Export `/debug` diagnostics and confirm only benchmark version/status/timings/score/stability/confidence are present; no coarse profile key, raw GPU identifier, or user content is included.
- [ ] Confirm no benchmark starts while generation/cancellation/recovery is active in Settings and that the WebLLM runtime remains loaded and usable afterward.

## v0.7.0-alpha Phase 3 (Adaptive Router Core)

- [ ] Run the model-router matrix and confirm identical inputs, registry version, and clock produce identical decisions.
- [ ] Confirm hard backend, feature/limit, memory, form-factor, metadata, task, repeated OOM, and repeated device-loss failures appear in `rejectedModels` before scoring.
- [ ] Confirm 12 GB mobile and 12 GB desktop scenarios do not receive the same performance-model outcome solely because RAM matches.
- [ ] Confirm French writing prefers suitable multilingual metadata and English coding prefers the verified coding specialist in the tested Balanced scenario.
- [ ] Confirm user cancellations do not reduce observation scores, while stale observations are ignored.
- [ ] Confirm manual selection can choose an eligible model but cannot bypass hard gates.
- [ ] Confirm fallback IDs are eligible, acyclic, bounded, and progressively no heavier.
- [ ] Confirm decisions contain no prompt/response/message/conversation/document fields and the package contains no `fetch`, `sendBeacon`, browser API, persistence, telemetry, or runtime import.
- [ ] Confirm the application still uses its fixed compatibility runtime model; Phase 3 must not silently download or switch models.

## v0.7.0-alpha Phase 4 (Runtime integration)

- [ ] Complete onboarding on a WebGPU device, open `/chat`, and confirm a `RouterDecision` is computed before the first model load — check `/debug`'s "Adaptive router" panel for a non-null selected model, reason codes, and a fallback chain, rather than the fixed default loading unconditionally with no decision behind it.
- [ ] On a device where the router's first pick is not the pre-disclosed default and is not yet cached, confirm the app loads the disclosed default immediately (chat stays usable right away) and shows a `ModelDownloadConsent` prompt with a friendly model name, approximate size, and a note that it runs locally; confirm nothing downloads until the prompt is accepted.
- [ ] Confirm dismissing the download prompt keeps the current model loaded and chat working, with no partial or silent download left running in the background.
- [ ] Change performance mode in Settings while idle and confirm either a safe model switch or a no-op (if the router picks the same model for both modes) — never an unconditional reload of the old placeholder model.
- [ ] Start a generation, then change performance mode or task in a way that would trigger a model switch; confirm the switch is deferred until generation completes and never interrupts the in-flight reply.
- [ ] After a successful chat exchange, open `/debug` and confirm "Local performance observations" shows a non-zero count with a `completed` outcome for the loaded model, and that no prompt/response text appears anywhere on the page.
- [ ] Cancel a generation (Stop) and confirm `/debug`'s observations record the outcome as `cancelled`, not a model failure.
- [ ] Confirm `/debug`'s new "Adaptive router" panel shows the selected model, confidence, reason/warning codes, fallback chain, and rejected models with reasons, and that the French UI shows translated text — no raw reason/warning/rejection codes visible outside `/debug`'s own technical-value styling.
- [ ] Confirm `/debug` shows the same adaptive recommendation, actually loaded model, runtime status, task, performance mode, and automatic/manual mode as the persistent app runtime; it must not construct an independent legacy preview.
- [ ] Switch UI language mid-session and confirm the next routing decision uses the new locale (check `/debug`), without rewriting past messages or affecting the hidden runtime language instruction.
- [ ] Confirm navigating Chat → Settings → Chat or Chat → Debug → Chat still keeps the same loaded model and does not trigger a spurious re-route or re-download.
- [ ] Export a diagnostic report and confirm it still contains no prompt/response/conversation content — only technical routing and observation fields.

## v0.7.0-alpha Phase 5 (Router UI)

- [ ] On `/chat`, once a model is selected, confirm exactly one plain-language sentence explains why (e.g. "Chosen for faster responses on this device.") — no raw reason codes, no "score 73.4"-style output.
- [ ] Confirm the model status pill/badge shows the mission's plain-language states as appropriate: Choosing a local model (briefly, before the first load), Preparing the local model (with progress), Trying a lighter model (during a fallback attempt), Ready on this device, Model unavailable — and never claims chat is blocked while a model is actually ready/generating/cancelling.
- [ ] On `/settings`, confirm "Automatic — recommended" is selected by default and switching to a specific manual model updates the active chat model through the same consent flow as automatic routing (cached/default switches immediately; anything else shows the download prompt).
- [ ] Confirm a model the router has rejected for this device appears disabled in the manual picker with the router's own plain-language rejection reason, not silently hidden or selectable.
- [ ] Open a manual model's "Advanced technical details" disclosure and confirm it shows the exact WebLLM ID, language suitability, recommended tasks, and device suitability — and that this technical panel is not visible without opening it.
- [ ] Pick "Automatic — recommended" after a manual selection and confirm chat returns to the router's own pick (through the same consent flow if that pick isn't cached).
- [ ] On a device reporting mobile form factor, trigger a download-consent prompt for a model ≥500 MB and confirm the extra mobile-data warning line appears; confirm it does not appear for the same model on a desktop-reported device.
- [ ] In `/settings`, confirm "Clear performance history" clears local model observations (verify via `/debug`'s observations count dropping to zero) without clearing conversations or the benchmark result.
- [ ] In `/settings`, confirm the local benchmark panel shows a "last checked" date once a result exists, and that "Clear result" removes it (status returns to "Not run yet").
- [ ] In a non-WebGPU browser (or with WebGPU disabled), confirm `/chat` shows a distinct "this browser can't run local AI models" message rather than the generic no-compatible-model notice.
- [ ] Simulate offline (DevTools network throttling → Offline) during a model load that needs downloading, and confirm the error banner includes an offline-specific line in addition to the existing error message.
- [ ] Manually select a model in Settings, then (for testing) make it ineligible — e.g. by simulating insufficient memory — and confirm `/chat` shows a notice that the manual pick was overridden, rather than silently falling back with no explanation.
- [ ] Repeat the manual model picker and settings changes across French/English and light/dark/system; confirm no raw technical strings leak into the translated normal-chat surface.
- [ ] Below 720px, confirm the manual model list has no page-wide horizontal overflow, each model's selectable area and the "Automatic" option meet 44×44px touch targets, and the technical-details disclosure opens without covering the rest of the page.

## v0.7.0-alpha Phase 6 (Global review corrections)

- [ ] Clear site data and repeat Getting Started: confirm the benchmark can be skipped, and confirm the compact first-model disclosure names the friendly model, approximate size, local browser cache, and separate consent for any other uncached model.
- [ ] During the first non-default recommendation, confirm the compact disclosed fallback loads while the upgrade waits for consent; cancel the prompt and complete another generation, then confirm the same prompt does not immediately reappear in a loop.
- [ ] Force the recommended model and one fallback to fail. Confirm each model is attempted at most once and no uncached, unapproved fallback starts downloading silently.
- [ ] Confirm loading progress has priority over a pending download/routing notice, and that Chat distinguishes the actually loaded model from a different pending recommendation.
- [ ] In Settings, confirm manual model buttons remain disabled with a compatibility-check message until the first capability-backed decision exists. Re-check the device, rerun/clear the benchmark, and clear performance history; each action should refresh the adaptive decision without unloading a same-model runtime unnecessarily.
- [ ] Generate successful, cancelled, stalled, and failed outcomes. Confirm loads are not counted as generations, cancellation remains neutral, repeated stalls can change eligibility, and `/debug` updates from the live provider state.
- [ ] Export diagnostics and confirm current top-level runtime/recommended/loaded values are used even if older local logs refer to another model. Confirm `contentLogged: false` and no prompt/response/conversation/document/raw GPU string appears.
- [ ] Inspect the loaded WebLLM engine options in the runtime unit/smoke harness and confirm the router's context window is applied within the verified registry preset; output tokens must remain at or below the global safety cap.

## v0.7.1-alpha (generation timeout/stall watchdog hotfix)

- [ ] Run `packages/ai-runtime/src/generationWatchdog.test.ts` and `runtime.test.ts` and confirm the regression test ("completes successfully when chunks keep streaming continuously past the old absolute-duration threshold") passes — this test is documented to fail against the pre-fix implementation.
- [ ] Start a real chat generation and let it run past 90 seconds while it keeps producing visible text (a long request to a slower model is a good way to reach this); confirm it completes normally instead of being cut off.
- [ ] Confirm a first-token timeout (no output at all) still shows "Local model needs attention" with the existing empty-bubble behavior — no partial text to preserve.
- [ ] If a genuine stall can be forced in a test/dev build (e.g. by briefly disconnecting the worker mid-stream), confirm the partial reply already shown stays visible, is saved, and shows an "incomplete" notice rather than disappearing.
- [ ] Background the tab during an active generation, wait past 45 seconds, return to the tab, and confirm the generation was not declared stalled purely from being backgrounded.
- [ ] Confirm `Stop` still interrupts a generation normally and `Reload model` recovery still works exactly as before (this hotfix must not change Stop/recovery behavior).
- [ ] Export a diagnostic report and confirm it still contains no prompt/response content, and that a safety-limit interruption (if reproduced) does not appear as a "stalled" outcome.
- [ ] Confirm French and English show the new "may be incomplete" notice correctly when a partial reply is preserved.

## Manual smoke tests (browser)

- [ ] Chat: onboarding leads to `/chat`, the local model loads, and a prompt gets a streamed reply.
- [ ] Streaming responsiveness: start a long reply and confirm visible text updates smoothly without making the history drawer/sidebar, composer, language toggle, or theme toggle feel blocked on desktop and mobile.
- [ ] Streaming autoscroll: while a reply streams at the bottom, confirm the transcript follows the latest message; then scroll upward during streaming and confirm the page does not force-scroll back down until "Scroll to latest" is clicked.
- [ ] Stop / reload: `Stop` interrupts an in-progress reply, and after a `cancel_timeout` or `generation_stalled` error, `Reload model` recovers the runtime without a page refresh.
- [ ] Stop / automatic recovery: press `Stop` during a long generation, observe `Stopping`/`Recovering`/`Ready`, then send another message without refreshing. Repeat at least twice.
- [ ] Persistent runtime navigation: load the model in `/chat`, navigate to `/settings`, return to `/chat`, and confirm the model did not unload or reload solely because of the internal route change.
- [ ] Persistent runtime debug navigation: load the model in `/chat`, navigate to `/debug`, return to `/chat`, and confirm the model did not unload or reload solely because of the internal route change.
- [ ] Generation across navigation: start a long generation, navigate to `/settings`, confirm a small global status appears with "Return to conversation", return to `/chat`, and confirm the response continued or completed in the same conversation.
- [ ] Background tab behavior: start a generation, switch to another browser tab/app, return, and confirm FreeAI Open did not intentionally unload the model or cancel the generation. Note that the browser/mobile OS may throttle or pause background work.
- [ ] Generation safety: stopped, stalled, timed-out, or unstable partial assistant output is removed from the transcript and is not saved/exported as a completed answer.
- [ ] Message layout: long unbroken strings and repeated punctuation stay inside chat bubbles on desktop and mobile; any `pre`/`code` content scrolls horizontally instead of expanding the page.
- [ ] Refresh conversation: after sending a message, refreshing the page resumes the same conversation with its full message history.
- [ ] Delete conversation: deleting a conversation asks for confirmation, then removes it from the history sidebar and IndexedDB.
- [ ] Language: switch to French, navigate home/onboarding/settings/chat/debug, and confirm visible user-facing UI is translated.
- [ ] Model response language: with French selected, send a French message and verify the local runtime receives the French hidden system instruction. Switch to English and confirm the next generation receives the English instruction.
- [ ] Theme/language persistence: change language and theme, refresh, and confirm both preferences persist locally.
- [ ] Brand assets: confirm the browser tab uses the FreeAI Open favicon, mobile/apple touch icon assets exist under `apps/web/public/brand/`, and the header renders the square symbol plus real `FreeAI Open` text rather than the large horizontal raster reference.
- [ ] Brand tokens: check light/dark/system modes for the brand palette, readable contrast, visible teal focus ring, neutral primary surfaces, restrained teal usage on active/local/focus states only, and no bright teal used as small normal text on Paper/Surface.
- [ ] Export privacy: export a conversation and confirm the JSON contains only conversation content plus export schema fields, not hidden runtime language instructions.
- [ ] Mobile history drawer: below a 720px viewport, the chat history sidebar is hidden from the normal page flow and a menu button ("Open conversation history") appears in the chat header; opening it shows an overlay drawer with New chat, conversation history, rename/delete, and export/import.
- [ ] Mobile drawer closing: the drawer closes via its close button, a backdrop click, Escape, and automatically after selecting a conversation or starting a new chat; focus returns to the menu button after closing.
- [ ] Mobile drawer accessibility: opening the drawer moves focus to the visible close button, the hidden trigger is not the active element while open, Tab/Shift+Tab do not reach chat/background controls behind the overlay, background page scrolling is blocked while open, Tab does not reach the drawer's content while it is closed and off-screen, and the drawer's open/close motion is disabled when the OS is set to reduce motion.
- [ ] Mobile drawer content: test with many conversations, a long conversation title, and a long active conversation, in both English/French and light/dark/system themes, and confirm the composer stays reachable near the bottom without page-wide horizontal scrolling.
- [ ] Desktop sidebar: above 720px, the sidebar remains visible in its normal position with no menu button or backdrop, and selection/rename/delete/import/export all still work.
- [ ] Desktop independent scrolling: above 720px on `/chat`, the browser window shows no page-level scrollbar; scroll a long conversation list inside the sidebar and confirm the message area, header, and composer do not move; scroll a long transcript in the message area and confirm the sidebar and composer stay fixed; switching conversations never scrolls the page back to the top since there is no page scroll to reset.
- [ ] Desktop workspace dimensions: above 720px on `/chat`, the app occupies the full viewport height with no visible page footer; confirm the footer is still present and unaffected on `/`, `/settings`, `/debug`, and `/onboarding`.
- [ ] Rail selected-control contrast: in light mode, open the desktop navigation rail's language/theme toggles and confirm the selected option's text ("FR", "Système", etc.) is clearly readable against its background, not white-on-light-teal; repeat in dark mode.
- [ ] Fixed mobile trigger: below 720px, scroll deep into a long conversation and confirm the "Open conversation history" button stays visible in the top-right corner the whole time, does not cover chat content, and toggles closed/open with an updated label and `aria-expanded` value.
- [ ] Fixed mobile trigger safe area: on a real notched device (or a browser device emulation with a safe-area override), confirm the fixed button and the drawer's edges are not drawn under the notch/status bar/home indicator.
- [ ] Device tier: on a real or emulated high-RAM Android phone (e.g. Redmi Note 13 Pro 5G, ~12 GB RAM), open `/onboarding/device` or `/debug` and confirm the displayed device tier is no longer `webgpu_high`/tier 3 purely from RAM — it should read tier 1 or 2 unless the browser also reports strong measured performance.
- [ ] Device tier iPadOS: on an iPadOS Safari desktop-style environment where the user agent contains `Macintosh` and multitouch is reported, confirm the app treats the form factor as a tablet rather than generic desktop and does not promote to tier 3 from RAM alone.
- [ ] Device tier contrast: compare the displayed tier for the same browser in desktop mode vs. mobile device emulation at similar RAM; confirm they differ.
- [ ] App shell desktop: above 720px, the compact Ink navigation rail is visible on the left with the brand icon, Home/Chat/Settings/Debug links (the current route shows `aria-current`), and language/theme toggles; the old horizontal header is gone.
- [ ] App shell mobile: below 720px, a compact fixed Ink top bar (brand icon + menu button) replaces the rail; opening the menu shows Home/Chat/Settings/Debug plus language/theme toggles in a small dropdown that closes via Escape, an outside click, or a route change, and is `inert` while closed.
- [ ] App shell content clearance: on every route, page content starts below the fixed mobile top bar with no overlap; on `/chat`, the chat-history trigger sits below the top bar (not overlapping it) and `.chat-layout`'s own clearance still keeps content clear of both fixed controls.
- [ ] Device capability summary: `/` and `/onboarding/device` show a plain-language capability line ("Limited compatibility" / "Suitable for lightweight models" / "Recommended experience" / "High-performance device") by default, with the numeric tier, backend, memory, and storage only visible after opening "Advanced technical details".
- [ ] Onboarding recommended mode: on `/onboarding/mode`, the mode matching this device's recommendation shows a "Recommended for this device" badge; the third mode option reads "Quality" (English) / "Qualité" (French), not "Performance", and is hidden entirely when WebGPU is unavailable.

## First-run setup and per-conversation task (v0.6.6-alpha)

- [ ] First visit: with no prior local data, opening `/` or `/chat` redirects automatically to `/onboarding` — Getting Started is shown, not merely offered as a link.
- [ ] First-run flow: `/onboarding` explains the model runs on-device in plain language, `/onboarding/device` detects the device, and `/onboarding/mode` (step 2 of 2) recommends and lets the user confirm a performance mode; confirming persists the choice and navigates straight to a working `/chat` session with no further setup step.
- [ ] Refresh after setup: once Getting Started is completed, refreshing `/` or `/chat`, or closing and reopening the tab, never shows the first-run flow again.
- [ ] Reset Getting Started: from `/settings`, resetting first-time setup (with its confirm step) sends the user to `/onboarding`, and the next visit to `/` or `/chat` shows the first-run flow again.
- [ ] New chat usage picker: clicking "New chat" (desktop sidebar and the mobile drawer) opens an accessible modal asking what the conversation is for, offering General conversation/Writing/Rewrite/Summarize/Translate/Coding/Learning (no "Analyze a document" option); selecting one creates and opens the conversation immediately and closes the dialog without asking for a performance mode.
- [ ] New chat modal accessibility: Escape and a backdrop click close the dialog without creating a conversation; Tab/Shift+Tab cycle only within the dialog's own controls; focus lands on the first option on open and returns to the "New chat" control that was clicked on close.
- [ ] Per-conversation task persists: create two conversations with different usages, switch between them, and confirm the model-status pill's task label updates to match the active conversation without requiring a page reload.
- [ ] Settings performance change: on `/settings`, picking a different performance mode does not apply until "Save performance mode" is clicked; after saving, refreshing the page and returning to `/settings` shows the newly saved mode as selected.
- [ ] Settings device re-check: "Re-check this device" on `/settings` re-runs device detection and updates the plain-language capability line without navigating away.
- [ ] Old conversations without a task: a conversation created before this release (or via a locally-crafted test fixture with no `task` field) opens normally in `/chat` and behaves as a general conversation, without an error or a forced task prompt.
- [ ] Import backward compatibility: an export file from before the `task` field existed still imports successfully with a normal result summary.
- [ ] Export preserves task: export a conversation created through the New Chat picker, inspect the JSON, and confirm it includes the chosen `task` value alongside the existing fields.
- [ ] Settings performance during generation: while a response is generating, navigate to `/settings`, pick a different performance mode, and confirm saving is disabled with a plain-language notice rather than silently interrupting the generation.
- [ ] Chat composer: the message field is a multiline textarea; Enter sends, Shift+Enter inserts a newline, and a visible hint states this; on mobile the on-device keyboard's return key is labeled for sending where the OS supports `enterKeyHint`.
- [ ] Chat message roles: user and assistant messages are visually distinguishable (alignment plus a subtle neutral surface difference, not a strong color) and each carries a screen-reader-only role label; verify with a screen reader or the accessibility tree, not just visually.
- [ ] Runtime status wording: the chat header's runtime badge shows plain language ("Preparing the local model", "Ready on this device", "Writing a response", …), never a raw status code; `/debug` shows the raw status code instead.
- [ ] Local-model-unavailable error: the default message is plain language with a "Reload model" action; the raw runtime error code is only visible after opening "Technical details".
- [ ] Debug dashboard Ink theme: `/debug` renders with an Ink background regardless of the site's light/dark/system theme setting, with correct contrast, and technical values (backend, tier, form factor, model source/status/size/license, timings, tokens/sec, log entries, `contentLogged`) render in monospace while explanatory text stays sans-serif.
- [ ] Conversation history active state: the active conversation is visually unmistakable (accent-soft background, left accent stripe, bold text) and does not rely on color alone (also carries `aria-current`); rename/delete controls are present but visually quiet.
- [ ] Mobile touch targets: below 720px or with a coarse pointer, confirm language/theme choices, the mobile history trigger, drawer close button, conversation rename/delete/confirm/cancel actions, and import/export actions are at least 44×44px and remain usable with long conversation titles.
- [ ] Light-mode contrast: inspect helper text, muted labels, status pills, recommended badge, links, form hints, empty states, and disabled states on Paper and Surface; normal-size text should meet at least 4.5:1 and control/focus boundaries should remain visible.
- [ ] Six-combination check: repeat a chat + onboarding walkthrough across light/dark/system × English/French and confirm the redesign stays intentional and legible in all six combinations, with no leftover hardcoded colors that ignore the theme.
- [ ] Responsive sweep: check large desktop (≥1440px), laptop (~1280px), tablet (~768–1024px), mobile portrait, and mobile landscape widths; confirm no page-wide horizontal overflow, no fixed control covers unrelated content, and no large blank section appears from desktop-only spacing carried onto a narrow viewport.
- [ ] 200% browser zoom: repeat the chat and home/onboarding walkthrough at 200% zoom; confirm text reflows without clipping, the app shell remains usable, and no control becomes unreachable.

## Future automated coverage

- [ ] Add browser-level tests for persisted chat refresh and delete confirmation once the project deliberately adopts a browser/E2E test framework. Do not add Playwright or another heavy framework only for this checklist item.
- [ ] Add browser-level tests for streaming autoscroll/follow behavior and mobile streaming responsiveness once the project has a browser test layer.

## Privacy and diagnostics

- [ ] Diagnostic report privacy check: export a diagnostic report from `/debug` and confirm it contains no prompt, response, document, or conversation content — only technical fields.
- [ ] Confirm diagnostic report has `contentLogged: false` and does not include hidden runtime language instructions.
- [ ] Confirm local technical logs contain no conversation content (spot-check a few recent log entries from `/debug`).

## Deployment and secrets

- [ ] Netlify deploy check: a preview or production deploy builds and serves the app without errors.
- [ ] No secrets check: no API keys, tokens, or credentials are committed or exposed in client bundles.

## Documentation

- [ ] `README.md` reflects current status, features, and non-negotiable privacy rules.
- [ ] `CHANGELOG.md` has an entry for the release version.
- [ ] `docs/DEVLOG.md` documents the sprint(s) included in the release, with implemented work, known limitations, and planned work clearly separated.
