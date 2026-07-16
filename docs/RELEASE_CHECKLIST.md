# Release checklist

Run through this list before cutting an alpha release. All boxes should be checked before tagging a version and updating `README.md`, `CHANGELOG.md`, and `docs/DEVLOG.md`.

## Automated checks

- [ ] `pnpm -r typecheck` passes for every package and app.
- [ ] `pnpm -r test` passes for every package and app.
- [ ] `pnpm lint` passes with no errors.
- [ ] `pnpm build` succeeds (Next.js production build).

## Manual smoke tests (browser)

- [ ] Chat: onboarding leads to `/chat`, the local model loads, and a prompt gets a streamed reply.
- [ ] Streaming responsiveness: start a long reply and confirm visible text updates smoothly without making the history drawer/sidebar, composer, language toggle, or theme toggle feel blocked on desktop and mobile.
- [ ] Streaming autoscroll: while a reply streams at the bottom, confirm the transcript follows the latest message; then scroll upward during streaming and confirm the page does not force-scroll back down until "Scroll to latest" is clicked.
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
- [ ] Mobile history drawer: below a 720px viewport, the chat history sidebar is hidden from the normal page flow and a menu button ("Open conversation history") appears in the chat header; opening it shows an overlay drawer with New chat, conversation history, rename/delete, and export/import.
- [ ] Mobile drawer closing: the drawer closes via its close button, a backdrop click, Escape, and automatically after selecting a conversation or starting a new chat; focus returns to the menu button after closing.
- [ ] Mobile drawer accessibility: opening the drawer moves focus to the visible close button, the hidden trigger is not the active element while open, Tab/Shift+Tab do not reach chat/background controls behind the overlay, background page scrolling is blocked while open, Tab does not reach the drawer's content while it is closed and off-screen, and the drawer's open/close motion is disabled when the OS is set to reduce motion.
- [ ] Mobile drawer content: test with many conversations, a long conversation title, and a long active conversation, in both English/French and light/dark/system themes, and confirm the composer stays reachable near the bottom without page-wide horizontal scrolling.
- [ ] Desktop sidebar: above 720px, the sidebar remains visible in its normal position with no menu button or backdrop, and selection/rename/delete/import/export all still work.
- [ ] Fixed mobile trigger: below 720px, scroll deep into a long conversation and confirm the "Open conversation history" button stays visible in the top-right corner the whole time, does not cover chat content, and toggles closed/open with an updated label and `aria-expanded` value.
- [ ] Fixed mobile trigger safe area: on a real notched device (or a browser device emulation with a safe-area override), confirm the fixed button and the drawer's edges are not drawn under the notch/status bar/home indicator.
- [ ] Device tier: on a real or emulated high-RAM Android phone (e.g. Redmi Note 13 Pro 5G, ~12 GB RAM), open `/onboarding/device` or `/debug` and confirm the displayed device tier is no longer `webgpu_high`/tier 3 purely from RAM — it should read tier 1 or 2 unless the browser also reports strong measured performance.
- [ ] Device tier iPadOS: on an iPadOS Safari desktop-style environment where the user agent contains `Macintosh` and multitouch is reported, confirm the app treats the form factor as a tablet rather than generic desktop and does not promote to tier 3 from RAM alone.
- [ ] Device tier contrast: compare the displayed tier for the same browser in desktop mode vs. mobile device emulation at similar RAM; confirm they differ.

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
