# Codex task — PR review

Review the current PR/branch for FreeAI Open.

## Check for blockers

- Prompts, responses, documents, or chat history sent to server.
- WebLLM/WebGPU/IndexedDB imported in Server Components.
- Telemetry without redaction.
- Raw console logging of sensitive data.
- Unknown fields accepted by telemetry endpoint.
- Missing tests for security-sensitive code.
- Unnecessary dependencies.
- CSP/security regression.
- Architecture violations against AGENTS.md.

## Output format

1. Blocking issues
2. Important issues
3. Suggestions
4. Tests to add
5. Documentation updates needed
6. Verdict: merge / merge after fixes / do not merge
