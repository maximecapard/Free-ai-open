# Architecture

## High-level design

```txt
Browser
├─ Next.js client UI
├─ WebLLM/WebGPU runtime in Web Worker
├─ IndexedDB local conversations
├─ Local JSON conversation export/import helpers
├─ Cache Storage / model cache
├─ Local logs
└─ Redacted telemetry client
       ↓
Netlify /api/telemetry
       ↓
Validation + redaction
       ↓
Technical telemetry persistence (planned)
```

## Data boundary

Private data stays in the browser:

- conversations;
- prompts;
- responses;
- uploaded documents;
- local preferences;
- local debug logs.

Server data is technical only:

- telemetry events;
- compatibility reports;
- model registry metadata;
- security events;
- public feedback.

## Packages

- `ai-runtime`: browser inference types/wrapper, runtime-only language instruction injection, stop/reload/recovery states, and alpha generation safety limits.
- `device-profiler`: capability estimation.
- `model-router`: task/mode/device based model selection.
- `model-registry`: model metadata and validation.
- `local-storage`: IndexedDB and local persistence.
- `conversation-store`: local-only browser conversation persistence.
- `conversation-export`: versioned local JSON conversation export/import helpers.
- `logger`: structured local logs.
- `privacy-redactor`: removes sensitive data.
- `telemetry`: event schemas and client/server helpers.
- `server-data`: placeholder for future server-side technical data persistence.

## Client/server rule

Browser-only code must never run in Server Components.

Browser-only APIs include:

- WebGPU;
- WebLLM;
- IndexedDB;
- Cache Storage;
- Web Workers;
- navigator APIs.

## UI language and theme

Translation and theme are app-level (`apps/web`) concerns, not packages, since they are tightly coupled to this app's specific UI strings and design tokens.

- Language: plain per-locale dictionaries (`apps/web/app/_i18n/locales/en.ts`, `fr.ts`) looked up through a small `useTranslations()` React context (`apps/web/app/_i18n`). No translation service or API call is involved; dictionaries ship as static data in the client bundle. The active locale defaults to the browser's language on first visit and is persisted in `localStorage`.
- Model response language: before local inference, `apps/web` passes the selected locale to `ai-runtime`, which adds a hidden system message to the WebLLM message list. This message is runtime-only: it is not conversation-store data, not displayed, not exported, not included in diagnostics, and not written to local logs. Language adherence is best effort and depends on model capability.
- Brand/design tokens: `apps/web/app/globals.css` defines the `--fo-*` token foundation from the FreeAI Open brand guide: source palette, semantic surfaces, text, borders, accent/focus, radii, spacing, typography, and motion durations. Existing `--color-*` variables remain as compatibility aliases; every current app surface (home, onboarding, chat, history, debug, settings) has been migrated onto the `--fo-*`/`.fo-*` foundation. Light-mode semantic text tokens deliberately separate visual brand teal from small text: `--fo-accent` can stay on the brighter brand teal for accents, while `--fo-accent-text` uses a darker accessible teal for normal-size labels, helper text, and badges.
- Application shell: `apps/web/app/_components/Header.tsx` renders a compact, always-Ink navigation rail on desktop and a compact fixed, safe-area-aware top bar with a small dropdown menu on mobile, both from the same markup — CSS alone (the same 720px breakpoint used by the chat drawer) decides which is visible. `apps/web/app/layout.tsx` wraps it and `{children}` in `.app-shell`/`.app-shell__content`. The rail/top bar are deliberately dark (`--fo-ink-950`) regardless of the selected theme, so the navigation chrome reads as stable structure while the main content area follows the theme normally. `/debug` uses the same technique for its whole page (see `.fo-ink-surface` in `globals.css`): rather than a separate "ink" variant of every class, `.fo-ink-surface` overrides the semantic `--fo-*` custom properties themselves within that subtree, so any existing token-based class or component resolves to the correct ink-forced colors automatically.
- Theme: CSS custom-property color tokens defined in `globals.css` for dark (default) and light, toggled via a `data-theme` attribute on `<html>` set by a `useTheme()` React context (`apps/web/app/_theme`) and persisted in `localStorage`. "System" leaves the attribute unset and relies on a `prefers-color-scheme` media query. A blocking inline script in the root layout applies a stored light/dark choice before hydration to avoid a flash of the wrong theme.
- Brand assets: production web PNGs live under `apps/web/public/brand/` and are referenced by the app metadata and compact navigation. Source brand files stay local-only under `.local/brand-source/` and are not part of the public repository. A true vector logo source is still future brand work.
- Neither system sends data to a server or stores anything beyond a small preference value (locale or theme name) in `localStorage`.

## Runtime cancellation recovery

Stop/cancel is handled as a runtime lifecycle transition, not just a UI interruption:

1. `stopGeneration()` moves the runtime from `generating` to `cancelling` immediately and logs `inference.cancel.requested`.
2. A real abort confirmation logs `inference.cancelled`, but the interrupted runtime is not treated as safe/ready for a new generation.
3. The app enters `recovering`, records `runtime.recovery.started`, tears down the old worker with bounded termination, creates a new worker/runtime, and reloads the cached model.
4. The app returns to `ready` and logs `runtime.recovery.completed` only after the replacement runtime finishes loading the model.
5. If reload fails, the app records `runtime.recovery.failed` and exposes the existing Reload model action.

Late chunks or confirmations from an abandoned generation must not overwrite newer runtime state.

## Streaming render responsiveness

The WebLLM worker stream is not throttled or modified. Streaming responsiveness is handled at the UI boundary in `/chat`:

- `apps/web/app/_lib/streamingBuffer.ts` batches visible assistant-text updates with `STREAM_RENDER_INTERVAL_MS` so very small token chunks do not trigger a React render for every chunk.
- `apps/web/app/chat/page.tsx` still accumulates the full assistant text in memory for completion handling and local persistence decisions. The buffer controls only when the transcript receives visible text.
- Pending buffered text is flushed on normal completion, cancellation, runtime error, or disposal so no characters are lost and no timer updates a stale assistant bubble after the generation path finishes.
- `apps/web/app/_lib/chatAutoscroll.ts` keeps scroll-follow behavior based on "near bottom" metrics. The transcript schedules scroll work through `requestAnimationFrame` and stops forcing scroll when the user has moved away from the bottom.
- The history drawer/sidebar/export controls and individual message bubbles are memoized so unchanged regions do not rerender for each buffered transcript update; language and theme still flow through React context.

The buffering layer is in-memory UI state only. It does not write generated text to local technical logs, diagnostic reports, telemetry, or any server path. Transcript virtualization remains future work for very long imported conversations.

## Mobile navigation

Below a 720px viewport width, the `/chat` history panel (new chat, conversation list, rename/delete, export/import) is presented as an off-canvas drawer instead of a permanent block in the document flow:

- `apps/web/app/_lib/mobileHistoryDrawer.ts`: a pure reducer for the drawer's open/closed state, with distinct action types for each required closing trigger (open, close, toggle, selection, new chat, Escape, backdrop click, desktop viewport resize).
- `apps/web/app/_components/useMobileHistoryDrawer.ts`: a hook that wires the reducer to DOM behavior — Escape key handling, backdrop clicks, background scroll lock while open, focus transfer to the close button on open, background isolation with `inert` where supported, focus redirection back into the drawer if needed, focus restoration to the trigger button on close, and closing automatically if the viewport becomes desktop-sized.
- `apps/web/app/_components/ChatHistoryDrawerPanel.tsx`: wraps the existing `ChatHistorySidebar` (unchanged) with a backdrop, a mobile-only close button, and dialog semantics (`role="dialog"`, `aria-modal`, `aria-label`) that only apply at mobile viewport widths; the closed panel is marked `inert` on mobile so it isn't keyboard-reachable while off-screen.
- CSS in `globals.css` hides the trigger button, backdrop, and panel header by default and only shows them inside the existing `max-width: 720px` media query; the panel itself is a plain pass-through wrapper on desktop, so the fixed-width sidebar layout above that breakpoint is unchanged.

No JavaScript drives the desktop/mobile visual switch; a small `matchMedia` listener is used only to correct ARIA semantics and force-close the drawer if the viewport crosses the breakpoint while it's open.

The trigger button itself is `position: fixed` on mobile (top-right corner, offset by `env(safe-area-inset-top/right, 0px)`, above the drawer's own `z-index`), not just visually positioned in the heading row, so it stays reachable while scrolling through a long conversation instead of scrolling away with the page. `apps/web/app/layout.tsx` sets `viewport: { viewportFit: "cover" }` so those `env()` safe-area values actually resolve on notched/rounded-corner devices instead of silently evaluating to zero. `.chat-layout` gets matching top padding on mobile so the fixed button never overlaps the content underneath it, and the button toggles/hides itself while the drawer is open rather than staying visible above the open panel. Because the trigger is hidden while open, focus is moved into the drawer before the background is keyboard-reachable; closing through any existing close path restores focus to the trigger when it still exists.

## Device capability profiling

`@free-ai-open/device-profiler` builds a local, coarse capability profile used to pick a device tier (`0`–`4`, a plain `DeviceTier`) for `model-router`. The tier used to be derived almost entirely from `navigator.deviceMemory`, which classified any device with ≥8 GB of RAM as `webgpu_high` (tier 3) regardless of form factor — putting a 12 GB Android phone in the same tier as a desktop PC. The tier calculation is now a small, documented scoring model instead:

- `packages/device-profiler/src/capabilities.ts`: coarse, non-identifying detectors — `detectFormFactor` (`mobile`/`tablet`/`desktop`/`unknown`, from the UA-CH `mobile` hint and user-agent heuristics; the iPadOS desktop-style rule checks `Macintosh`/`Mac OS` plus `maxTouchPoints > 1` before generic macOS desktop classification, and contradictory hints fall back to `"unknown"`), `detectArchitectureClass` (`arm`/`x86`/`unknown`, from the Client Hints `getHighEntropyValues(["architecture"])` API when available — never guessed from OS family, since e.g. Apple Silicon Macs are ARM despite reporting `macos`), `classifyMemory`/`classifyCpuConcurrency` (bucket raw GB/core counts into `low`/`medium`/`high`/`unknown`), and `detectCpuConcurrency` (`navigator.hardwareConcurrency`).
- `packages/device-profiler/src/scoring.ts`: `getDeviceTier` gates tier `0` on WebGPU availability alone (unchanged from before — WASM-only devices stay at the most conservative tier). For WebGPU-capable devices, it sums small bounded points for memory class, CPU-concurrency class, and a fixed WebGPU baseline point (2 + 2 + 1 max — no single signal, least of all memory, can reach a high tier alone), then applies a **form-factor tier cap** (`mobile` capped at tier 2, `tablet` at 3, `unknown` at 3, `desktop` uncapped) so coarse signals alone can never place a phone alongside desktop-class hardware. An optional `measuredPerformance.tokensPerSecond` can promote a device above its cap (bounded by what the coarse signals already suggested), and a `measuredPerformance.recentFailureCount` of 2+ demotes the result by one tier, floored at tier 1.
- `DeviceProfile` now always includes `formFactor`, `architectureClass`, `memoryClass`, `cpuConcurrencyClass`, and an optional `measuredPerformance` echo. All of these are coarse, bounded categories or optional locally-supplied numbers — never a raw sensor value, a raw user-agent string, or anything that could act as a unique hardware fingerprint.

### Plain-language presentation

`apps/web/app/_lib/deviceRecommendation.ts` adds `describeDeviceCapability(webgpuAvailable, deviceTier)`, a pure function mapping the raw tier to one of four public-facing categories ("Limited compatibility", "Suitable for lightweight models", "Recommended experience", "High-performance device") with boundaries that intentionally mirror `recommendPerformanceMode()`, so the label a user sees always matches the mode the app actually recommends. `apps/web/app/_components/DeviceCapabilitySummary.tsx` is the single shared presentational component (used on the home page and `/onboarding/device`) that shows this plain-language summary by default and keeps the raw tier/backend/memory/storage fields behind an "Advanced technical details" disclosure, matching the "simple by default, technical on demand" rule for the normal (non-technical) interface. `/debug` remains the one surface that shows raw technical values by default.

The home page's "Use the recommended setup" CTA also uses `apps/web/app/_lib/deviceRecommendation.ts` as its source of truth. Once `detectDeviceProfile()` resolves locally in the browser, `getRecommendedChatPath()` maps the current `DeviceProfile.deviceTier` to `/chat?task=chat&mode=<recommended>`. While profiling is still pending, the home page shows a detection state instead of hardcoding `balanced`. The `/onboarding/mode` recommendation badge consumes the same profile-to-mode helper, so home and onboarding cannot diverge without a test failure.

### Future router integration

`model-router` only ever reads `DeviceProfile.deviceTier` (a plain `0–4` number) and did not need any changes for this refinement. The clean integration point for v0.7 is `DeviceProfilerEnvironment.measuredPerformance` / `DeviceTierInput.measuredPerformance`: a caller (`apps/web`) can source `tokensPerSecond`, `modelLoadTimeMs`, `firstTokenTimeMs`, and `recentFailureCount` from its own recent `@free-ai-open/local-logs` history and pass them into `buildDeviceProfile()` before routing, letting real measured performance promote or demote a device's tier over time instead of relying on coarse signals alone. No caller wires this yet — `detectDeviceProfile()`'s default call leaves `measuredPerformance` unset rather than faking a measurement. Once wired, `model-router` can also start preferring mobile-compatible/lightweight models on capped-tier devices, balanced/performance models on promoted ones, and French-capable/multilingual models when French is selected, without any structural change to how it consumes the profile.
