# Prompt Mixer — tasks for this iteration

This iteration focuses on the revised prompt-mixer behavior in [SPEC.md](SPEC.md) and the implementation plan in [PLAN.md](PLAN.md). Completed work is checked. Deployment and live API generation are recorded below. The production app, shared-host smoke checks, and simulated certificate renewals passed.

## Core app behavior

- [x] T1: Build the Raw, Context, Role, and Constraints inputs with the optional checkbox logic. The Raw prompt remains required.
- [x] T2: Replace the old Show Mix flow with a live preview that updates immediately and omits blank or unchecked optional fields.
- [x] T3: Keep explicit unchecks stable until the field is edited or checked again, and clear the prior AI answer when the prompt or selections change.

## Server and AI generation

- [x] T4: Add a server-side generation endpoint that validates the incoming prompt and calls the OpenAI API from the server only.
- [x] T5: Connect Generate Response to the current assembled prompt and show loading, result, and error states.
- [x] T6: Verify locally that a simulated API response works and that public files do not expose the API key.
- [x] T7: Run a live API request with the separate Prompt Mixer project key and verify the returned answer corresponds to the selected fields.

## Deployment and production checks

- [x] T8: Install the TLS certificate for promptmixer.vergotek.com via Certbot; HTTPS is complete on the production hostname.
- [x] T9: Provision the private Node service environment, install Node.js runtime dependencies, and start the app on the local-only port behind Nginx.
- [x] T10: Add Nginx basic authentication for the Prompt Mixer site while keeping the app on the private local port and preserving the HTTPS redirect.
- [x] T11: Verify the live AI response with the project key and confirm the app, auth, and EDI site all work together in production.
- [x] T12: Record deployment notes and any follow-up changes needed for the next iteration.

## Deployment notes — September 26, 2026

- The reviewed `feature/ai-response` branch is deployed at `/opt/promptmixer-app` on the shared Lightsail host; the earlier static files remain at `/opt/promptmixer`.
- Node.js 22 runs the app through the separate `promptmixer` systemd service on `127.0.0.1:8081`. The Prompt Mixer OpenAI project key is stored in the protected service environment file outside Git.
- Nginx serves the app over HTTPS behind basic authentication. Unauthenticated HTTPS returned 401; HTTP returned 301 to HTTPS. The previous Nginx site file was backed up before the proxy change.
- Both local server tests passed. A live raw prompt and a subsequent prompt with Context each returned an AI response; the contextual answer used the supplied loops example.
- EDI continued to load on the shared host after deployment, completing the integrated app smoke check. `sudo certbot renew --dry-run` succeeded for both Prompt Mixer and EDI certificates.

## Homework 3 reflection — written by Scott

After implementation, write a short account in your own words of what you learned, how long the work took (especially implementation), and the challenges encountered. The professor suggested less than a page and does not want AI to write this reflection. Concrete points you might choose to discuss: correcting the checkbox behavior, the difference between Copilot building an app and an app calling AI, separating API keys, and DNS propagation delaying HTTPS. Use only points that match your own experience.
