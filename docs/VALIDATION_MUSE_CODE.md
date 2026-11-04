# Validation: Meta Muse Code as the remediation agent (Nov 4 2026)

**Result: Muse Code runs headless and sandboxed, and the remediation runner works end to end locally. Not yet run on GitHub Actions or against production.**

## Setup

- Muse Code 1.4.14 (1.4.14-R7309.1), installed with the official installer (`dev.meta.ai/install.ps1`) on Windows 11, authenticated with the project's `META_API_KEY` (pay-as-you-go).
- Flags used by the runner: `muse exec --json --max-model-steps N --workspace <clone> --approval-mode never --disable-shell --disable-web-tools --user-input-auto-resolve --no-session-log --no-foreign-personal-context --prompt-file <file>`. Approvals are off for unattended runs, but Muse Code's sandbox stays on and it has no shell and no web access, so it can only read and edit workspace files. It cannot run commands that could leak the API key. This replaces the earlier `--yolo` default.

## Run 1: Muse Code alone

Scratch git copy of `feasibility/cases/c4_jwt_affected`, prompt allowing only `src/auth.ts`. Exit 0 after 72 s. `git status` showed only `src/auth.ts` changed. The diff adds a fail-closed check when `JWT_KEY` is missing and pins `jwt.verify` to `{ algorithms: ["HS256"] }`.

## Run 2: the full runner script (`scripts/remediate/run.mjs`)

A local mock served the two Argus runner endpoints (`/api/fix/:id/runner` and `/runner/result`, with secret and nonce checks). The runner:

1. fetched the brief,
2. shallow-cloned `chewonc/argus-watch` at `d774d83`,
3. ran Muse Code with the flags above (52 s, 248 JSONL events, 23 tool steps),
4. found exactly one changed file, `feasibility/cases/c4_jwt_affected/src/auth.ts`, which is on the allowlist,
5. found no test command for the fixture, so `tests.executed=false`,
6. posted the result.

Muse Code's own summary stated that it could not run tests because shell was disabled. The UI and PR label such a fix "no tests executed".

## JSONL format observed (Muse Session Protocol)

The final answer is `payload_type: "run.terminal.completed"` with `payload.terminal == "completed"` and `payload.text`. Each tool step is a `task.lifecycle.started` event. The runner parses these.

## Not yet verified

- A run on the `ubuntu-latest` Actions runner (Linux sandbox) dispatched by production. This needs `RUNNER_DISPATCH_TOKEN`, `ARGUS_RUNNER_SECRET` and `FIX_ENABLED=1` on Vercel, plus the `META_API_KEY` and `ARGUS_RUNNER_SECRET` Actions secrets.
- Argus's server-side validation and GitHub write after a real runner result. No pull request has been created yet.
- Muse Code's MCP connection to Argus from inside the runner. It is configured as optional and was not reachable in the local mock.
