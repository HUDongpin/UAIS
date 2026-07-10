# UAIS Production Rollback Runbook

Audience: Dr. Peter Hu, S22 production reliability, and any engineer operating `www.uais.top`.

Purpose: restore the last known good UAIS production deployment quickly when a release breaks login, protected routes, teaching-course readback, or the public site.

## Rollback Trigger

Start rollback when any of these happen in production:

- `/healthz` does not return HTTP 200 with `status: "ok"`.
- Login succeeds but the first protected page redirects incorrectly or fails to render.
- A protected API that was green before the release returns repeated 5xx responses.
- The release owner cannot complete the post-deploy smoke within 10 minutes.

## Immediate Rollback Path

1. Open the Vercel project for UAIS.
2. Find the most recent deployment that passed the production smoke.
3. Promote or restore that deployment to the production domain `www.uais.top`.
4. Record the restored deployment URL, timestamp, operator, and reason in `coordination/reports/`.
5. Run the post-rollback validation below before resuming feature work.

Optional CLI path, only when the Vercel CLI is installed and already authenticated:

```bash
vercel rollback
vercel inspect www.uais.top
```

Do not install tools, change project settings, or edit environment variables during an incident unless the owner explicitly approves that action.

## Post-Rollback Validation

Run the smallest checks that prove users can recover:

```bash
curl -i https://www.uais.top/healthz
```

Then verify in a browser:

- `/login` loads.
- A valid account reaches its first allowed protected page.
- A student account cannot reach `/teaching`.
- A teacher account cannot proceed if the production app-auth provider is not ready.

## Handoff Note

Create a short report in `coordination/reports/` with:

- Incident start and rollback completion time.
- Broken deployment URL and restored deployment URL.
- User-visible symptom.
- Checks run after rollback.
- Remaining owner decisions.

## Stop Conditions

Stop and ask the owner before:

- Rotating or revealing secrets.
- Re-enabling shared production demo credentials.
- Changing production environment variables.
- Rolling forward to an unverified deployment.
