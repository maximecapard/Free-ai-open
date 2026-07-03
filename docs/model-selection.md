# Model selection strategy

## Inputs

The router uses:

- device tier;
- WebGPU/WASM availability;
- task category;
- performance mode;
- model registry metadata;
- estimated RAM/download size;
- model status;
- license status;
- past local failures.

## Modes

### Fast

Prioritize low memory, short load time, high compatibility.

### Balanced

Prioritize the best fit for daily use.

### Performance

Prioritize stronger models when the device tier allows it.

## Task categories

- chat
- writing
- rewrite
- summarization
- translation
- coding
- learning
- document_analysis

## Manual selection

Advanced users can bypass recommendations and select a model manually, but the UI must still show warnings for unsupported or experimental models.
