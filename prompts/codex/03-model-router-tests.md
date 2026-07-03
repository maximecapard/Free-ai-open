# Codex task — model router tests and edge cases

## Objective

Improve `packages/model-router` with robust tests and edge case handling.

## Requirements

Test these cases:

- Fast mode chooses lighter compatible model.
- Balanced mode chooses best device fit.
- Performance mode chooses strongest compatible model.
- Unsupported task rejected.
- Device tier too low rejected.
- Blocked model rejected.
- No compatible model returns null with reason.
- Rejected model reasons are explicit.

## Do not touch

- UI integration.
- WebLLM runtime.

## Definition of done

- Router remains pure and deterministic.
- Vitest tests pass.
- Edge cases documented in `docs/model-selection.md` if needed.
