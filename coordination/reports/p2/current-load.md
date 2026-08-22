# UAIS P2 Current Load Report

Evidence date: 2026-08-22 Asia/Hong_Kong
Planning baseline: `fd09ef322d14316cabaf8cc6d33f23dacc0b61b3`
Validated P2 code SHA: `6e48ea8491a1542f54a2fff084f19fac1422c646`
Guard and dry-run-plan status: `PASS`
Actual staging load status: `BLOCKED_ENV`

## Acceptance ledger

| ID | Status | Scenario | Command/evidence | Failure or residual boundary | Responsible roles | Next step | Blocks production |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P2-LOAD-00 | `PASS` | Production-host and unknown-host refusal | `npm test`; `npm run test:critical` | Guard regression passes and exits before network use | S11/S22 | Preserve allowlist and confirmation contract | Yes if regressed |
| P2-LOAD-00A | `PASS` | Staging dry-run plan generation | `P2_LOAD_CONFIRM=staging` plus an explicitly allowlisted non-production target, then `npm run test:p2:load -- --dry-run` | Plan produced `networkUsed: false`; no account or database was contacted | S11/S22 | Bind the plan to a proven isolated staging target | No; planning evidence only |
| P2-LOAD-01 | `BLOCKED_ENV` | Scenario A: 200 unique users join `p2-quality-pilot` | `npm run test:p2:load` | Exit code 2, `networkUsed: false`; base URL, explicit confirmation, allowlist, isolated accounts, database, and cleanup proof are absent | S11/S12/S22 | Provision staging fixtures and a real bounded executor | Yes |
| P2-LOAD-02 | `BLOCKED_ENV` | Scenario B: 40 groups × 5 users for 10 minutes with deterministic provider stub | `npm run test:p2:load` | Exit code 2 before network; staging groups, accounts, database, executor, and cleanup proof are absent | S11/S14/S22 | Enable groups only on staging and execute with run IDs | Yes |
| P2-LOAD-03 | `BLOCKED_ENV` | Scenario C: one user, at most three live provider requests, no automatic retry | `npm run test:provider:live` | Exit code 2, `networkUsed: false`; explicit confirmation, budget cap, rate limit, timeout, monitoring, and approved UAIS credential source are absent | S07/S19/S22 | Obtain separate authorization and redacted control-plane proof | Yes |
| P2-LOAD-04 | `NOT_RUN` | Post-run fixture cleanup and residual count | Query staging by run ID after each actual scenario | No write occurred, so no external cleanup result exists | S11/S12/S22 | Require created/cleaned/residual counts; residual must be zero | Yes |

## Built-in target protection

The load harness accepts only an explicitly allowlisted hostname, requires
`P2_LOAD_CONFIRM` to equal `staging`, and rejects production or unrecognized
targets before opening a network connection. Rejected targets include the
canonical UAIS production domains and the known production Vercel hostname.
Every planned record carries a unique run ID, and actual execution must fail
the release gate if cleanup cannot prove zero residual data.

## Scenario A acceptance contract

- 200 unique staging-only users join one staging-only course.
- Concurrency is bounded and each user retries at most twice.
- Success rate must be at least 99%; 5xx must remain below 0.5%; p95 must be at
  most two seconds.
- Membership must be unique, with no deadlock, leaked connection, or unhandled
  exception.

## Scenario B acceptance contract

- 200 active staging-only users are split across 40 groups of five.
- The run lasts ten minutes at a bounded short-message frequency.
- AI responses use a deterministic stub; no billable provider is contacted.
- Success rate must be at least 99%; 5xx below 0.5%; page/API p95 at most two
  seconds.
- There must be no cross-group message visibility, duplicate write, unbounded
  queue, runaway process, or connection exhaustion.

## Scenario C acceptance contract

- One approved staging user makes no more than three requests.
- There is no automatic high-frequency retry.
- Budget/hard cap, rate limit, timeout, monitoring, and approved credential
  source must all be proven before the command can contact a provider.
- Evidence may retain provider/model names, status class, latency, and cost
  range only. It must not retain keys, private prompts, raw responses, or chat
  bodies.

This implementation proves target refusal and a deterministic, non-network
execution plan. It does not claim any 200-user result, throughput metric, group
isolation result, provider response, external write, or cleanup result.
