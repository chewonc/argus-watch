# Contributing to Argus Watch

Argus Watch is a solo entry to the Meta Global AI Developer Hackathon (Oct 27 – Nov 4 2026). Everything in this repository was written during the event window; the first commit is dated Oct 31 2026.

## Development setup

```bash
npm ci
cp .env.example .env.local   # fill in META_API_KEY at minimum
npm run dev                  # http://localhost:3000
```

Without Upstash credentials the store falls back to `.data/store.json` and jobs run inline, so a single `META_API_KEY` is enough to run the pipeline locally. Set `AW_DEV_USER=<name>` to sign in as a stub user when GitHub OAuth is not configured (development only).

## Checks

```bash
npm run lint
npm run typecheck
npm test                     # node:test suite, no network
node feasibility/gate.mjs    # evaluation harness (needs META_API_KEY; see feasibility/EVAL.md)
```

CI runs lint, typecheck and tests on every push and pull request.

## Ground rules

- Read-only by design: never add code that executes repository code on the server, generates exploits, or writes to a user's repository without explicit per-fix approval.
- Model output is data: every claim the model makes about code must be checked mechanically (see `lib/analyze.ts` citation checks) before it can affect a verdict.
- Untrusted text (advisories, feeds, repository contents) is fenced in prompts and in MCP responses (`untrusted_*` fields).
- No secrets in the repository. `.env*` is ignored; use `.env.example` to document new variables.

## Reporting a security issue

Open a private security advisory on GitHub (Security → Advisories → Report a vulnerability) rather than a public issue.

## License

Apache-2.0. By contributing you agree your contribution is licensed under the same terms.
