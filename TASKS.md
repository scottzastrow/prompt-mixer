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
- [x] I9-T7: Verify multi-turn conversations live on Lightsail: English and Japanese follow-up chains both worked, PDFs preserved every completed turn in order, and the latest Japanese run offered a code example followed by expected output without requesting external actions.

## Iteration 10 — browser-based default language

- [x] I10-T1: Choose the initial language from a valid saved choice (`en`/`ja`) first, then `navigator.languages` in preference order with a `navigator.language` fallback; map `en`/`en-*` and `ja`/`ja-*` case-insensitively, skip unsupported tags, and default to English.
- [x] I10-T2: Handle unavailable localStorage or browser language information without breaking initialization, and never persist an automatically detected default as an explicit user choice while keeping the dropdown and explicit-selection persistence working.
- [x] I10-T3: Add regression tests for preference ordering, regional language tags, unsupported-language fallback, saved-choice priority, invalid saved values, and unavailable storage; run `npm test` and `git diff --check`.

## Iteration 11 — structured server logging

- [x] I11-T1: Add a shared server logger that writes one complete JSON record per line to stdout/stderr with a millisecond UTC timestamp, level (`info`/`warn`/`error`), stable event name, optional request ID, and explicitly selected context.
- [x] I11-T2: Generate a server-side request ID per AI generation/follow-up request and log a start event plus exactly one terminal outcome (validation rejection, rate limiting, conversation limits, missing configuration, upstream failure, empty/invalid AI response, success) with duration and safe metadata such as model, locale, and follow-up turn.
- [x] I11-T3: Convert startup and diagnostic messages to structured events; preserve OpenAI diagnostics through an explicit allowlist (response ID, upstream request ID, statuses, incomplete reason, token usage, output item types) and never log raw upstream error objects, prompts, answers, history, credentials, connection strings, or client IPs.
- [x] I11-T4: Keep database prompt/response logging and log database-write failures as separate structured events tied to the request ID, preserving user-facing behavior, API response contracts, and rate limits.
- [x] I11-T5: Document systemd journal persistence inspection, manual persistence configuration, live log viewing, and NDJSON export of valid application records (excluding systemd lifecycle messages) in DEPLOY.md without changing any server configuration.
- [x] I11-T6: Add tests for JSON structure, timestamp format, request correlation, rejection before paid calls, terminal outcomes, and sensitive-data exclusion; update the existing diagnostic tests; run `npm test` and `git diff --check`.
- [ ] I11-T7: Verify structured logs in the live systemd journal on Lightsail when deployment access is available.
- [x] I11-T8: Log exactly one correlated terminal event for request-body read failures and client disconnects, with no paid call and no response written to a destroyed connection; add a regression test.
- [x] I11-T9: Preserve reasoning-token counts in the explicitly allowlisted usage metadata used to diagnose empty responses.
- [x] I11-T10: Document journald drop-in inspection, flushing runtime entries to persistent storage, jq installation, and per-message NDJSON export that skips malformed/non-application records without aborting.

## Iteration 12 — paired demo-context bridge (milestone 1 implemented with fixtures)

Design and acceptance criteria live in [SPEC.md](SPEC.md) and [PLAN.md](PLAN.md). Milestone 1 is an authenticated MCP connection backed by synthetic fixture data only; no database migration or real conversation capture begins until milestone 1 works in ChatGPT.

- [x] I12-T1: Provider decided: Auth0 Free. The Auth0 tenant was configured manually on 2026-10-17; the two tenant toggles, CIMD metadata, S256, issuer identification, and private_key_jwt support were confirmed on the live tenant metadata. Free-plan availability of these settings after the current trial ends remains unverified (re-check before deployment). mTLS hardening is skipped for milestone 1. TTL/limit defaults adopted: session 24 h, code 5 min, 5 attempts. Capture-credential persistence stays open for the browser milestone. Presenter ChatGPT account capability is still to confirm at rehearsal time.
- [x] I12-T2 (milestone 1): Auth0 milestone-1 setup executed manually on 2026-10-17: tenant created; “Resource Parameter Compatibility Profile” and “Include Issuer in Authorization Responses” enabled; API/resource server created with identifier `https://promptmixer.vergotek.com` and `demo:pair`/`demo:read` scopes (RS256); CIMD registration enabled and DCR left disabled; presenter user created in `Username-Password-Authentication` and the connection promoted to domain level; tenant metadata verified for PKCE S256 and CIMD (`client_id_metadata_document_supported`). Recorded for the environment file: `DEMO_IDP_ISSUER=https://dev-158214i5w3prdebi.us.auth0.com/`, `DEMO_IDP_JWKS_URI=https://dev-158214i5w3prdebi.us.auth0.com/.well-known/jwks.json`, `DEMO_MCP_AUDIENCE=https://promptmixer.vergotek.com`.
- [x] I12-T3 (milestone 1): Implemented `/mcp` (Streamable HTTP via the official `@modelcontextprotocol/sdk`, stateless per request) and `/.well-known/oauth-protected-resource` (RFC 9728), with injectable Bearer verification (`verify-access-token.mjs`, built on the maintained `jose` library: RS256 signature against the provider JWKS with bounded cache lifetime, unknown-key refresh cooldown, concurrent-fetch deduplication, and fetch timeout; issuer, audience, expiry, subject, and scopes) backed by an in-memory fixture store (`demo-fixture-store.mjs`: synthetic session, fixture pairing code from `DEMO_FIXTURE_PAIRING_CODE`, synthetic conversation). Rate limiting: all `/mcp` requests per hashed client IP through a second file-backed `RequestLimits` instance (tighter defaults, own state file), plus per-identity (hashed issuer+subject) in-memory limiting of `tools/call`. Added the `@modelcontextprotocol/sdk`, `zod`, and `jose` runtime dependencies. The bridge is disabled unless `DEMO_IDP_ISSUER`, `DEMO_IDP_JWKS_URI`, and `DEMO_MCP_AUDIENCE` are all configured.
- [x] I12-T4 (milestone 1): Implemented the seven tools with accurate annotations — read-only retrieval (`get_profile` marked `_meta["openai/profile"]: true` with a stable opaque issuer+subject-derived ID, `get_demo_session`, `list_demo_runs`, `get_demo_run`) and state-changing (`pair_demo_session`, `activate_demo_session`, `unpair_demo_session`); pairing-required results for authenticated-but-unpaired calls; OAuth challenges only for unauthenticated calls; per-tool `securitySchemes`; control-phrase semantics (“Let's go live” / “Let's take it offline”, confirmed only from server results) and the untrusted-data rule in tool descriptions and server instructions.
- [ ] I12-T5 (milestone 1): Test with locally minted fixture tokens (no IdP network) — done: `test/demo-store.test.mjs`, `test/access-token.test.mjs`, and `test/mcp.test.mjs` cover auth failures (missing/malformed/bad-signature/unknown-key/wrong-issuer/wrong-audience/expired/not-yet-valid tokens), a scopes regression driving real tokens through the actual verifier and HTTP handler (authorized tool succeeds; insufficient scope returns 403), JWKS cache bounds (unknown-key cooldown, concurrent-fetch deduplication, cache lifetime, fetch timeout), per-IP and per-identity rate limits, tool annotations, the full pair → activate → retrieve → unpair lifecycle, cross-identity isolation, foreign-ID not-found, code lockout and single use, and log hygiene; `npm test` passes (67 tests). Still open: MCP Inspector check, then connect as a custom MCP server in the presenter's ChatGPT account and rehearse link → pair → “Let's go live” → fixture retrieval → “Let's take it offline”. Gate: proceed to later milestones only after this passes.
- [ ] I12-T6: Write `db/migrations/20261017-demo-context.sql` creating only the `demo_%` tables with foreign keys and uniqueness constraints, plus administrator-run statements for a narrowly scoped MySQL account (SELECT/INSERT/UPDATE/DELETE on `demo_%` only), verification queries, and a rollback that drops only those objects.
- [ ] I12-T7: Implement `demo-store.mjs` with a MySQL implementation (short-lived connections, non-fatal failures) and an in-memory fixture for tests; keep `prompt_log` untouched.
- [ ] I12-T8: Add presenter-key-gated capture routes (`POST /api/demo/sessions` with timing-safe key check and attempt limits, disabled when unconfigured; `runs`, `revoke`, `cancel`) and accept the optional `demo` field on `/api/generate` and `/api/follow-up`, validating session/run/card/turn ownership before capture, never blocking generation on demo errors, and returning `demoRecorded` in responses.
- [ ] I12-T9: Implement pairing-code persistence and redemption (8-character unambiguous codes grouped 4-4, SHA-256 hash-only storage, 5-minute expiry, single use, 5-attempt lockout, one active code per session, generation caps) and the binding states `paired`/`live`/`offline` with activation and revocation.
- [ ] I12-T10: Implement cancellation honesty: the best-effort `POST /api/demo/cancel` notice (keepalive), `success`/`superseded`/`canceled` row statuses, and verbatim status reporting in retrieval results.
- [ ] I12-T11: Build the browser Demo sharing control (off by default): presenter-key entry (never persisted or logged), enable/disable with revoke, pairing-code display with expiry, pairing-state view, `X-Demo-Capture` on AI requests, English/Japanese strings, and unchanged public behavior when disabled.
- [ ] I12-T12: Add structured operational events for session lifecycle, pairing outcomes, capture failures, and MCP tool outcomes; extend the marker-string tests to prove prompts, answers, code plaintext, the presenter key, capture credentials, access tokens, connection strings, and client IPs never appear.
- [ ] I12-T13: Per-IP and per-identity MCP limits were implemented in milestone 1 (second file-backed `RequestLimits` instance for `/mcp`, in-memory per-identity `tools/call` limiter). Remaining: apply the demo management-endpoint limits instance (per hashed IP) when the capture routes land, leaving AI generation limits unchanged.
- [ ] I12-T14: Complete the fixture-only test suite: in-memory demo store, stubbed OpenAI fetch, locally minted test tokens; cover capture ordering, retries, cancellation statuses, code lifecycle, binding states, cross-session isolation, expiry/revocation, annotations, and log hygiene. No paid AI calls, no real MySQL, no IdP network access. Run `npm test` and `git diff --check`.
- [ ] I12-T15: Wire Nginx (`/mcp` and `/.well-known/oauth-protected-resource` to `127.0.0.1:8081`, no basic auth, port stays closed), document env additions and the migration runbook in DEPLOY.md, verify with MCP Inspector, and rehearse pair → go live → retrieve → offline from the presenter's ChatGPT account during a deployment window.

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
