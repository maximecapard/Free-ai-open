# Claude Code task — debug dashboard

## Objective

Implement `/debug` as a local technical dashboard.

## Required sections

- Device profile
- Runtime status
- Selected model
- Router decision
- Recent local logs
- Last redacted telemetry payloads
- Cache/storage status placeholder
- Export debug report button
- Clear local logs button

## Privacy constraints

The debug dashboard must not display raw prompts/responses by default.

If prompt/response length is shown, show numeric lengths only.

## Definition of done

- `/debug` renders in the browser.
- Shows meaningful technical data.
- Export report is redacted.
- Content is never included by default.
