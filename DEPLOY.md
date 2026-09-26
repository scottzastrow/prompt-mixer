# Deploy Prompt Mixer on Ubuntu

This follows the established EDI deployment shape: DNS → HTTPS/Nginx → local app process/systemd → OpenAI. It does not require MySQL. Use a separate port and service; do not modify the EDI service. The existing static site is already deployed under `/opt/promptmixer` on the same host at `3.134.129.111`. Its HTTP Nginx site is `/etc/nginx/sites-available/promptmixer`. HTTPS must be working before adding authentication or activating paid API calls.

1. Confirm the existing Bluehost A record resolves publicly to `3.134.129.111`. It worked locally at handoff, but Let's Encrypt still saw NXDOMAIN. Retry `sudo certbot --nginx -d promptmixer.vergotek.com` only after public DNS has propagated. Verify HTTPS in a browser and with `curl -I https://promptmixer.vergotek.com`.
2. Install Node.js 20 or later. Create a dedicated `promptmixer` system user and grant that user read access to `/opt/promptmixer`. Deploy the reviewed AI branch to the existing directory. Keep a backup of the previous three static files and do not change EDI's files or service. The app has no npm runtime dependencies.
3. Create `/etc/promptmixer/promptmixer.env` readable only by the service owner/root (mode `600`), containing `OPENAI_API_KEY=...`, `OPENAI_MODEL=gpt-5-mini`, `HOST=127.0.0.1`, and `PORT=8081`. Use a separate Prompt Mixer project key and configure usage alerts. Do not put this file in Git.
4. Create `/etc/systemd/system/promptmixer.service`:

```ini
[Unit]
Description=Prompt Mixer
After=network-online.target

[Service]
User=promptmixer
Group=promptmixer
WorkingDirectory=/opt/promptmixer
EnvironmentFile=/etc/promptmixer/promptmixer.env
ExecStart=/usr/bin/node /opt/promptmixer/server.mjs
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

7. Run `sudo nginx -t`, reload Nginx, and confirm `sudo certbot renew --dry-run`. Ensure the HTTP site redirects to HTTPS, rather than presenting a password prompt over HTTP.
8. At `https://promptmixer.vergotek.com`, verify that access requires credentials, the page loads, Show Mix reflects checked fields, and Generate Response returns a real answer. Check `journalctl -u promptmixer` for server errors without printing the API key. Also verify `devedi.vergotek.com` still works.

For updates, deploy a tested commit, restart only `promptmixer`, and repeat the smoke test. Preserve the prior commit for rollback. Before opening access beyond a small class demo, add stronger per-user authorization and rate limits. A project spending alert is not necessarily a hard cap.
