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
- Theme: CSS custom-property color tokens defined in `globals.css` for dark (default) and light, toggled via a `data-theme` attribute on `<html>` set by a `useTheme()` React context (`apps/web/app/_theme`) and persisted in `localStorage`. "System" leaves the attribute unset and relies on a `prefers-color-scheme` media query. A blocking inline script in the root layout applies a stored light/dark choice before hydration to avoid a flash of the wrong theme.
- Neither system sends data to a server or stores anything beyond a small preference value (locale or theme name) in `localStorage`.

## Runtime cancellation recovery

Stop/cancel is handled as a runtime lifecycle transition, not just a UI interruption:

1. `stopGeneration()` moves the runtime from `generating` to `cancelling` immediately and logs `inference.cancel.requested`.
2. A real abort confirmation logs `inference.cancelled`, but the interrupted runtime is not treated as safe/ready for a new generation.
3. The app enters `recovering`, records `runtime.recovery.started`, tears down the old worker with bounded termination, creates a new worker/runtime, and reloads the cached model.
4. The app returns to `ready` and logs `runtime.recovery.completed` only after the replacement runtime finishes loading the model.
5. If reload fails, the app records `runtime.recovery.failed` and exposes the existing Reload model action.

Late chunks or confirmations from an abandoned generation must not overwrite newer runtime state.

## Mobile navigation

Below a 720px viewport width, the `/chat` history panel (new chat, conversation list, rename/delete, export/import) is presented as an off-canvas drawer instead of a permanent block in the document flow:

- `apps/web/app/_lib/mobileHistoryDrawer.ts`: a pure reducer for the drawer's open/closed state, with distinct action types for each required closing trigger (selection, new chat, Escape, backdrop click, desktop viewport resize).
- `apps/web/app/_components/useMobileHistoryDrawer.ts`: a hook that wires the reducer to DOM behavior — Escape key handling, backdrop clicks, background scroll lock while open, focus restoration to the trigger button on close, and closing automatically if the viewport becomes desktop-sized.
- `apps/web/app/_components/ChatHistoryDrawerPanel.tsx`: wraps the existing `ChatHistorySidebar` (unchanged) with a backdrop, a mobile-only close button, and dialog semantics (`role="dialog"`, `aria-modal`, `aria-label`) that only apply at mobile viewport widths; the closed panel is marked `inert` on mobile so it isn't keyboard-reachable while off-screen.
- CSS in `globals.css` hides the trigger button, backdrop, and panel header by default and only shows them inside the existing `max-width: 720px` media query; the panel itself is a plain pass-through wrapper on desktop, so the fixed-width sidebar layout above that breakpoint is unchanged.

No JavaScript drives the desktop/mobile visual switch; a small `matchMedia` listener is used only to correct ARIA semantics and force-close the drawer if the viewport crosses the breakpoint while it's open.
