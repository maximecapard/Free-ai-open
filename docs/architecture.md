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

- `ai-runtime`: browser inference types/wrapper, stop/reload recovery, and alpha generation safety limits.
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

- Language: plain per-locale dictionaries (`apps/web/app/_i18n/locales/en.ts`, `fr.ts`) looked up through a small `useTranslations()` React context (`apps/web/app/_i18n`). No translation service, API, or AI runtime call is involved; dictionaries ship as static data in the client bundle. The active locale defaults to the browser's language on first visit and is persisted in `localStorage`.
- Theme: CSS custom-property color tokens defined in `globals.css` for dark (default) and light, toggled via a `data-theme` attribute on `<html>` set by a `useTheme()` React context (`apps/web/app/_theme`) and persisted in `localStorage`. "System" leaves the attribute unset and relies on a `prefers-color-scheme` media query. A blocking inline script in the root layout applies a stored light/dark choice before hydration to avoid a flash of the wrong theme.
- Neither system sends data to a server or stores anything beyond a small preference value (locale or theme name) in `localStorage`.
