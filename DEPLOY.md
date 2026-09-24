# Deploy Prompt Mixer on Ubuntu

This follows the established EDI deployment shape: DNS → HTTPS/Nginx → local app process/systemd → OpenAI. It does not require MySQL. Use a separate port and service; do not modify the EDI service. Commands below assume an Ubuntu host where Nginx and Certbot are already installed.

1. Create an A record for `promptmixer.vergotek.com` pointing to the intended server's static IP. Confirm it with `nslookup promptmixer.vergotek.com`.
2. Install Node.js 20 or later. Create a dedicated user and application directory, then check out the tested commit to `/opt/prompt-mixer`. The app has no npm runtime dependencies.
3. Create `/etc/prompt-mixer/prompt-mixer.env` readable only by the service owner/root (mode `600`), containing `OPENAI_API_KEY=...`, `OPENAI_MODEL=gpt-5-mini`, `HOST=127.0.0.1`, and `PORT=3000`. Use a separate project key with a conservative spend limit. Do not put this file in Git.
4. Create `/etc/systemd/system/prompt-mixer.service`:

```ini
[Unit]
Description=Prompt Mixer
After=network-online.target

[Service]
User=promptmixer
Group=promptmixer
WorkingDirectory=/opt/prompt-mixer
EnvironmentFile=/etc/prompt-mixer/prompt-mixer.env
ExecStart=/usr/bin/node /opt/prompt-mixer/server.mjs
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

5. Run `sudo systemctl daemon-reload && sudo systemctl enable --now prompt-mixer`. Verify `curl http://127.0.0.1:3000/health`. Keep port 3000 closed in the public firewall.
6. Create a separate password file, such as `/etc/nginx/prompt-mixer.htpasswd`, using `htpasswd` from `apache2-utils`. Give credentials only to intended users. Add an Nginx virtual host for `promptmixer.vergotek.com`:

```nginx
server {
    listen 80;
    server_name promptmixer.vergotek.com;
    auth_basic "Prompt Mixer";
    auth_basic_user_file /etc/nginx/prompt-mixer.htpasswd;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

7. Enable the vhost, run `sudo nginx -t`, reload Nginx, then issue HTTPS with `sudo certbot --nginx -d promptmixer.vergotek.com` and choose HTTP-to-HTTPS redirect. Confirm `sudo certbot renew --dry-run`.
8. At `https://promptmixer.vergotek.com`, verify that access requires credentials, the page loads, Show Mix reflects checked fields, and Generate Response returns a real answer. Check `journalctl -u prompt-mixer` for server errors without printing the API key.

For updates, deploy a tested commit, restart only `prompt-mixer`, and repeat the smoke test. Preserve the prior commit for rollback. Before opening access beyond a small class demo, add stronger per-user authorization, rate limits, and a spending budget.
