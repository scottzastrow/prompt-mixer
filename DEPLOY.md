# Deploy Prompt Mixer on Ubuntu

This follows the established EDI deployment shape: DNS → HTTPS/Nginx → local app process/systemd → OpenAI. It does not require MySQL. Use a separate port and service; do not modify the EDI service. The tested AI branch runs from `/opt/promptmixer-app` on the shared host at `3.134.129.111`; the previous static files remain in `/opt/promptmixer`. The Nginx site is `/etc/nginx/sites-available/promptmixer`. HTTPS and basic authentication were enabled before the paid API was tested.

1. Confirm the Bluehost A record points to `3.134.129.111`. Certbot installed the certificate on September 26, 2026, after DNS propagated. Verify HTTPS and the HTTP-to-HTTPS redirect.
2. Install Node.js 20 or later. Create a dedicated `promptmixer` system user and grant it read access to `/opt/promptmixer-app`. Deploy the reviewed AI branch to `/opt/promptmixer-app`. Retain the earlier static files in `/opt/promptmixer`; leave EDI's files and service unchanged. The app has no npm runtime dependencies.
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

For updates, pull a tested commit in `/opt/promptmixer-app`, run `npm test`, restart only `promptmixer`, and repeat the smoke test. The service loads secrets from `/etc/promptmixer/promptmixer.env`; never copy that file into Git. Preserve the prior commit for rollback. The previous Nginx site was backed up as `/etc/nginx/sites-available/promptmixer.before-ai`. A project spending alert is not necessarily a hard cap.

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
