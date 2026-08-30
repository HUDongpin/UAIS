# P2 staging evidence status

These files are retained as redacted derivatives of historical machine output. Opaque infrastructure and trace identifiers are represented only by SHA-256 fingerprints; the byte-for-byte originals remain in a local, Git-ignored takeover archive. These derivatives do not constitute current, same-candidate staging acceptance for the integration branch.

| Evidence file | Recorded result | Current acceptance meaning |
| --- | --- | --- |
| `2026-08-22-p1-staging-load-preflight.json` | `BLOCKED_ENV` | The preflight did not establish an executable staging run. |
| `2026-08-22-p1-staging-load.json` | `PASS` | A prior P1 load run completed, but its older manifest/deployment fields do not satisfy the current exact-candidate and immutable-deployment binding contract. |
| `2026-08-22-p2-staging-live-load.json` | `FAIL` with `restore-verification-failed` | Scenario and cleanup fields remain diagnostic only. Restore acceptance is failed and `restoreCompleted` is false. |
| `2026-08-22-staging-healthz-15m.json` | `PASS` | The health-only observation predates the current exact-candidate binding fields and is not proof for the present candidate SHA. |

The canonical readiness position is therefore `BLOCKED`: a newly committed candidate must be deployed only to the isolated staging project, bound to its exact Git/content identity and immutable deployment identity, then rerun through the required database, restore, browser, provider, load, accessibility, and soak gates. Operator-supplied identifiers are attestations, not independent proof that the remote deployment contains a given commit.

No file in this directory authorizes a push, `main` merge, production deployment, production migration, provider call, or production data write.

## Candidate/evidence commit binding

The closure gate treats the candidate Git SHA and the checkout that produced the
evidence as separate identities. With no explicit selection, `npm run
release:p2:closure` requires the manifest candidate SHA to equal the current
checkout `HEAD` and fails closed on a stale manifest. When evidence was produced
from a clean descendant checkout after the immutable candidate was deployed,
the operator may pass the exact candidate SHA explicitly:

```bash
npm run release:p2:closure -- --manifest <manifest> --candidate-sha <candidate-sha>
```

The explicit candidate must exist in the checkout's history. The gate reports the
current evidence checkout separately and rejects a candidate that is not its
ancestor. This avoids the impossible invariant of embedding a commit's own
`HEAD` in a tracked report and then committing that report, while preserving the
exact candidate/deployment binding.
