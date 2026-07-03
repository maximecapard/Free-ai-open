# Codex task — model registry

## Objective

Create a robust model registry package and sample registry.

## Requirements

- Define `ModelRecord` with Zod validation.
- Include fields for display name, technical name, source, URL, tasks, device tier, estimated sizes, backend, license, verified flag, hash, status.
- Add sample records clearly marked experimental.
- Add tests for valid/invalid records.
- Add docs/model-registry.md explaining how to add a model.

## Privacy/security

Model records must not contain secrets.

## Definition of done

- Zod schema works.
- Tests pass.
- Documentation explains required fields and license checks.
