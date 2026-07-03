# Claude Code task — integrate device profiler and model router

## Objective

Connect the device profiler, model registry, and model router to the real onboarding/chat flow.

## Requirements

1. Run device profiling client-side.
2. Determine device tier.
3. Let user choose Fast/Balanced/Performance.
4. Let user choose task category.
5. Route to recommended model.
6. Show a simple explanation.
7. Show advanced technical details behind a disclosure section.
8. Handle no-compatible-model gracefully.
9. Log router decisions locally without content.

## Definition of done

- User sees recommended model.
- Router decision is explainable.
- Fallback state exists.
- No server content leakage.
