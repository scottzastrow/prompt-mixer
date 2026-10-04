# Prompt Mixer — tasks for this iteration

Earlier iterations and deployment are recorded below. The current iteration implements cumulative response comparison from [SPEC.md](SPEC.md) and [PLAN.md](PLAN.md); its task status is tracked separately here.

## Core app behavior

- [x] T1: Build the Raw, Context, Role, and Constraints inputs with the optional checkbox logic. The Raw prompt remains required.
- [x] T2: Replace the old Show Mix flow with a live preview that updates immediately and omits blank or unchecked optional fields.
- [x] T3: Keep explicit unchecks stable until the field is edited or checked again, and clear the prior AI answer when the prompt or selections change.

## Server and AI generation

- [x] T4: Add a server-side generation endpoint that validates the incoming prompt and calls the OpenAI API from the server only.
- [x] T5: Connect Generate Response to the current assembled prompt and show loading, result, and error states.
- [x] T6: Verify locally that a simulated API response works and that public files do not expose the API key.
- [x] T7: Run a live API request with the separate Prompt Mixer project key and verify the returned answer corresponds to the selected fields.
- [x] T8: Diagnose incomplete OpenAI replies by logging only response metadata (id, `x-request-id`, status, `incomplete_details`, `error`, `usage`, and output item types) and never logging prompts, credentials, or response contents.
- [x] T9: Update the Responses API request to use `reasoning: { effort: "low" }` and `max_output_tokens: 3000` after confirming the live `response_status=incomplete` / `max_output_tokens` diagnosis, while keeping the existing rate limits, diagnostics, database logging, and prompt constraints intact.

## Iteration 5 — cumulative response comparison

- [x] I5-T1: Generate a raw-only request, then cumulative requests for selected, nonempty optional fields in Context, Role, Constraints order; keep the button label “Generate Response”.
- [x] I5-T2: Render one clearly labeled card per request with its exact prompt, independent loading/success/error status, and compact accessible Show more / Show less answer controls.
- [x] I5-T3: Keep successful answers after another request fails; stop sending requests after a rate-limit response and continue counting each sent request through the existing server limits and database logger.
- [x] I5-T4: Prevent duplicate runs and cancel/ignore stale work after field or checkbox edits, preset changes, or Clear.
- [x] I5-T5: Add focused automated tests for cumulative prompt selection, card/run behavior, cancellation, failure preservation, and rate-limit stopping; run the full suite.
- [ ] I5-T6: Manually verify keyboard accessibility, responsive card layout, live combined-prompt preview, and production-only behaviors that cannot be established by local tests.

## Iteration 6 — direct response PDF downloads

- [x] I6-T1: Add the requested accessible download icon button to each card and enable it only after that response succeeds.
- [x] I6-T2: Add a maintained PDF library as a production dependency and serve its browser assets locally without changing the existing CSP.
- [x] I6-T3: Download a paginated PDF from the card’s exact prompt and complete response, preserving line breaks and Unicode regardless of onscreen collapse state; use a filesystem-safe filename.
- [x] I6-T4: Add automated coverage for full-content export, success-only enabling, unchanged expansion state, and no extra generation request or database write; run `npm test`.
- [ ] I6-T5: Manually verify downloads for short and long responses, Unicode text, accessible tooltip/label, and responsive card placement.

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
