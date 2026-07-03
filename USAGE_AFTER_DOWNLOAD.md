# What to do after downloading this template

## 1. Create the GitHub repo

Create a new public GitHub repository:

```txt
free-ai-open
```

Then copy all template files into it.

## 2. Open the repo in your editor

Use the desktop apps you already use:

- Claude Code Desktop for the main integration tasks.
- Codex Desktop for isolated tasks, tests, docs, and review.

## 3. Read these files first

Read in this order:

1. `PROJECT_BRIEF.md`
2. `README.md`
3. `AGENTS.md`
4. `CLAUDE.md`
5. `docs/ai-workflow.md`
6. `docs/roadmap.md`

## 4. Start with Claude Code

Open Claude Code in the repo and paste:

```txt
prompts/claude-code/01-repo-bootstrap.md
```

Claude Code should check the scaffold, fix missing config, and make the project runnable.

## 5. Start Codex in parallel

While Claude Code works on the bootstrap, ask Codex to work on an isolated task:

```txt
prompts/codex/02-model-registry.md
```

or

```txt
prompts/codex/04-privacy-redactor.md
```

## 6. Use branches

Recommended first branches:

```txt
feature/claude-bootstrap
feature/codex-model-registry
feature/codex-privacy-redactor
```

## 7. Never let both agents modify the same area

Good split:

- Claude Code: `apps/web`, runtime integration, UI integration.
- Codex: `packages/*` modules, tests, docs, review.

Bad split:

- Claude and Codex both rewrite `apps/web/app` at the same time.

## 8. Validation loop

After each task:

1. Run lint/typecheck/tests.
2. Read the agent summary.
3. Ask Codex to review Claude's PR/changes.
4. Ask Claude Code to integrate Codex modules.
5. Test manually in the browser.
6. Merge into `dev`, then eventually `main`.

## 9. First milestone to aim for

The first real milestone is:

```txt
A user can open the app, choose a task, load a lightweight WebLLM model, chat locally, and see a basic debug panel without any prompt/response being sent to the server.
```
