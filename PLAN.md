# Prompt Mixer — implementation plan

This plan follows the revised [specification](SPEC.md). The original Homework 2 document remains a record of the first scope; the live AI response is a later change.

## Goal and approach

Build one screen that shows how optional prompt instructions affect the text sent to an AI and the resulting answer. The browser assembles the prompt and displays it. A small Node.js server serves the page and makes the OpenAI request with a project-specific key held only on the server. No database or accounts are required for the class version.

## Components

1. **Browser:** Raw, Context, Role, and Constraints inputs; checkboxes; Show Mix, Copy, and Generate Response; response/error display.
2. **Server:** `POST /api/generate` validates the prompt, calls OpenAI, and returns only the generated text. It also serves the static files and `GET /health`.
3. **Deployment:** existing Lightsail Ubuntu host, separate Prompt Mixer service on `127.0.0.1:8081`, and its own Nginx virtual host. EDI remains on `127.0.0.1:8080`.
4. **Access:** finish HTTPS before adding basic authentication and enabling the paid API endpoint. Keep the Prompt Mixer key in a protected service environment file, separate from EDI.

## Iteration and verification

- **Iteration 1 (built):** Assemble and copy a prompt. Verify that each checkbox includes or omits its field.
- **Iteration 2 (draft PR):** Generate a real AI answer. Verify required input, server validation, API response handling, and that the key does not appear in public files. The local test uses a simulated API reply; the live call still needs testing.
- **Iteration 3 (in progress):** Finish HTTPS, deploy the backend, add access control, and verify the site, AI reply, and EDI independently.
- **Later experiment:** Compare Raw and Mixed answers side by side. Add this to the spec before implementation; it is not part of the current deployment gate.

## Known dependency

The Bluehost A record points `promptmixer.vergotek.com` to `3.134.129.111`. HTTP worked; the first Certbot attempt failed because Let's Encrypt saw NXDOMAIN. A later Certbot attempt succeeded on September 25 (Chicago time) and installed the certificate. Verify HTTPS and the HTTP redirect before enabling authenticated access and the paid API endpoint. Do not enable password entry over plain HTTP.
