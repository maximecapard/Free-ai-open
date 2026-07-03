# Codex task — device-profiler package

You are working on a dedicated branch.

## Objective

Implement `packages/device-profiler` as an isolated, tested TypeScript package.

## Requirements

- Detect WebGPU availability safely.
- Detect WASM availability.
- Estimate memory if `navigator.deviceMemory` exists.
- Estimate storage quota if available.
- Classify device tier 0-4.
- Avoid excessive fingerprinting.
- Return approximate browser/OS family only.
- Include unit tests with mocked navigator objects.

## Do not touch

- `apps/web` except for minimal type exports if absolutely necessary.
- runtime WebLLM integration.
- telemetry endpoint.

## Definition of done

- Tests cover WebGPU present/absent.
- Tests cover low/mid/high memory.
- Tests cover missing APIs.
- Types exported.
- Short docs added if needed.
