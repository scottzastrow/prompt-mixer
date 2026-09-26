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

[Install]
WantedBy=multi-user.target
```

5. Run `sudo systemctl daemon-reload && sudo systemctl enable --now promptmixer`. Verify `curl http://127.0.0.1:8081/health`. Keep port 8081 closed in the public firewall.
6. Once HTTPS works, create a separate password file, such as `/etc/nginx/promptmixer.htpasswd`, using `htpasswd` from `apache2-utils`. Give credentials only to intended users. Replace only the Prompt Mixer site's application location with a proxy to the private service, preserving Certbot's HTTP challenge and HTTPS redirect blocks. For the HTTPS `server` block, the protected application location is:

```nginx
location / {
    auth_basic "Prompt Mixer";
    auth_basic_user_file /etc/nginx/promptmixer.htpasswd;
    proxy_pass http://127.0.0.1:8081;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

7. Run `sudo nginx -t` and reload Nginx. The `sudo certbot renew --dry-run` check succeeded for both Prompt Mixer and EDI on September 26, 2026. Ensure the HTTP site redirects to HTTPS, rather than presenting a password prompt over HTTP.
8. At `https://promptmixer.vergotek.com`, verify that access requires credentials, the page loads, Show Mix reflects checked fields, and Generate Response returns a real answer. Check `journalctl -u promptmixer` for server errors without printing the API key. Also verify `devedi.vergotek.com` still works.

For updates, pull a tested commit in `/opt/promptmixer-app`, run `npm test`, restart only `promptmixer`, and repeat the smoke test. The service loads secrets from `/etc/promptmixer/promptmixer.env`; never copy that file into Git. Preserve the prior commit for rollback. The previous Nginx site was backed up as `/etc/nginx/sites-available/promptmixer.before-ai`. Before opening access beyond a small class demo, add stronger per-user authorization and rate limits. A project spending alert is not necessarily a hard cap.
