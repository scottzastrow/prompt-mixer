# Deploy Prompt Mixer on Ubuntu

This follows the established EDI deployment shape: DNS → HTTPS/Nginx → local app process/systemd → OpenAI. It does not require MySQL. Use a separate port and service; do not modify the EDI service. The tested AI branch runs from `/opt/promptmixer-app` on the shared host at `3.134.129.111`; the previous static files remain in `/opt/promptmixer`. The Nginx site is `/etc/nginx/sites-available/promptmixer`. HTTPS and basic authentication were enabled before the paid API was tested.

1. Confirm the Bluehost A record points to `3.134.129.111`. Certbot installed the certificate on September 26, 2026, after DNS propagated. Verify HTTPS and the HTTP-to-HTTPS redirect.
2. Install Node.js 20 or later. Create a dedicated `promptmixer` system user and grant it read access to `/opt/promptmixer-app`. Deploy the reviewed AI branch to `/opt/promptmixer-app` and install its production dependencies with `npm ci`. Retain the earlier static files in `/opt/promptmixer`; leave EDI's files and service unchanged.
3. Create `/etc/promptmixer/promptmixer.env` readable only by the service owner/root (mode `600`), containing `OPENAI_API_KEY=...`, `OPENAI_MODEL=gpt-5-mini`, `HOST=127.0.0.1`, and `PORT=8081`. Use a separate Prompt Mixer project key and configure usage alerts. Do not put this file in Git.
4. Create `/etc/systemd/system/promptmixer.service`:

```ini
[Unit]
Description=Prompt Mixer
After=network-online.target

[Service]
User=promptmixer
Group=promptmixer
WorkingDirectory=/opt/promptmixer-app
EnvironmentFile=/etc/promptmixer/promptmixer.env
ExecStart=/usr/bin/node /opt/promptmixer-app/server.mjs
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
StateDirectory=promptmixer
StateDirectoryMode=0700
UMask=0077

[Install]
WantedBy=multi-user.target
```

5. Run `sudo systemctl daemon-reload && sudo systemctl enable --now promptmixer`. Verify `curl http://127.0.0.1:8081/health`. Keep port 8081 closed in the public firewall.
6. Replace only the Prompt Mixer site's application location with a proxy to the private service, preserving Certbot's HTTP challenge and HTTPS redirect blocks. For the HTTPS `server` block, the public application location is:

```nginx
location / {
    proxy_pass http://127.0.0.1:8081;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

7. Run `sudo nginx -t` and reload Nginx. The `sudo certbot renew --dry-run` check succeeded for both Prompt Mixer and EDI on September 26, 2026. Ensure the HTTP site redirects to HTTPS, rather than presenting a password prompt over HTTP.
8. At `https://promptmixer.vergotek.com`, verify anonymous access loads the page, the live prompt preview reflects the checked fields, and Generate Response returns a real answer. Check `journalctl -u promptmixer` for server errors without printing the API key. Also verify `devedi.vergotek.com` still works.

For updates, pull a tested commit in `/opt/promptmixer-app`, run `npm ci` and `npm test`, restart only `promptmixer`, and repeat the smoke test. The service loads secrets from `/etc/promptmixer/promptmixer.env`; never copy that file into Git. Preserve the prior commit for rollback. The previous Nginx site was backed up as `/etc/nginx/sites-available/promptmixer.before-ai`. A project spending alert is not necessarily a hard cap.

## Operational logs in the systemd journal

The service writes structured operational logs as single-line JSON objects: informational events (such as `server_start`, `ai_request_start`, and successful `ai_request_end`) go to stdout, and warnings and errors (rejections, rate limiting, upstream or database failures, and `openai_response_incomplete` diagnostics) go to stderr. systemd captures both streams in the journal for the `promptmixer` unit. The app does not write log files, and no additional database, browser telemetry, public log endpoint, or hash chain is involved. Log records never contain prompts, answers, conversation history, API keys, passwords, connection strings, or client IP addresses, so routine journal inspection is safe — but the environment file and process environment do contain the key, so keep protecting those.

Inspect the effective journald configuration, including any drop-ins, and check persistence. With the default `Storage=auto`, the journal persists across reboots only when `/var/log/journal` exists; otherwise entries live only under `/run/log/journal` and are lost on reboot.

```sh
systemd-analyze cat-config systemd/journald.conf
ls /etc/systemd/journald.conf.d/ 2>/dev/null
ls /var/log/journal 2>/dev/null || echo "journal is volatile"
```

If persistence is needed, an administrator can enable it manually — do not script this into the deployment or change the Prompt Mixer unit or environment for it. Either set `Storage=persistent` in `/etc/systemd/journald.conf` or a drop-in such as `/etc/systemd/journald.conf.d/persistence.conf` and run `sudo systemctl restart systemd-journald`, or run `sudo mkdir -p /var/log/journal && sudo systemd-tmpfiles --create --prefix /var/log/journal && sudo systemctl restart systemd-journald`. After enabling persistence, flush the runtime entries already collected under `/run/log/journal` to persistent storage so they survive the next reboot: `sudo journalctl --flush`. Only journald configuration changes; the app is untouched.

Follow live logs:

```sh
sudo journalctl -u promptmixer -f
```

Add `-o cat` to see only the raw JSON lines without journal metadata.

Export valid application JSON records as NDJSON. The export requires `jq`; install it once with `sudo apt-get install -y jq`. Each journal message is parsed independently, so malformed lines and non-application records — including systemd lifecycle messages ("Started Prompt Mixer.", "Stopped...", and similar lines logged by systemd itself rather than the app) — are skipped without aborting the export:

```sh
sudo journalctl -u promptmixer --since today -o cat \
  | jq -Rc 'fromjson? | select(
      type == "object"
      and (.timestamp | type == "string")
      and (.level == "info" or .level == "warn" or .level == "error")
      and (.event | type == "string")
      and (.context | type == "object")
    )' \
  > promptmixer-events.ndjson
```

`-o cat` prints only each entry's message text, one message per line. `jq -R` reads each line as raw text, and `fromjson?` parses it independently, producing no output for lines that are not valid JSON instead of failing the whole run. The `select` keeps only records with the application's required shape: a string timestamp, a level of `info`, `warn`, or `error`, a string event name, and an object context. `-c` re-emits each surviving record as one compact NDJSON line.

Retention: the app only appends events to the journal. Administrators control how long they persist through journald — for example `SystemMaxUse=` in `/etc/systemd/journald.conf`, or manual cleanup with `sudo journalctl --vacuum-time=2weeks` or `--vacuum-size=200M`. This is convenient operational storage, not tamper-proof storage: administrators can rotate or vacuum the journal, so do not treat it as an audit trail.

## Public classroom site rate limits

The rate-limit branch was deployed while basic authentication was still enabled. The password rules were then removed after the live AI response and private state file were verified. The previous Nginx configuration is backed up at `/etc/nginx/sites-available/promptmixer.before-public`. Add `LIMIT_STATE_FILE=/var/lib/promptmixer/limits.json` to the protected service environment file. Add `StateDirectory=promptmixer`, `StateDirectoryMode=0700`, and `UMask=0077` to the service unit as shown above, then reload systemd and restart only `promptmixer`. The service must be able to write its private rate state; if storage fails, generation returns 503 and makes no OpenAI call. The default limits are 100 requests per minute and 200 per UTC day per IP, plus 1,000 per UTC day for the site. Optional environment settings `LIMIT_PER_MINUTE`, `LIMIT_PER_IP_DAY`, and `LIMIT_SITE_DAY` accept positive integers.

The existing Nginx `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` appends the real client address. Because the Node service only listens on `127.0.0.1:8081`, it uses the final address in that header for per-IP counts. Keep port 8081 closed externally. People on a shared Wi-Fi IP share the daily allowance; clearing cookies does not reset the count. Do not place another untrusted proxy in front without reviewing the IP handling.

While still authenticated, verify a real response, the private state file, and a blocked request in a safe test environment with low temporary limits. Check that a blocked request returns 429 with `Retry-After` and no OpenAI call. Restore the agreed limits and restart the service. Only then remove the two `auth_basic` lines from the Prompt Mixer HTTPS application `location /`, run `sudo nginx -t`, reload Nginx, and verify an anonymous page load and a live response. Leave the HTTP redirect and EDI configuration unchanged. The password file can remain on disk for a quick rollback; keep a copy of the previous Nginx configuration.

For rollback, restore the protected Nginx location, test and reload Nginx. If the new app fails, check `journalctl -u promptmixer` without showing the key, and restore the prior tested commit. Daily limits reduce automated usage but are not a hard financial cap; monitor the separate OpenAI project.

## Demo-context bridge (milestone 1) — documented, not yet deployed

The optional demo-context bridge (iteration 12, milestone 1) exposes an authenticated Streamable HTTP MCP endpoint at `/mcp` that serves synthetic fixture data only. It is disabled unless the identity-provider environment values are configured; when unconfigured, `/mcp` and `/.well-known/oauth-protected-resource` return 404 and the public app is unchanged. Nothing in this section has been deployed, and no ChatGPT plugin/connector has been created. These steps run during a future deployment window.

1. Add to the protected service environment file `/etc/promptmixer/promptmixer.env` (mode `600`, never committed):

```sh
DEMO_IDP_ISSUER=https://dev-158214i5w3prdebi.us.auth0.com/
DEMO_IDP_JWKS_URI=https://dev-158214i5w3prdebi.us.auth0.com/.well-known/jwks.json
DEMO_MCP_AUDIENCE=https://promptmixer.vergotek.com
DEMO_FIXTURE_PAIRING_CODE=<eight characters from ABCDEFGHJKMNPQRSTUVWXYZ23456789>
# Optional overrides (defaults shown):
# DEMO_SESSION_TTL_HOURS=24
# DEMO_CODE_TTL_SECONDS=300
# DEMO_CODE_MAX_ATTEMPTS=5
# DEMO_MCP_LIMIT_PER_MINUTE=30
# DEMO_MCP_LIMIT_PER_IP_DAY=100
# DEMO_MCP_LIMIT_SITE_DAY=300
# DEMO_MCP_IDENTITY_PER_MINUTE=30
# DEMO_LIMIT_STATE_FILE=/var/lib/promptmixer/demo-limits.json
```

The bridge limits all `/mcp` requests per hashed client IP (file-backed, surviving restarts, via the second RequestLimits instance above) and meters `tools/call` per authenticated identity (hashed issuer+subject, in-memory sliding minute). JWKS retrieval itself is bounded by a ten-minute cache lifetime, a 30-second unknown-key refresh cooldown, concurrent-fetch deduplication, and a five-second fetch timeout, so floods of unknown-key tokens cannot hammer the Auth0 JWKS endpoint.

Sharing rules: the fixture pairing code is short-lived and single-use, and it is meant to travel through ChatGPT — the presenter reads it from their page and gives it to the assistant so the plugin can call `pair_demo_session`. Never commit it or write it to logs, but sharing it in the ChatGPT conversation is the intended flow. What must never be shared anywhere are the persistent credentials: the Auth0 password, the OpenAI API key, and the environment file's contents. The fixture code's five-minute expiry window starts when the bridge initializes — at service start (or when a DEMO_* value changes the bridge signature), not when the presenter asks for the code — so restart `promptmixer` shortly before a rehearsal to mint a fresh window. If `DEMO_FIXTURE_PAIRING_CODE` is unset, the bridge still answers authenticated requests but pairing is impossible.

Trial timing: the rehearsal can run during the Auth0 trial — all required features were confirmed on the tenant on 2026-10-17 — but before the trial ends, verify the Free plan retains the required settings (Resource Parameter Compatibility Profile, Include Issuer in Authorization Responses, CIMD). If it does not, upgrade or re-evaluate the provider per PLAN.md.

2. In the Prompt Mixer HTTPS `server` block, add locations proxying the bridge routes to the private service. They need no `auth_basic` — OAuth Bearer verification protects them — and port 8081 stays closed externally:

```nginx
location = /mcp {
    proxy_pass http://127.0.0.1:8081;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location = /.well-known/oauth-protected-resource {
    proxy_pass http://127.0.0.1:8081;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

3. Deploy the tested commit, run `npm ci` to install the new runtime dependencies (`@modelcontextprotocol/sdk`, `jose`, `zod`), and restart only `promptmixer`. Smoke-check:
   - `curl https://promptmixer.vergotek.com/.well-known/oauth-protected-resource` returns the metadata document (`resource`, `authorization_servers`, `scopes_supported`).
   - `curl -i -X POST https://promptmixer.vergotek.com/mcp -H 'Content-Type: application/json' -d '{}'` returns 401 with a `WWW-Authenticate` header containing `resource_metadata="https://promptmixer.vergotek.com/.well-known/oauth-protected-resource"`.
   - `https://promptmixer.vergotek.com` and `/health` behave exactly as before, and `journalctl -u promptmixer` shows structured events with no prompts, answers, codes, tokens, connection strings, or client IPs.
4. Exercise the endpoint with MCP Inspector (initialize, tool list, OAuth challenge, and the full Auth0 linking flow), using the fixture pairing code for pair/activate/retrieve/unpair.
5. Connect the plugin in the presenter's ChatGPT account (not done yet): add a custom MCP server with URL `https://promptmixer.vergotek.com/mcp`, complete the Auth0 sign-in and consent for the `demo:pair` and `demo:read` scopes, then rehearse: the assistant asks for the pairing code and calls `pair_demo_session` → the presenter says “Let's go live” → activation confirmed from the tool result → `get_demo_run` returns the synthetic fixture conversation in order → the presenter says “Let's take it offline” → revocation confirmed from the tool result and retrieval is denied. The assistant's claims must come only from server tool results. Only after this rehearsal passes does milestone 2 (migration and real capture) begin.
