# Model registry

Every model record must include:

- `id`
- `displayName`
- `technicalName`
- `source`
- `modelUrl`
- `tasks`
- `minDeviceTier`
- `recommendedDeviceTier`
- `estimatedDownloadGb`
- `estimatedRamGb`
- `backend`
- `license`
- `verified`
- `sha256` when available
- `status`

## Rules

- Do not mark a model stable until it has been tested in the browser.
- Do not redistribute models without checking the license.
- Do not use a mirror for a model unless the hash and source are documented.
- Advanced/manual users may select experimental models, but the UI must warn them.
