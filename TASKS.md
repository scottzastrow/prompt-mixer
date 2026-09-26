# Prompt Mixer — tasks for this iteration

This iteration focuses on the revised prompt-mixer behavior in [SPEC.md](SPEC.md) and the implementation plan in [PLAN.md](PLAN.md). Completed work is checked. Deployment and live API verification remain intentionally unchecked until the production site is fully tested.

## Core app behavior

- [x] T1: Build the Raw, Context, Role, and Constraints inputs with the optional checkbox logic. The Raw prompt remains required.
- [x] T2: Build Show Mix and Copy so the assembled prompt matches the current checked inputs and omits blank or unchecked optional fields.
- [x] T3: Ensure changing any input clears the prior AI answer so it cannot be confused with the current prompt.

## Server and AI generation

- [x] T4: Add a server-side generation endpoint that validates the incoming prompt and calls the OpenAI API from the server only.
- [x] T5: Connect Generate Response to the current assembled prompt and show loading, result, and error states.
- [x] T6: Verify locally that a simulated API response works and that public files do not expose the API key.
- [ ] T7: Run a live API request with the separate Prompt Mixer project key and verify the returned answer corresponds to the selected fields.

## Deployment and production checks

- [x] T8: Install the TLS certificate for promptmixer.vergotek.com via Certbot; HTTPS is complete on the production hostname.
- [ ] T9: Provision the private Node service environment, install Node.js runtime dependencies, and start the app on the local-only port behind Nginx.
- [ ] T10: Add Nginx basic authentication for the Prompt Mixer site while keeping the app on the private local port and preserving the HTTPS redirect.
- [ ] T11: Verify the live AI response with the project key and confirm the app, auth, and EDI site all work together in production.
- [ ] T12: Record deployment notes and any follow-up changes needed for the next iteration.

## Homework 3 reflection — written by Scott

After implementation, write a short account in your own words of what you learned, how long the work took (especially implementation), and the challenges encountered. The professor suggested less than a page and does not want AI to write this reflection. Concrete points you might choose to discuss: correcting the checkbox behavior, the difference between Copilot building an app and an app calling AI, separating API keys, and DNS propagation delaying HTTPS. Use only points that match your own experience.
