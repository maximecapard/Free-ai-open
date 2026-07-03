# Claude Code task — consumer app shell UI

## Objective

Create the main consumer-facing app shell for FreeAI Open.

## Requirements

Build these pages/components:

- landing page;
- onboarding intro;
- performance mode selection;
- task category selection;
- chat layout;
- model status pill;
- privacy notice;
- footer with support placeholder;
- settings entry point;
- debug link.

## UX constraints

- Must feel like a product, not a dev demo.
- Technical details hidden by default.
- Advanced model selection can be a placeholder.
- Clearly state that conversations stay local.
- No aggressive donation UI.

## Technical constraints

- Use Client Components only where needed.
- Do not implement server-side auth.
- Do not send user content to telemetry.

## Definition of done

- App has a clean navigable flow.
- The user can select task and performance mode.
- Chat page receives selected task/mode.
- Static pages can render without browser-only APIs.
