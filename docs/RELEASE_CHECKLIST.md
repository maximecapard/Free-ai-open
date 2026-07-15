# Release checklist

Run through this list before cutting an alpha release. All boxes should be checked before tagging a version and updating `README.md`, `CHANGELOG.md`, and `docs/DEVLOG.md`.

## Automated checks

- [ ] `pnpm -r typecheck` passes for every package and app.
- [ ] `pnpm -r test` passes for every package and app.
- [ ] `pnpm lint` passes with no errors.
- [ ] `pnpm build` succeeds (Next.js production build).

## Manual smoke tests (browser)

- [ ] Chat: onboarding leads to `/chat`, the local model loads, and a prompt gets a streamed reply.
- [ ] Stop / reload: `Stop` interrupts an in-progress reply, and after a `cancel_timeout` or `generation_stalled` error, `Reload model` recovers the runtime without a page refresh.
- [ ] Stop / automatic recovery: press `Stop` during a long generation, observe `Stopping`/`Recovering`/`Ready`, then send another message without refreshing. Repeat at least twice.
- [ ] Generation safety: stopped, stalled, timed-out, or unstable partial assistant output is removed from the transcript and is not saved/exported as a completed answer.
- [ ] Message layout: long unbroken strings and repeated punctuation stay inside chat bubbles on desktop and mobile; any `pre`/`code` content scrolls horizontally instead of expanding the page.
- [ ] Refresh conversation: after sending a message, refreshing the page resumes the same conversation with its full message history.
- [ ] Delete conversation: deleting a conversation asks for confirmation, then removes it from the history sidebar and IndexedDB.
- [ ] Language: switch to French, navigate home/onboarding/settings/chat/debug, and confirm visible user-facing UI is translated.
- [ ] Model response language: with French selected, send a French message and verify the local runtime receives the French hidden system instruction. Switch to English and confirm the next generation receives the English instruction.
- [ ] Theme/language persistence: change language and theme, refresh, and confirm both preferences persist locally.
- [ ] Export privacy: export a conversation and confirm the JSON contains only conversation content plus export schema fields, not hidden runtime language instructions.

## Future automated coverage

- [ ] Add browser-level tests for persisted chat refresh and delete confirmation once the project deliberately adopts a browser/E2E test framework. Do not add Playwright or another heavy framework only for this checklist item.

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
