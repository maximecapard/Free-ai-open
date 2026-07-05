## Summary

Describe the goal of this PR in a sentence or two.

## Changes made

List the concrete changes (files/areas touched, new behavior, removed behavior).

## Scope

- [ ] UI
- [ ] Runtime
- [ ] Device profiler
- [ ] Model router
- [ ] Telemetry
- [ ] Privacy/security
- [ ] Docs
- [ ] Tests

## Privacy/security impact

Describe any effect on what data can leave the browser, or say "none".

- [ ] No prompts are sent to the server.
- [ ] No model responses are sent to the server.
- [ ] No uploaded documents are sent to the server.
- [ ] Telemetry events pass through the redactor.
- [ ] Server endpoints reject forbidden fields.

## Local storage impact

Describe any effect on IndexedDB conversation storage, local technical logs, limits, or schema, or say "none".

## Diagnostic/logging impact

Describe any effect on `/debug`, diagnostic report fields, or local technical logs, or say "none".

## Tests run

List automated tests added/updated and any manual browser checks performed (chat, stop/reload, conversation history, debug dashboard, etc.).

## Docs updated

List docs updated (README/CHANGELOG/DEVLOG/architecture/privacy/security), or say "not applicable" and explain why.

## Checklist

- [ ] No prompt, response, document, or conversation content is logged (console, local technical logs, or diagnostic reports).
- [ ] No `fetch`/`sendBeacon`/server endpoint was added for content that should stay local, unless explicitly intended and described above.
- [ ] No Supabase/Google Drive/cloud sync path was added, unless explicitly intended and described above.
- [ ] Docs were updated if behavior, architecture, privacy/security guarantees, or developer workflow changed.
- [ ] `pnpm -r typecheck`, `pnpm -r test`, `pnpm lint`, and `pnpm build` pass.

## Known limitations

List known risks or follow-ups.
