# Production Dependency Reachability and Mitigation Review — 2026-08-22

## Decision

- Production/runtime dependency audit: **PASS — 0 vulnerabilities** (`npm audit --omit=dev`).
- Full install-tree audit: **OPEN_DEV_TOOLING_DEBT — 13 entries** (`0 low / 12 moderate / 1 high / 0 critical`).
- No `npm audit fix`, `npm audit fix --force`, forced major upgrade, or automatic major downgrade was used.
- The earlier inherited snapshot (`1 low / 14 moderate / 24 high / 1 critical`) is retained as historical input, not represented as current evidence.
- The pre-remediation live audit in this run was `1 low / 15 moderate / 22 high / 1 critical` for the full tree and `0 low / 1 moderate / 4 high / 0 critical` for production-only dependencies.

## Applied compatible fixes

All changes are explicit package overrides with the same package major version as the installed vulnerable node. `package-lock.json` was regenerated with `npm install --ignore-scripts`.

| Package path | Before | After | Reachability and decision |
| --- | ---: | ---: | --- |
| Next/Tailwind/Vite -> `postcss` | 8.5.10 | 8.5.23 | Build-time CSS parser. The old global override forced Next below its own 8.5.23 pin. Updated to Next 16.3.2's exact safe pin. |
| `postcss` -> `nanoid` | 3.3.12 | 3.3.18 | Transitive build-time generator; fixed through the PostCSS patch. |
| Sentry/webpack/Ajv -> `fast-uri` | 3.1.3 | 3.1.5 | Build-time schema/URI parser; compatible patched 3.x release. |
| Sentry/glob/minimatch -> `brace-expansion` | 5.0.6 | 5.0.9 | Build-time glob expansion; compatible patched 5.x release. |
| ESLint/minimatch -> `brace-expansion` | 1.1.15 | 1.1.18 | Dev-only lint path; compatible patched 1.x release. |
| Vercel tooling -> `tar` | 7.5.7 | 7.5.22 | Dev-only CLI packaging path; critical/high advisories removed without a major change. |
| Vercel/jsdom -> `undici` | 5.28.4 / 6.27.0 / 7.28.0 | 5.29.0 / 6.28.0 / 7.29.0 | Dev/test/CLI HTTP clients. The 6.x and 7.x nodes are patched; the nested 5.29.0 node remains open because current advisories do not identify a patched 5.x line. |
| Vercel tooling transitive parsers | vulnerable patch/minor nodes | patched same-major nodes | Explicit updates cover `@tootallnate/once`, Ajv 8, `ip-address` 10, `js-yaml` 4, minimatch 10, `path-to-regexp` 6/8, and `smol-toml` 1. |

Relevant reviewed advisories:

- PostCSS source-map file disclosure: https://github.com/advisories/GHSA-fxqj-rqcc-2cmp
- Nano ID zero-size infinite loop: https://github.com/advisories/GHSA-2v37-7h3g-55p8
- fast-uri host-confusion parsing: https://github.com/advisories/GHSA-7p8r-x3mc-p8w7
- brace-expansion unbounded intermediate arrays: https://github.com/advisories/GHSA-rgw5-rvv9-x895
- Undici response desynchronization: https://github.com/advisories/GHSA-8xcm-r25x-g524
- srvx absolute-URI middleware bypass: https://github.com/advisories/GHSA-p36q-q72m-gchr

## Residual full-tree findings

The 13 residual npm entries all roll up through the direct dev dependency `vercel@54.14.0`.

1. **Undici actual dev-tool node:** `@vercel/node` resolves `undici@5.29.0`, and current reviewed advisories do not identify a patched 5.x release. It is therefore an **open high-severity development-tool finding**, not `patched-installed`. Static inspection places the import in Vercel's local dev-server path; UAIS application code and the deployed Next.js runtime do not import it. Mitigation: do not expose Vercel local serve/dev paths to untrusted networks or endpoints, keep CLI runs short-lived and operator-initiated, and track an upstream `@vercel/node` release that moves to a supported patched line.
2. **srvx actual dev-only node:** `@vercel/backends@0.8.14` requires `srvx ^0.8.9`, while the only patched line starts at `0.11.13`. Forcing `0.11.13` would cross the parent's declared 0.x compatibility range, so it was not overridden. The vulnerability requires the srvx Node adapter to serve raw attacker-controlled HTTP and a route/middleware parsing discrepancy. UAIS does not import srvx, no package script starts `vercel dev`, and deployed Next.js runtime dependencies exclude the project-local Vercel CLI. Mitigation: never expose `vercel dev` as a public server; use the CLI only for authenticated control-plane commands against trusted project configuration; track a compatible upstream `vercel/@vercel/backends` release before removing this exception.

The clean-install integrity checks also retain a separate, non-vulnerability tooling debt. `npm ls --omit=dev` exits zero, but `npm ls --all --depth=4` exits nonzero because the Vercel dev-tooling tree reports its `proxy-agent@6.4.0` optional-peer resolution as invalid and npm retains these optional WASM artifacts as extraneous on this macOS install:

- `@emnapi/core@1.10.0`
- `@emnapi/runtime@1.11.1`
- `@emnapi/wasi-threads@1.2.1`
- `@img/sharp-wasm32@0.35.3`
- `@napi-rs/wasm-runtime@1.1.5`
- `@tybys/wasm-util@0.10.2`

These diagnostics remain **OPEN_DEV_TOOLING_DEBT**. They are not rewritten as a clean full-tree result, and no forced override, automatic fix, major upgrade, or downgrade is authorized to suppress them.

## Verification

- Runtime: Node `v24.15.0`; npm `11.12.1`.
- Fresh takeover clean install: `npm ci` PASS (`added 921 packages`, `audited 922 packages`); npm reported the same `12 moderate / 1 high` dev-tooling audit debt.
- `npm ls --omit=dev`: PASS (exit `0`).
- `npm audit --omit=dev`: PASS, `0 vulnerabilities`.
- `npm audit`: `0 low / 12 moderate / 1 high / 0 critical`; all residual entries trace to the dev-only Vercel CLI chain described above.
- `npm ls --all --depth=4`: **OPEN_DEV_TOOLING_DEBT** (exit `1`) for the Vercel `proxy-agent` optional-peer diagnostic and the six named optional WASM artifacts above. This is not reported as a clean full install tree.
- Installed runtime versions were verified with the production-omitting tree and direct package metadata reads; `undici@5.29.0` remains explicitly classified as open dev-tool debt.
- `vercel --version`: PASS, 54.14.0.
- Redacted `vercel whoami` exit status: PASS; identity output omitted.
- Previously recorded candidate checks (not rerun by this narrow dependency-evidence correction): `npm run lint` PASS with one pre-existing warning, `npx tsc --noEmit` PASS, the sharded Vitest suite PASS, `npm run build` PASS, and `git diff --check` PASS. The integration owner must replace these with final exact-candidate evidence after committing the reviewed slices.

## Release boundary

This review clears only the production application/runtime reachability gate under the documented mitigation. It does **not** declare the full dependency tree vulnerability-free and does **not** authorize production: same-candidate staging deployment, live load, backup/restore, alerting, accessibility, INP, and the 24-hour soak remain separate gates. The production group feature flag remains off.
