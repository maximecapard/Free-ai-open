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
