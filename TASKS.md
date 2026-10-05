# Prompt Mixer — tasks for this iteration

Earlier iterations and deployment are recorded below. The current iteration implements cumulative response comparison from [SPEC.md](SPEC.md) and [PLAN.md](PLAN.md); its task status is tracked separately here.
Earlier iterations and deployment are recorded below. The current iteration implements continuous AI follow-ups from [SPEC.md](SPEC.md) and [PLAN.md](PLAN.md); its task status is tracked separately here.

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

## Iteration 7 — English/Japanese language selection

- [x] I7-T1: Add persistent, accessible language selection after Clear, in Presets → Clear → Language keyboard and visual order, with narrow-screen support and document language updates.
- [x] I7-T2: Localize all interface strings and presets; preserve user values and checkbox state on switching, preserve locale on Clear, and cancel/clear active comparisons without making requests.
- [x] I7-T3: Include a transparent selected-language instruction in the preview and every cumulative prompt, including Raw only; log the exact submitted prompt and request responses in the selected language while preserving quoted text and code when appropriate.
- [x] I7-T4: Return stable server error codes and localize their messages without changing HTTP statuses, rate limits, diagnostics, or credential protection.
- [x] I7-T5: Localize full-content PDFs and apply Noto Sans JP to Japanese headings and card labels as well as prompt/response text; preserve collapsed state and do not make additional requests.
- [x] I7-T6: Add regression coverage; run `npm test` and manually verify both languages, switching with typed inputs, Japanese presets, error states, and a Japanese PDF. Remove test intercepts afterward.
- [x] I7-T6: Add regression coverage; run `npm test` and manually verify both languages, switching with typed inputs, Japanese presets, error states, and a Japanese PDF. Remove test intercepts afterward.

## Iteration 8 — optional AI follow-up

- [x] I8-T1: Return each answer and nullable follow-up offer using OpenAI Structured Outputs and a supported strict JSON Schema; do not detect offer phrases.
- [x] I8-T2: Add a separate, rate-limited and logged follow-up request using the card's exact prompt, original answer, and follow-up prompt; constrain its response to an answer with no further offer.
- [x] I8-T3: Add localized Yes/No controls and follow-up loading, success, dismissal, and error states; prevent duplicate requests and retain the original answer on failure.
- [x] I8-T4: Cancel pending follow-ups and ignore stale results after prompt edits, preset selection, Clear, or language changes.
- [x] I8-T5: Include each completed follow-up's exact prompt and full answer in that card's PDF without changing the original response or issuing another request.
- [x] I8-T6: Test Yes, No, no offer, errors, 429 rate limits, cancellation, both locales, and PDF inclusion using simulated API responses; run `npm test` and `git diff --check` without an API key.
- [ ] I8-T7: Perform a live Lightsail verification separately when deployment access is available.
- [x] I8-T7: Verify on Lightsail that English Yes generates a follow-up while preserving the original answer, No dismisses the offer, Japanese Yes generates a Japanese follow-up, and English/Japanese PDFs include the original prompt, answer, and completed follow-up.

## Iteration 9 — continuous AI follow-ups

- [x] I9-T1: Send each card's ordered conversation history to the server and request a structured nullable offer on every turn.
- [x] I9-T2: Enforce a maximum of 8 completed follow-up turns, 24,000 Unicode code points across conversation text, and a 200 KB request body on the server; return a localized start-new-prompt error without truncating history.
- [x] I9-T3: Append turns only after explicit Yes, keep No as a no-request dismissal, prevent duplicate submissions, and allow deliberate retries of failed turns without duplicating completed turns.
- [x] I9-T4: Preserve independent per-card history, cancellation/stale-result protection, existing rate limits, logging, and English/Japanese localization.
- [x] I9-T5: Add accessible Show more / Show less controls for long follow-up answers and export every completed prompt/answer pair in order to PDFs.
- [x] I9-T6: Test multiple turns, dismissal, no offer, duplicate prevention, retry, server limits, cancellation, both languages, and PDF inclusion with simulated responses; run `npm test` and `git diff --check` without an API key.

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
