# S25 invite-p95 literal-safety review

- Reviewed: 2026-08-27 12:10 HKT
- Session: `S25`
- Candidate:
  `/Volumes/Starship/UAIS/.worktrees/.isolated-uais-invite-p95-20260824`
- Boundary: local, read-only structural review of the 251 dirty regular files.
  No candidate value, literal hash, URL, user, password, host, database name,
  token, DSN, key body, environment value, or matched source line was emitted.

## Why this review was required

The initial redacted patch scan reported 44 high-confidence secret-shaped
patterns. A contextual pass resolved all but five database-URL patterns in two
test files. Those conservative findings prevented any invite patch or source
archive from leaving the workspace.

## Structural review

The remaining files were reviewed at both the exact base and working-copy
levels:

- `tests/app-healthz.test.ts`
- `tests/p2-neon-provider-backup-contract.test.ts`

The verifier emitted categories and counts only. It found 12 URL-shaped
occurrences across the audited base/working-copy inputs:

| Classification | Count | Structural basis |
| --- | ---: | --- |
| Synthetic test fixture | 8 | Complete URL literals with common/low-complexity test credentials, low-entropy test passwords, and static injected-test, frozen-fixture, or mock context |
| Synthetic fingerprint fixture | 4 | Complete quoted literals with no credentials, used only as inputs to fixture/evidence fingerprint helpers bound to frozen source/restore test objects |
| Review required | 0 | No unresolved occurrence remained |

The four literals that a standards URL parser rejected were not partial
credential leaks: each was a complete quoted test literal, had no user-info or
password component, used a provider-shaped test host, and was consumed by a
fixture fingerprint helper. No environment, keychain, credential-store, or
file read was present in their relevant contexts.

## Private-key marker review

A separate counts-only scan of all 251 dirty regular files found:

- one private-key begin marker, located in test code;
- zero matching private-key end markers;
- zero complete private-key blocks; and
- zero parseable private keys.

This establishes that the conservative key finding is marker-shaped test text,
not a complete or parseable private-key payload.

## Verdict and limits

Verdict: `STRUCTURALLY_SYNTHETIC_TEST_FIXTURES`.

The prior five conservative database-URL findings are resolved for local
preservation review. Together with the separate 251/251 byte reconstruction,
the invite candidate may be classified
`LOCAL_RECONSTRUCTION_AND_LITERAL_SAFETY_VERIFIED`.

This verdict does **not** prove provider-live safety, production readiness,
release eligibility, or absence of every possible sensitive semantic in the
251-file candidate. It also does not authorize copying source-derived content
outside the workspace. The original standalone repository remains
`DO_NOT_DELETE` until an exact allowlisted second-location copy is explicitly
authorized and independently reconstructed from that copy.
