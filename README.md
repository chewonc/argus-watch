# Argus Watch

A read-only agent that tells you whether a newly published security advisory actually affects your repository, condition by condition, with cited evidence and stated uncertainty.

Built for the Meta Global AI Developer Hackathon (Indie track, Oct 26 – Nov 4, 2026).

## Status

Early development. The feasibility harness is in `feasibility/`; it has not been run yet and no results are claimed.

## How it works (planned)

1. **Watch:** fetch advisories from OSV.dev / GHSA for the packages in your lockfile (on demand in the MVP; scheduled checks next).
2. **Locate:** find where your code and config touch the affected package.
3. **Predict:** Muse Spark 1.3 extracts the advisory's preconditions and labels each one Observed / Inferred / Unknown / Contradicted, citing file:line evidence.
4. **Verify:** every citation is re-read mechanically; unmatched quotes are dropped.
5. **Decide:** a deterministic rule returns **Affected**, **Not Affected** or **Unclear**, with the evidence and the gaps.
6. **Recommend:** mitigation linked to the conditions that drive the verdict.

## Safety boundary

Argus Watch never reproduces, triggers or exploits a vulnerability, never generates proof-of-concept code, and never executes repository or advisory code. It reads advisories, lockfiles, source and config as text. It makes no autonomous code changes.
