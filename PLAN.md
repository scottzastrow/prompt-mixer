# Prompt Mixer — implementation plan

This plan follows the current [specification](SPEC.md). The original Homework 2 document remains a record of the first scope; live AI generation, experiment logging, and cumulative response comparison are later iterations.

## Goal and approach

Build one screen that shows how optional prompt instructions affect the text sent to an AI and the resulting answer. The browser assembles the prompt and displays it. A small Node.js server serves the page and makes the OpenAI request with a project-specific key held only on the server. No database or accounts are required for the class version.

## Components

1. **Browser:** Raw, Context, Role, and Constraints inputs; live combined prompt preview; checkbox semantics for optional text; Generate Response; sequential cumulative prompt variants; independently stateful response cards with exact prompts, expandable answer previews, and per-card direct PDF downloads from the retained card data.
2. **Server:** `POST /api/generate` validates each prompt, applies the existing request limits, calls OpenAI, and returns only the generated text. It also serves the static files, including the locally installed PDF browser assets under the existing CSP, and `GET /health`.
3. **Deployment:** existing Lightsail Ubuntu host, separate Prompt Mixer service on `127.0.0.1:8081`, and its own Nginx virtual host. EDI remains on `127.0.0.1:8080`.
4. **Access:** finish HTTPS before adding basic authentication and enabling the paid API endpoint. Keep the Prompt Mixer key in a protected service environment file, separate from EDI.

## Iteration and verification

- **Iteration 1 (built):** Assemble and copy a prompt. Verify that each checkbox includes or omits its field.
- **Iteration 2 (built):** Generate a real AI answer. Verify required input, server validation, API response handling, and that the key does not appear in public files. Two local tests passed and a live answer was verified.
- **Iteration 3 (deployed):** HTTPS, the private Node service, and basic authentication are in place. Live raw and contextual answers worked; EDI remained available. Simulated certificate renewals succeeded for both sites.
- **Iteration 4 (built):** Add a persistent experiment log. Successful AI interactions are stored in the Bluehost MySQL database `vergotek_promptmixer` with timestamp, model, prompt, and response. Database logging is non-fatal: if persistence fails, the AI response is still returned to the user. The application opens a short-lived database connection for each write because the hosted MySQL server has a 10-second idle timeout.
- **Iteration 5 (implemented):** Generate the raw-only response and then one response per selected, nonempty optional field, cumulatively in Context, Role, Constraints order. Use one server request per card so existing limits and logging apply per answer. Preserve completed answers on individual errors, stop after a rate-limit response, and cancel/ignore stale work when inputs, presets, or Clear change the run. Automated tests pass; manual browser and production checks remain.
- **Iteration 6 (implemented):** Add an accessible, success-only PDF download to every response card. Generate a paginated PDF locally from the retained exact prompt and full response, with Unicode and line breaks, without a print dialog or additional AI/database request. Serve pdfmake and its embedded fonts locally under the existing CSP; automated tests verify full-content export, unchanged collapsed state, safe filenames, and no extra generation requests.
- **Iteration 7 (implemented):** Add persistent English/Japanese selection at the far right of the header controls, after Presets and Clear. Localize all browser text, presets, validation and stable-code server errors; preserve field values/check states on language changes and preserve language on Clear. Append the selected language instruction to every cumulative prompt (including Raw only), display and log the exact instruction-bearing prompt, and use Japanese fonts for localized PDF headings/card labels as well as content. Language changes cancel active work, clear results, and restore the preview without a request. Preserve limits, statuses, diagnostics, CSP, cancellation, checkbox semantics, and responsive layout. Automated tests pass; browser verification covered both languages, Japanese errors/preset/prompt/PDF output, typed-value preservation, and mobile layout.
- **Later experiment:** Add a History interface so stored interactions can be reviewed without direct database access.
- **Iteration 8 (in progress):** Use OpenAI Structured Outputs with a strict JSON Schema for each answer and nullable follow-up offer; do not infer offers from answer wording. Add one optional Yes/No follow-up per card through the existing server-side limits, token settings, and non-fatal experiment logger. Cancel pending follow-ups when the comparison is invalidated, retain original answers after follow-up errors, localize the controls and states, and append completed follow-up prompts/answers to the card PDF. Verify through mocked OpenAI responses without credentials; production live verification remains a separate deployment check.
- **Iteration 8 (implemented):** Use OpenAI Structured Outputs with a strict JSON Schema for each answer and nullable follow-up offer; do not infer offers from answer wording. Add one optional Yes/No follow-up per card through the existing server-side limits, token settings, and non-fatal experiment logger. Cancel pending follow-ups when the comparison is invalidated, retain original answers after follow-up errors, localize the controls and states, and append completed follow-up prompts/answers to the card PDF. Automated tests pass with mocked OpenAI responses and no credentials; production live verification remains a separate deployment check.
- **Iteration 9 (in progress):** Replace the single-follow-up limit with explicit user-driven turns per card. Send ordered structured history to the server; return a new structured offer after every answer; support retrying only failed turns; enforce eight completed follow-up turns and 24,000 Unicode code points of conversation text per card on the server (plus a 200 KB request-body ceiling). Keep cards independent, preserve cancellation/localization/rate limits/logging, and export all completed turns in order with expandable answers.
- **Iteration 9 (implemented):** Replace the single-follow-up limit with explicit user-driven turns per card. Send ordered structured history to the server; return a new structured offer after every answer; support retrying only failed turns; enforce eight completed follow-up turns and 24,000 Unicode code points of conversation text per card on the server (plus a 200 KB request-body ceiling). Keep cards independent, preserve cancellation/localization/rate limits/logging, and export all completed turns in order with expandable answers. Automated tests pass with simulated responses and no API key.
- **Iteration 10 (implemented):** Choose the initial interface language from the browser when no explicit selection is stored. A valid saved choice (`en` or `ja`) takes priority; otherwise inspect `navigator.languages` in preference order with `navigator.language` as a fallback, mapping `en`/`en-*` to English and `ja`/`ja-*` to Japanese case-insensitively, skipping unsupported tags, and defaulting to English. Handle unavailable localStorage or browser language data without breaking initialization, and never persist an automatically detected default as an explicit user choice. Keep the dropdown and explicit-selection persistence unchanged. Automated regression tests cover preference ordering, regional tags, unsupported-language fallback, saved-choice priority, invalid saved values, and unavailable storage.
- **Iteration 11 (implemented):** Add structured operational logging through a shared server logger that writes one complete JSON record per line to stdout/stderr: millisecond UTC timestamp, level, stable event name, a server-generated request ID for request-scoped events, and explicitly selected safe context. Each AI generation/follow-up request logs a start event and exactly one terminal outcome event (validation rejection, rate limiting, conversation limits, missing configuration, upstream failure, empty/invalid AI response, request interruption, or success) with duration; a client disconnect or request-body read failure never triggers a paid call or a write to a destroyed connection. Startup, rate-limit-store, and database-write failures become structured events, and OpenAI diagnostics pass through an explicit allowlist (including reasoning-token counts) that drops raw upstream error objects. Logs exclude prompts, answers, conversation history, credentials, connection strings, and client IPs, and are collected by the existing systemd journal with no new storage or telemetry. Automated tests cover record structure, timestamp format, request correlation, rejection before paid calls, terminal outcomes, and sensitive-data exclusion; live journal verification remains a deployment check.
- **Iteration 12 (proposed — design stage):** Add a presenter-enabled, off-by-default demo-context bridge. The presenter creates a server-side demo session from the page; the browser captures exact prompts and completed answers into new `demo_%` tables keyed by session/run/card/turn identifiers (never by IP). A short-lived, single-use pairing code binds the presenter's authenticated OAuth 2.1 identity — supplied by ChatGPT's MCP connection over Streamable HTTP at `/mcp` — to that session, and a small read-only tool set returns the ordered conversation for the bound session only. Design, acceptance criteria, migration, deployment steps, unresolved questions, and the smallest implementation sequence are in the Iteration 12 design section below.
- **Iteration 12, milestone 1 (implemented locally, 2026-10-17):** Authenticated Streamable HTTP MCP endpoint at `/mcp` plus RFC 9728 protected-resource metadata at `/.well-known/oauth-protected-resource`, implemented with the official `@modelcontextprotocol/sdk`. Bearer verification uses the maintained `jose` library: RS256 signature against the Auth0 JWKS with bounded cache lifetime, unknown-key refresh cooldown, concurrent-fetch deduplication, and fetch timeout, then issuer, audience, expiry, subject, and per-tool scopes. All seven planned tools run against an in-memory synthetic fixture store with pairing-code expiry, single use, five-attempt lockout, activation, immediate unpair/revocation, and identity-bound session isolation. All `/mcp` requests are rate-limited per hashed client IP (second file-backed `RequestLimits` instance, tighter defaults) and `tools/call` is metered per authenticated identity; JWKS fetches are additionally bounded by the cooldown. The bridge is disabled unless `DEMO_IDP_ISSUER`, `DEMO_IDP_JWKS_URI`, and `DEMO_MCP_AUDIENCE` are configured, so default app behavior is unchanged. No database migration, no real conversation capture, no paid AI calls. Fixture tests pass; MCP Inspector and ChatGPT pairing rehearsal remain deployment checks, and no plugin has been created yet.
- **Later experiment:** Add a History interface so stored interactions can be reviewed without direct database access.

## Iteration 8 verification

- Verify the Responses API request uses a supported strict JSON Schema with a required string answer and nullable `{ offer, prompt }` follow-up; follow-up-answer requests require `follow_up: null`.
- Verify every Responses API answer, including follow-up answers, uses a supported strict JSON Schema with a required string answer and nullable `{ offer, prompt }` follow-up.
- Verify Yes sends one separate server request containing the card's exact original prompt, original answer, and offered next prompt; No makes no request.
- Verify Yes sends one separate server request containing the card's original prompt, original answer, ordered completed turns, and offered next prompt; No makes no request.
- Verify no-offer responses omit follow-up controls, duplicate Yes submissions are blocked, follow-up failures preserve the original answer, and 429 responses use existing limits.
- Verify field edits, preset selection, Clear, and language changes abort pending follow-ups and discard stale results; verify English/Japanese UI strings.
- Verify a completed follow-up exports its exact prompt and full answer in the existing PDF without another AI request or database write.
- Verify all completed follow-up prompts and full answers export in order in the existing PDF without another AI request or database write.
- Use mocked API responses only for local checks, then run `npm test` and `git diff --check`; live Lightsail verification is not part of local testing.

## Iteration 9 verification

- Verify every answer uses Structured Outputs with a nullable structured offer and only a deliberate Yes sends the next turn; No only dismisses that offer.
- Verify each card sends its own ordered history, supports multiple offers, blocks duplicate in-flight submissions, and retries failed turns without duplicating successful turns.
- Verify the server rejects more than 8 completed follow-up turns or more than 24,000 Unicode code points of conversation text with a localized start-new-prompt error; reject request bodies over 200 KB.
- Verify cancellation prevents stale turn results, English/Japanese strings and answers are preserved, and long follow-up answers have accessible Show more / Show less controls.
- Verify PDFs include the exact original prompt, answer, and every completed follow-up prompt/answer in order, without another request.
- Use simulated responses without an API key, then run `npm test` and `git diff --check`.

## Iteration 10 verification

- Verify a valid saved `en`/`ja` choice wins over browser preferences and an invalid saved value is ignored.
- Verify `navigator.languages` preference order is honored with a `navigator.language` fallback, regional tags map case-insensitively (`en`/`en-*` → English, `ja`/`ja-*` → Japanese), unsupported preferences fall back to English, and unavailable localStorage or browser language data does not break initialization.
- Verify the language dropdown still works, explicit selections persist locally, and an automatically detected default is never written to local storage.
- Run `npm test` and `git diff --check`.

## Iteration 11 verification

- Verify each log line is one complete JSON object with a millisecond UTC timestamp, a level of `info`/`warn`/`error`, a stable event name, and a server-generated request ID on request-scoped events.
- Verify every AI generation/follow-up request logs a start event and exactly one terminal outcome event — validation rejection, rate limiting, conversation limits, missing configuration, upstream failure, empty/invalid AI response, request interruption, or success — with duration and safe metadata, and that validation, rate-limit, and conversation-limit rejections are logged before any paid call. A client disconnect mid-body yields exactly one correlated terminal event, no paid call, no response write to the destroyed connection, and a server that keeps serving later requests.
- Verify OpenAI diagnostics use only the explicit allowlist (response ID, upstream `x-request-id`, HTTP status, response status, incomplete reason, token usage including reasoning-token counts, output item types) and never include raw upstream error objects, prompts, answers, history, credentials, connection strings, or client IPs.
- Verify database-write failures are separate structured events tied to the request ID, and user-facing behavior, API response contracts, and rate limits are unchanged.
- Run `npm test` and `git diff --check`; verify journal persistence checks and the NDJSON export commands from DEPLOY.md during the next deployment window.

## Known dependency

The Bluehost A record points `promptmixer.vergotek.com` to `3.134.129.111`. HTTP worked; the first Certbot attempt failed because Let's Encrypt saw NXDOMAIN. A later Certbot attempt succeeded on September 25 (Chicago time) and installed the certificate. HTTPS and the HTTP redirect were verified before authenticated access and the paid API endpoint went live.

## Iteration 5 verification

- Verify cumulative prompt construction for all-selected, partially-selected, unchecked, and blank optional fields.
- Verify independent card loading/success/error states, preservation of successful answers, and stop-on-429 behavior.
- Verify each prompt is a distinct rate-limited/logged server request.
- Verify duplicate prevention and cancellation on edits, preset changes, and Clear, including late responses from aborted requests.
- Verify exact prompt display, accessible Show more / Show less controls, live preview, server-only credentials, diagnostics, and database logging.

## Iteration 6 verification

- Verify the upper-right download button has the required label and tooltip and is enabled only for successful cards.
- Verify PDFs contain the app title, comparison label, exact full prompt, and full response even when those areas are collapsed onscreen; preserve paragraphs, line breaks, Unicode, wrapping, and pagination.
- Verify download does not change expansion state, request another AI response, or write another database record.
- Verify filenames are meaningful and filesystem-safe and the PDF library assets are served locally with the existing Content Security Policy.

## Iteration 7 verification

- Verify English default and locally persisted language selection, accessible dropdown order Presets → Clear → Language, document `lang`, and narrow-screen layout.
- Verify switching language preserves typed values and checkbox state, cancels work, clears results, restores the live preview, and causes no API request; Clear preserves locale.
- Verify English/Japanese presets, complete interface translations, localized stable-code server errors with unchanged status/rate-limit behavior, and selected-language output instructions on every cumulative prompt including Raw only.
- Verify preview, exact submitted prompt, database log, and PDF use the same instruction-bearing prompt; Japanese PDF headings and card labels render with Noto Sans JP and download preserves full content and collapsed UI state without another request.
- Run `npm test` and manually verify both languages, typed-input switching, Japanese presets, error states, and a Japanese PDF; remove test intercepts afterward.

## Iteration 12 design (paired demo-context bridge — milestone 1 implemented locally)

### Components

1. **Browser:** an off-by-default Demo sharing control. Enabling calls `POST /api/demo/sessions`, keeps the returned session identifier and write credential, and sends the credential (`X-Demo-Capture` header) plus demo metadata with later generation and follow-up requests. The view shows pairing state and expiry and offers Disable demo sharing (revoke) and Generate pairing code. Localized in English and Japanese.
2. **Capture API (server, existing process):** new routes `POST /api/demo/sessions` (requires the `DEMO_PRESENTER_KEY` value with a timing-safe comparison and strict attempt limits; disabled entirely when the key is unconfigured), `POST /api/demo/runs`, `POST /api/demo/pairing-codes`, `POST /api/demo/revoke`, and `POST /api/demo/cancel` (best-effort cancellation notice that marks a run canceled; sent with `keepalive` so it can fire during page close), plus an optional `demo` object accepted on `/api/generate` (`{ runId, cardSeq, label }`) and `/api/follow-up` (`{ runId, cardSeq, turnSeq, offerText? }`). Demo metadata is validated before the OpenAI call; invalid metadata never blocks generation — capture is skipped, a structured event is logged, and the response carries `demoRecorded: false`. Runs, cards, and turns are keyed by server-generated UUIDs with per-scope sequence numbers (run_seq, card_seq 1–4, turn_seq 1–8); the initial card answer is stored on the card row, and follow-ups are appended as turn rows that move pending → error → success on retry without duplication. Cancellation is recorded honestly: browser disconnection does not guarantee server processing stops, so rows completed before a cancel notice keep `success`, rows completed after it are stored as `superseded`, and never-completed rows of a canceled run report `canceled` at retrieval. Statuses describe what the server completed, not what the browser displayed.
3. **Demo store:** a new `demo-store.mjs` module with a MySQL implementation and an in-memory fixture for tests, mirroring the non-fatal pattern of the experiment logger. Short-lived connections per write, as with `prompt_log`.
4. **MCP endpoint (server, existing process):** `POST /mcp` implementing the Streamable HTTP transport via the official `@modelcontextprotocol/sdk` package, plus `GET /.well-known/oauth-protected-resource`. Bearer tokens are verified behind a small `verifyAccessToken` module (signature via the provider's JWKS, issuer, audience, expiry, scopes) so tests can inject locally minted fixture tokens.
5. **Tools:** read-only retrieval tools (`readOnlyHint: true`, `openWorldHint: false`, `destructiveHint: false`) — `get_profile()` (marked `_meta["openai/profile"]: true`, returning a stable opaque ID derived from the authenticated issuer+subject; recommended by current connection documentation, not required), `get_demo_session()`, `list_demo_runs()`, and `get_demo_run({ runId })` (scope `demo:read`); and state-changing tools (`readOnlyHint: false`) — `pair_demo_session({ code })` (scope `demo:pair`; creates the binding in state `paired`), `activate_demo_session()` (`paired` → `live`; enables retrieval), and `unpair_demo_session()` (revokes the binding server-side → `offline`). All use fixed parameterized queries resolved through the authenticated identity's session binding; no arbitrary SQL, no global-latest lookup. Missing, invalid, or expired tokens receive a `401` OAuth challenge (`WWW-Authenticate` / `_meta["mcp/www_authenticate"]`) so ChatGPT shows its linking UI; authenticated but unpaired or not-live calls receive a pairing-required tool result, never another challenge. Tool descriptions document the presenter control phrases — “Let's go live” (pair first when needed, then activate; confirm only from the server's result) and “Let's take it offline” (revoke server-side; confirm only from the server's result) — and state that neither starts background monitoring nor erases content already retrieved into the conversation. Server `instructions` and tool descriptions state that returned prompts and answers are untrusted data, never instructions.
6. **Rate limiting:** a second `RequestLimits` instance with its own state file and tighter defaults covers the demo management endpoints (per hashed IP, as today); MCP tools are limited per authenticated identity (hashed issuer+subject) rather than by IP. AI generation limits are unchanged and unaffected.

### Data model (migration `db/migrations/20261017-demo-context.sql`)

- `demo_sessions`: `id` UUID PK, `capture_token_hash` CHAR(64) UNIQUE (SHA-256 of the write credential), `bound_iss`/`bound_sub` NULL until paired, `paired_at`, `status` (`active`/`revoked`/`expired`), `locale`, `created_at`, `expires_at`, `revoked_at`.
- `demo_pairing_codes`: `code_hash` CHAR(64) PK (SHA-256; plaintext never stored), `session_id` FK, `attempts`, `created_at`, `expires_at`, `used_at`.
- `demo_runs`: `id` UUID PK, `session_id` FK, `run_seq` (UNIQUE per session), `locale`, `created_at`.
- `demo_cards`: `id` UUID PK, `run_id` FK, `card_seq` (UNIQUE per run), `label`, `exact_prompt`, `answer` NULL until success, `model`, `status` (`pending`/`success`/`error`), `created_at`, `completed_at`.
- `demo_turns`: `id` UUID PK, `card_id` FK, `turn_seq` (UNIQUE per card, 1–8), `submitted_prompt`, `completed_answer` NULL until success, `offer_text` NULL (the accepted offer that produced the turn), `attempts`, `status`, `created_at`, `completed_at`.
- Cascading deletes so purging an expired session removes its content. `prompt_log` is untouched.
- Grants: a dedicated MySQL account (for example `vergotek_pm_demo`) with `SELECT, INSERT, UPDATE, DELETE` on `vergotek_promptmixer.demo_%` only; credentials added to the protected service environment as `DEMO_DB_*` entries. The migration file includes the CREATE TABLE statements, the account/GRANT statements for an administrator to run, verification queries, and a rollback that drops only the `demo_%` objects.

### Pairing and control-phrase flow

1. Presenter enters the presenter key and enables Demo sharing → server verifies the key (timing-safe; feature disabled when unconfigured), creates the session, and returns the capture credential (hash stored; 24-hour expiry proposed).
2. Presenter clicks Generate pairing code → server returns an 8-character unambiguous-alphabet code grouped 4-4 (5-minute TTL, single-use, 5-attempt lockout, one active code per session, per-session generation cap).
3. Presenter says “Let's go live” in ChatGPT → the plugin checks state, asks the presenter for the code when no binding exists, calls `pair_demo_session` (binding created, state `paired`), then calls `activate_demo_session` (state `live`). The assistant confirms activation only from the server's tool results.
4. Retrieval tools answer only while the binding is `live`.
5. Presenter says “Let's take it offline” → the plugin calls `unpair_demo_session`, the server revokes the binding (state `offline`), and the assistant confirms only the server's result. Content already retrieved into the conversation remains there; no monitoring or polling is started. The presenter can also revoke from the page at any time.

### Deployment steps (design stage)

1. Resolve the authorization-server question below; configure the provider with the resource identifier `https://promptmixer.vergotek.com`, scopes `demo:pair` and `demo:read`, PKCE S256, and CIMD or DCR client registration; copy ChatGPT's redirect URI from the connection's management page into the provider allowlist.
2. Run the migration on the Bluehost MySQL database and create the narrowly scoped account; add `DEMO_DB_*`, `DEMO_PRESENTER_KEY`, `DEMO_SESSION_TTL_HOURS`, `DEMO_CODE_TTL_SECONDS`, `DEMO_CODE_MAX_ATTEMPTS`, `DEMO_LIMIT_STATE_FILE`, `DEMO_IDP_ISSUER`, `DEMO_IDP_JWKS_URI`, and `DEMO_MCP_AUDIENCE` to `/etc/promptmixer/promptmixer.env` (never committed).
3. Add the `@modelcontextprotocol/sdk` runtime dependency; implement the store, capture routes, pairing, and the `/mcp` endpoint; extend Nginx with `location /mcp` and `location /.well-known/oauth-protected-resource` proxying to `127.0.0.1:8081` (no `auth_basic`; OAuth instead); keep port 8081 closed externally.
4. Deploy the tested commit, restart only `promptmixer`, and smoke-check `/health`, the public app unchanged, and the well-known metadata document; verify structured events in the journal contain no content, codes, tokens, or IPs.
5. Exercise the endpoint with MCP Inspector (initialization, tool list, OAuth challenge), then connect a custom MCP server in the presenter's ChatGPT account, complete OAuth linking, and rehearse pair → retrieve → revoke with a real demo session.

### Identity provider comparison for milestone 1

Checked 2026-10-17 against the documented ChatGPT requirements (discovery metadata, PKCE S256 advertised, CIMD/DCR/predefined client registration, token-endpoint auth `none` or `private_key_jwt`, the `resource` parameter echoed into the access-token audience, and issuer identification in authorization responses):

| Requirement | Auth0 | Stytch |
| --- | --- | --- |
| Discovery metadata | Yes | Yes |
| PKCE S256 | Yes | Yes (shown in the documented flow) |
| Client registration | CIMD (per OpenAI's auth guide, which names Auth0 as providing metadata discovery, CIMD registration, API security, and token exchange) plus DCR and predefined third-party apps | CIMD (Beta, dashboard-enabled) per the official Connected Apps client-types documentation, plus DCR (opt-in toggle) and pre-registration |
| `resource` echoed into token audience | Yes — explicit tenant toggle “Resource Parameter Compatibility Profile” | Unanswered — the reviewed pages show token validation with the project ID as audience; no RFC 8707 resource-indicator support was found |
| `iss` in authorization responses | Yes — explicit tenant toggle “Include Issuer in Authorization Responses” | Yes — Connected Apps advertises `authorization_response_iss_parameter_supported` (changelog 2026-09-25, for MCP spec 2026-07-28 compliance) |
| Consent step | Hosted by Auth0 (Universal Login); nothing to self-host | Verified limitation: you host the Authorization Endpoint consent UI yourself (`<IdentityProvider />` component or an API-built page); custom domain strongly recommended |
| Account setup | Create a tenant, enable the two toggles, promote a connection to domain-level, create an API (resource server) with the production identifier and `demo:pair`/`demo:read` scopes, create the presenter user | Create a project, enable Connected Apps + DCR or CIMD (Beta), host the consent component, configure the authorization URL and custom domain |
| Cost at demo scale (~1 MAU) | Free plan: $0/month, up to 25,000 MAUs, no credit card, includes “Secure Agentic AI workflows” (auth0.com/pricing) | Free tier: $0/month, 10,000 MAUs and AI agents, full OAuth/authz suite included (stytch.com/pricing) |

Stytch correction (2026-10-17): an earlier draft claimed no CIMD support was found. Stytch's official Connected Apps documentation does advertise Client ID Metadata Documents (Beta), and its 2026-09-25 changelog confirms issuer identification (`authorization_response_iss_parameter_supported`). Verified Stytch limitation: the self-hosted consent endpoint. Remaining unanswered Stytch question: whether the `resource` parameter is echoed into the access-token audience — not found in the reviewed pages and would need hands-on verification.

**Decision: Auth0 Free (selected 2026-10-17).** It is the simplest suitable option — hosted consent (no consent page to build), documented tenant toggles that map exactly onto ChatGPT's `resource`-echo and issuer-identification requirements, CIMD support per OpenAI's own documentation, and a free plan that comfortably covers a single presenter. Stytch remains a viable fallback. Whichever provider is used, an ordinary website-login integration alone does not satisfy MCP authorization; the MCP-specific metadata, PKCE, resource, and registration behaviors must hold. No custom OAuth is implemented, and account creation is deferred until implementation begins.

### Auth0 milestone-1 setup checklist (completed 2026-10-17)

The steps below were executed manually in the Auth0 dashboard on 2026-10-17. Outcome record:

- Tenant issuer: `https://dev-158214i5w3prdebi.us.auth0.com/` (default tenant domain; no custom domain).
- API (resource server) created with identifier `https://promptmixer.vergotek.com`, RS256, and scopes `demo:pair` and `demo:read`.
- Tenant toggles enabled: **Resource Parameter Compatibility Profile** and **Include Issuer in Authorization Responses**.
- **CIMD registration enabled**; DCR left disabled.
- Presenter user created in the `Username-Password-Authentication` connection, and that connection was promoted to domain level.
- Public authorization-server metadata confirms `code_challenge_methods_supported` includes `S256`, `client_id_metadata_document_supported: true` (CIMD), `authorization_response_iss_parameter_supported: true`, and `token_endpoint_auth_methods_supported` including `private_key_jwt`.
- Recorded environment values for deployment: `DEMO_IDP_ISSUER=https://dev-158214i5w3prdebi.us.auth0.com/`, `DEMO_IDP_JWKS_URI=https://dev-158214i5w3prdebi.us.auth0.com/.well-known/jwks.json`, `DEMO_MCP_AUDIENCE=https://promptmixer.vergotek.com`.
- **Open account question:** the account currently displays a trial; whether the required toggles and CIMD remain available on the Free plan after the trial ends is unverified — re-check in the tenant before the first deployment rehearsal.
- Optional mTLS validation of ChatGPT's client certificate is **skipped for milestone 1** (unresolved question 4 resolved as skip; revisit for hardening later).

Original checklist (kept for reference — all steps completed):

1. Create a free Auth0 account and tenant (B2C; no credit card required). The default `<tenant>.<region>.auth0.com` domain is sufficient for milestone 1; no custom domain is planned (Free includes one custom domain but requires credit-card verification).
2. Dashboard → **Settings → Advanced → Settings**: enable **Resource Parameter Compatibility Profile** (access tokens scoped to our API via the `resource` parameter) and **Include Issuer in Authorization Responses** (RFC 9207 `iss`; with it, ChatGPT uses the stable redirect URI `https://chatgpt.com/connector_platform_oauth_redirect`).
3. Dashboard → **Applications → APIs → Create API**: name “Prompt Mixer Demo Bridge”, identifier exactly `https://promptmixer.vergotek.com` (the value `/mcp` advertises as `resource`; issued tokens must carry it as audience), signing algorithm RS256. Add scopes `demo:pair` (pairing/activation/unpairing) and `demo:read` (retrieval).
4. Dashboard → **Authentication**: choose the presenter sign-in method (database connection or a social connection such as Google), then promote that connection to domain-level so third-party clients like ChatGPT can use it — for example `auth0 api patch connections/<connection-id> --data '{"is_domain_connection": true}'` with the Auth0 CLI.
5. Create the presenter user under the chosen connection.
6. Verify client registration: fetch `https://<tenant-domain>/.well-known/oauth-authorization-server` and confirm it advertises `code_challenge_methods_supported` including `S256` and either `client_id_metadata_document_supported: true` (CIMD, preferred) or a `registration_endpoint` (DCR fallback). Record the exact `issuer` value.
7. Record the app-side environment values for later deployment: `DEMO_IDP_ISSUER=https://<tenant-domain>/`, `DEMO_IDP_JWKS_URI=https://<tenant-domain>/.well-known/jwks.json`, `DEMO_MCP_AUDIENCE=https://promptmixer.vergotek.com`.

Settings that must be verified on the available (Free) plan before relying on them:

- Both tenant toggles in step 2 exist on Free (the Auth0 quickstart documents them without a plan gate — verify in the actual tenant).
- The authorization-server metadata in step 6 advertises CIMD or DCR on Free.
- “Secure Agentic AI workflows” is listed on the Free plan (auth0.com/pricing); confirm this flow needs nothing from the paid “Auth0 for AI Agents” add-on, which covers Token Vault and CIBA — features this design does not use.
- Free-plan log retention is one day — acceptable, since OAuth troubleshooting can also use MCP Inspector client-side.

### Unresolved questions

1. **Authorization server (decided and configured).** Auth0 Free is selected for milestone 1, and the tenant was configured manually on 2026-10-17 per the checklist above: toggles verified present, CIMD metadata confirmed, presenter user created, connection promoted to domain level, and the `DEMO_IDP_*`/`DEMO_MCP_AUDIENCE` values recorded. One remaining account question: the account shows a trial, so Free-plan availability of these settings after the trial ends is unverified — confirm before the deployment rehearsal.
2. Presenter account capability: custom MCP server connections require a ChatGPT plan/surface that offers them, and workspace policies may restrict connectors. Verify on the presenter's own account before implementation.
3. **Resolved:** demo-session creation requires the env-configured `DEMO_PRESENTER_KEY`; public visitors cannot create or claim sessions, and an unconfigured key disables the feature entirely.
4. Optional mTLS hardening: validate ChatGPT's OpenAI-managed client certificate at Nginx for `/mcp` (trust the published OpenAI CA chain, SAN `mtls.prod.connectors.openai.com`). Adopt or skip, considering certificate-rotation upkeep.
5. Concrete TTLs and limits (session 24 h, code 5 min, 5 attempts, management-endpoint and per-identity MCP rates) are proposed defaults pending review.
6. Whether the browser capture credential persists across reloads (localStorage) or is memory-only. The presenter key itself is never persisted.
7. Bluehost mechanics for creating the narrowly scoped MySQL account (cPanel prefixes and allowed-host patterns), and confirmation that short-lived per-write connections remain within hosted-MySQL limits.

### Smallest implementation sequence (fixtures first)

1. **Milestone 1 — authenticated MCP connection with synthetic fixture data only (implemented locally, 2026-10-17).** The Auth0 tenant is configured; `/mcp` and the protected-resource metadata are implemented with the official SDK; injectable Bearer verification checks signature, issuer, audience, expiry, and scopes; all seven tools run against the in-memory fixture store with the fixture pairing code from `DEMO_FIXTURE_PAIRING_CODE`. No database migration, no capture routes, no public-app changes. Fixture-only tests pass (`npm test`). Remaining verification: MCP Inspector, then connect as a custom MCP server in the presenter's ChatGPT account and rehearse link → pair → “Let's go live” → fixture retrieval → “Let's take it offline”. **No database migration or real conversation capture begins until this milestone works in ChatGPT.**
2. Migration file plus the scoped MySQL account, applied by an administrator on Bluehost.
3. `demo-store.mjs` (MySQL + in-memory fixture), presenter-key-gated session/run/revoke/cancel routes, the optional `demo` field on the two AI endpoints, and the browser Demo sharing toggle. Fixture tests only.
4. Pairing-code persistence with attempt limits, binding states (`paired`/`live`/`offline`), and cancellation statuses (`success`/`superseded`/`canceled`), with fixture tests.
5. Retrieval wired to real captured data with binding enforcement and log-hygiene tests.
6. Browser pairing-code display, pairing-state view, expiry, and English/Japanese strings, with UI-harness tests.
7. Nginx wiring, DEPLOY.md updates, MCP Inspector check, and the ChatGPT pairing rehearsal during a deployment window.

## Iteration 12 verification

- Verify milestone 1 first: the authenticated MCP connection (linking, profile tool, fixture pairing, activation, fixture retrieval, revocation) works in MCP Inspector and then in the presenter's ChatGPT account with synthetic data only, before any migration or capture work exists. (Local fixture tests covering challenge behavior, scopes, annotations, pairing lifecycle, isolation, expiry, revocation, and log hygiene pass; the Inspector and ChatGPT rehearsal steps remain open deployment checks.)
- Verify all existing tests pass unchanged with demo sharing absent, and no `demo_%` write occurs by default.
- Verify demo-session creation requires the presenter key: wrong/missing keys are rejected and attempt-limited, an unconfigured key disables creation, and the key never appears in logs or page persistence.
- Verify capture ordering and fidelity across multi-card runs and multi-turn follow-up chains, including retries, failures, and cancellation, using the in-memory store and stubbed OpenAI fetch.
- Verify cancellation honesty: rows completed before a cancel notice keep `success`, later completions are `superseded`, never-completed rows of a canceled run report `canceled`, a missing notice leaves completed rows `success`, and retrieval returns statuses verbatim.
- Verify capture failure is non-fatal, sets `demoRecorded: false`, and emits a structured event without content.
- Verify pairing-code single use, expiry, attempt lockout, newer-code voiding, hash-only storage, and that anonymous or identity-only calls cannot pair.
- Verify authenticated-but-unpaired or not-live calls receive a pairing-required tool result, while missing, invalid, or expired tokens receive a `401` OAuth challenge.
- Verify tool annotations: retrieval tools are read-only; pairing, activation, and unpairing are state-changing; the profile tool carries `_meta["openai/profile"]: true` and returns a stable opaque ID.
- Verify the control phrases end to end: “Let's go live” pairs when needed then activates, retrieval works only while `live`, “Let's take it offline” revokes server-side, and confirmations come only from server tool results.
- Verify every MCP tool enforces the identity's session binding, foreign IDs return not-found, no global-latest path exists, and expiry/revocation/unpair terminate access.
- Verify tool results carry exact ordered prompts and answers as untrusted structured data with the untrusted-data notice in server instructions and tool descriptions.
- Verify operational-log fixtures exclude prompts, answers, code plaintext, credentials, tokens, connection strings, and client IPs via marker strings.
- Verify the migration creates only `demo_%` objects and a narrowly scoped account, and rollback drops only those objects.
- Run `npm test` and `git diff --check` with fixtures only: no API key, no real MySQL, no identity-provider network access. Live MCP Inspector and ChatGPT pairing rehearsal remain deployment checks.
