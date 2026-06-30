# HTTPS Apex Domain Check - 2026-06-22

- Session: S22
- Project: UAIS
- Target domain: `uais.top`
- Objective: Verify and unblock HTTPS for the public project website.

## Result

Current final state as of 10:28 HKT:

- `https://www.uais.top` is working and serves the UAIS app.
- `https://uais.top` is working and redirects to `https://www.uais.top/`.
- Vercel now shows `Valid Configuration` for both `uais.top` and `www.uais.top`.
- The previous `DNS Change Recommended` warning for `www.uais.top` cleared after replacing the old `www` A record with Vercel's recommended CNAME.

The initial diagnostic evidence below is retained for audit history.

## Evidence

- `http://uais.top` returns a Vercel `308` redirect to `https://uais.top/`.
- `https://www.uais.top` returns `HTTP/2 307` and redirects the app root to `/courses`.
- `https://uais.top` fails certificate validation with:
  - `SSL: no alternative certificate subject name matches target host name 'uais.top'`
- `curl -k -I https://uais.top` reaches Vercel and returns `HTTP/2 307` to `https://www.uais.top/`, proving the routing/redirect exists after TLS is bypassed.
- Certificate inspection against the Vercel edge for SNI `uais.top` shows:
  - Subject: `CN=www.uais.top`
  - SAN: `DNS:www.uais.top`
- Public DNS shows the domain is already using Vercel nameservers:
  - `ns1.vercel-dns.com`
  - `ns2.vercel-dns.com`
- Public DNS currently resolves:
  - `uais.top` A records to Vercel edge IPs in the `216.150.*` range.
  - `www.uais.top` A record to `76.76.21.21`.

## Interpretation

This is not a Next.js app-code problem. The app already uses `https://uais.top` in metadata/share-link surfaces, and Vercel already redirects HTTP to HTTPS.

The remaining blocker is a Vercel domain/certificate binding issue for the apex hostname `uais.top`.

## Required Fix

In the Vercel dashboard for the `uais` project:

1. Open project `uais` -> Settings -> Domains.
2. Ensure both `uais.top` and `www.uais.top` are attached to the same production project.
3. Make the preferred production URL explicit:
   - If the desired canonical URL is `https://uais.top`, set `uais.top` as primary and redirect `www.uais.top` to it.
   - If the desired canonical URL is `https://www.uais.top`, keep `www.uais.top` primary and redirect `uais.top` to it.
4. Use Vercel's DNS/certificate status panel to refresh or retry certificate issuance for `uais.top`.
5. If Vercel reports invalid DNS, follow the dashboard's recommended DNS records inside the Vercel-managed zone for `uais.top`.

## Verification Commands

Run after Vercel reports the certificate is issued:

```bash
curl -I https://uais.top
curl -I https://www.uais.top
openssl s_client -connect 76.76.21.21:443 -servername uais.top </dev/null 2>/dev/null | openssl x509 -noout -ext subjectAltName
```

Pass condition:

- `curl -I https://uais.top` succeeds without `-k`.
- The certificate SAN includes `DNS:uais.top`.
- The preferred hostname redirects consistently to the canonical URL.

## Local Constraints

- The local workspace has no `VERCEL_TOKEN` environment variable.
- No local Vercel auth file is present.
- `npx vercel domains inspect uais.top` could not complete because the CLI could not establish TLS to `vercel.com` from this machine.
- No repo code change can fix the apex certificate because TLS validation happens before the Next.js app receives the request.

## Checks Run

- `git status --short`
- `curl -I http://uais.top`
- `curl -I https://uais.top`
- `curl -k -I https://uais.top`
- `curl -I https://www.uais.top`
- `dig uais.top A`
- `dig www.uais.top A`
- `dig uais.top NS`
- `openssl s_client` certificate inspection
- Vercel CLI domain inspect attempt

## Checks Not Run

- `npm run lint`, `npm run test`, and `npm run build` were not run because no application code changed.

## 09:57 HKT Update After Owner Vercel Change

The owner-added `uais.top` operation is now externally visible as complete.

Updated evidence:

- `curl -I https://uais.top` succeeds without `-k`.
- `https://uais.top` returns Vercel `HTTP/2 308` to `https://www.uais.top/`.
- Certificate inspection for SNI `uais.top` now shows:
  - Subject: `CN=uais.top`
  - SAN: `DNS:uais.top`
  - Issuer: Let's Encrypt `YR2`
  - Valid from `2026-06-22 00:56:44 GMT` to `2026-09-20 00:56:43 GMT`
- `https://www.uais.top` still succeeds and serves the app root redirect to `/courses`.

The remaining Vercel dashboard warning on `www.uais.top` is consistent with DNS shape, not site availability: public DNS returns an `A` record for `www.uais.top` pointing to `76.76.21.21`, while Vercel currently recommends configuring subdomains with the dashboard-provided `CNAME` record.

## 10:21 HKT Update After Vercel DNS Change

After explicit owner confirmation, the old `www` A record was replaced in the Vercel-managed DNS zone:

- Removed: `www` / `A` / `76.76.21.21` / TTL `60`.
- Added: `www` / `CNAME` / `33acf2e15df1d4c2.vercel-dns-016.com.` / TTL `60`.

Vercel dashboard evidence:

- Domain DNS page now lists `www` as a `CNAME` to `33acf2e15df1d4c2.vercel-dns-016.com.`.
- Project Domains page shows `uais.top` as `Valid Configuration`, redirecting with `308` to `www.uais.top`.
- Project Domains page shows `www.uais.top` as `Valid Configuration` for Production.
- The `www.uais.top` row was refreshed after the DNS change and stayed valid.

Public DNS evidence:

- `dig www.uais.top CNAME +short` returns `33acf2e15df1d4c2.vercel-dns-016.com.`
- `dig @1.1.1.1 www.uais.top CNAME +short` returns `33acf2e15df1d4c2.vercel-dns-016.com.`
- `dig @8.8.8.8 www.uais.top CNAME +short` returns `33acf2e15df1d4c2.vercel-dns-016.com.`
- `dig www.uais.top A +short` follows the CNAME and resolves to Vercel edge addresses.

HTTPS evidence:

- `curl -I https://www.uais.top` returns `HTTP/2 307` with `location: /courses`.
- `curl -I https://uais.top` returns `HTTP/2 308` with `location: https://www.uais.top/`.
- Direct checks against both current `www.uais.top` edge IPs succeeded with verified TLS for `CN=www.uais.top`.
- One immediate retry during DNS transition returned a transient local TLS EOF, but subsequent DNS-path and direct-edge retries passed.

The Vercel `DNS Change Recommended` warning is resolved.
