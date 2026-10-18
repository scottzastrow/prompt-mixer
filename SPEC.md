# Prompt Mixer — cumulative response comparison

## Objective

Make the effect of prompt context visible in both the assembled instructions and the AI responses they produce.

## Behavior

The raw prompt is required. Context, Role, and Constraints are optional and are included only when their checkboxes are selected and their fields are nonempty. The combined prompt updates live as the user types or changes selections. Keep the button label **Generate Response**.

Provide English and Japanese interface languages. Choose the initial language from the browser: a valid saved selection (`en` or `ja`) takes priority; otherwise inspect `navigator.languages` in preference order, using `navigator.language` as a fallback when the list is unavailable or empty. Match preferences case-insensitively: `en` and `en-*` select English and `ja` and `ja-*` select Japanese; skip unsupported languages and default to English when no supported preference exists. Unavailable browser language information or localStorage must not break initialization. Persist explicit dropdown selections locally, but never store an automatically detected default as an explicit user choice. Put an accessible, compact language dropdown in the header immediately after Clear, with keyboard and visual order Presets → Clear → Language. Keep this arrangement usable on narrow screens. Translate all interface labels, help text, placeholders, presets, comparison card titles, loading/success/error and validation messages, tooltips, accessibility labels, answer expansion controls, and PDF headings. Keep the product name Prompt Mixer unchanged and set the document language to `en` or `ja`.

Changing language must preserve all user-entered text and checkbox selections, cancel an active comparison, clear its results, and restore the live preview without making an AI request. Clear resets form data but keeps the selected language. Selecting a preset explicitly fills its prompts in the selected language. Do not translate or overwrite user-entered text when switching languages.

Every submitted comparison prompt, including Raw only, must include the selected response-language instruction. Show that instruction in the live preview and each card's exact submitted prompt; store the same exact submitted prompt in the database log and include it in the PDF. Responses must follow the selected language while preserving quoted text and code when appropriate. Localize server errors using stable error codes and translation mappings, preserving HTTP statuses, rate limits, diagnostics, and credential protection.

One click generates a comparison run in this order: the raw prompt alone, then one additional response for each selected, nonempty optional field cumulatively added in the order Context, Role, Constraints. Skip unchecked or empty optional fields. With all optional fields selected and nonempty, show four response cards. Each card has a clear label, its exact submitted prompt, a compact answer preview, and accessible Show more / Show less controls.

Each response card has its own loading, success, or error state. A failed request does not clear successful answers or prevent later requests from running, except that a rate-limit response stops the remaining requests. Each prompt is a separate server request and counts against the existing server rate limits. Prevent duplicate runs while generation is active.

Each response card has a compact download icon button in its upper-right corner, using the supplied download SVG, with accessible label and tooltip “Download response as PDF”. Keep it disabled until that card succeeds. Clicking it downloads a real PDF directly, with no print dialog and no additional AI request or database write. The PDF contains the Prompt Mixer title, localized card label and headings, exact submitted prompt, and complete AI response. Export all text regardless of the exact-prompt disclosure or answer expansion state, without changing either state. Preserve paragraphs and line breaks, wrap long text, support Unicode, and paginate long content without clipping. Use the existing Japanese font support for Japanese headings and card titles as well as prompt and response text. Use a maintained PDF library served locally under the existing Content Security Policy and give each file a meaningful filesystem-safe name.

Editing a prompt field, changing a checkbox or preset, or clicking Clear cancels the current run and clears its results. Responses from a canceled or superseded run must never appear. Preserve checkbox behavior, the live combined-prompt preview, server-side credentials, safe OpenAI diagnostics, rate limits, and non-fatal database logging for each successful response.

Treat Combined prompt as a pre-generation preview. Keep it visible when validation prevents generation. Hide the entire preview section as soon as a valid Generate Response run starts, because each response card displays its exact prompt. Restore the live preview when any prompt input or checkbox changes, a preset is selected, or Clear is clicked. Place the existing compact, left-aligned Generate Response button after Combined prompt and before Response comparison, outside the preview section. Keep this order in the DOM so keyboard navigation matches the visual order, and keep the button visible while the preview is hidden. In each card, keep the title and collapsible Exact prompt before a Response section; put loading and error messages directly below the Response heading and show successful answer text in that same section.

Each successful AI response is also recorded in the experiment log with its timestamp, model, assembled prompt, and response. Logging is secondary to response generation: a database failure must not prevent a successful AI response from being displayed to the user.

Every AI generation or follow-up request also produces structured operational logs: one complete JSON object per line, written to stdout for informational events and to stderr for warnings and errors. Each record carries a UTC ISO 8601 timestamp with milliseconds, a level (`info`, `warn`, or `error`), a stable event name, a server-generated request ID for request-scoped events, and explicitly selected context metadata. Each request logs a start event and exactly one terminal outcome event — validation rejection, rate limiting, conversation limits, missing configuration, upstream failure, empty or invalid AI response, request interruption, or success — with duration in milliseconds and safe metadata such as model, locale, and follow-up turn when available. A client disconnect or request-body read failure still produces exactly one correlated terminal event, never triggers a paid call, and does not write a response to a destroyed connection. Database-write failures are separate structured events carrying the same request ID, and the experiment log write itself remains unchanged. Operational logs must never contain prompts, answers, conversation history, API keys, passwords, connection strings, or client IP addresses. Collection uses the existing systemd journal; this iteration adds no other database, log file writer, browser telemetry, public log endpoint, or hash chain.

Observed issue: some OpenAI responses can return an incomplete payload with a successful HTTP status but no `output_text` content. In those cases, the server must emit a structured diagnostic event containing only allowlisted metadata: the OpenAI response ID, the upstream `x-request-id` header value, HTTP status, response status, incomplete reason, token usage including reasoning-token counts, and output item types. It must not log raw upstream error objects or messages, credentials, prompts, or response contents in these diagnostics.

Confirmed live diagnosis: `response_status=incomplete`, `incomplete_details.reason=max_output_tokens`, and all 768 output tokens were consumed by reasoning with no visible answer. The server request must therefore use `reasoning: { effort: "low" }` and increase `max_output_tokens` from 800 to 3000 while preserving the existing user-selected prompt constraints and without adding automatic retries.

## Constraints

- OpenAI requests happen on the server. The browser never receives the API key.
- Successful AI responses are written to the existing experiment log with timestamp, model, exact prompt, and response. Logging is secondary to response generation: a database failure must not prevent an answer from being displayed. This iteration does not add a history UI or user accounts.
- The initial deployment is protected by HTTPS and Nginx basic authentication to prevent anonymous API spending.
- A public classroom release allows the page to load without a password. Only Generate Response is rate limited on the server: 100 accepted requests per minute per IP, 200 per UTC day per IP, and 1,000 per UTC day for the site. Valid generation attempts count even if OpenAI fails. The live preview remains available when a limit is reached.
- The private rate state survives service restarts. The server returns 429 and a clear retry message before contacting OpenAI when a limit is reached. A missing or unwritable state store blocks generation.
- Operational logs are structured JSON lines collected by the existing systemd journal. They exclude prompts, answers, conversation history, API keys, passwords, connection strings, and client IP addresses; no additional log storage, telemetry, or public log endpoint is introduced.
- The app runs on a private local port behind Nginx, using systemd on an existing or dedicated Ubuntu host.
- OpenAI data handling follows the API platform's current policies.

## Verification

1. Raw alone produces one card with the raw prompt and its AI output.
2. With Context, Role, and Constraints selected and nonempty, one click submits exactly four prompts in cumulative order and shows four cards.
3. Unchecked or empty optional fields are skipped; remaining fields retain Context, Role, Constraints order.
4. Every card displays its exact submitted prompt and has accessible Show more / Show less answer controls.
5. A failed request leaves successful cards intact and later requests proceed; a 429 stops all later requests.
6. Duplicate generation is prevented. Editing fields, changing presets, and Clear cancel pending requests and prevent stale results from appearing.
7. The combined-prompt preview stays visible before generation and when validation fails, hides after a valid run starts, and returns on input/checkbox changes, preset selection, or Clear; preview updates do not make AI requests.
8. Generate Response is compact, left-aligned, labeled unchanged, outside the preview, and positioned between the preview and Response comparison in both visual and DOM order; hiding the preview does not hide the button.
9. Each card orders its title and collapsible exact prompt above the Response section, where loading, errors, and successful answers appear.
10. Each comparison request counts separately against the existing server limits; blocked requests return 429 without contacting OpenAI.
11. Loading or editing the page does not expose an API key; server credentials, diagnostics, and successful-response database logging remain intact.
12. An unavailable API returns a visible per-card error without losing inputs or other successful answers.
13. Every card has the specified accessible download control; it remains disabled while waiting or after failure and is enabled only after success.
14. Downloading exports the full prompt and response, including Unicode, paragraphs, and text hidden by collapsed UI, while preserving the onscreen expansion state; it does not issue an API request or database write.
15. Long PDF content wraps and paginates, filenames are filesystem-safe, and all PDF assets load locally without weakening CSP.
16. English and Japanese are selectable in the header after Clear, in the same visual and keyboard order, including at narrow widths; the selection persists locally and updates the document language.
17. Switching language preserves typed values and checkbox states, cancels pending work, clears comparison results, restores the live preview, and makes no AI request; Clear preserves the selected language.
18. Each explicitly selected preset populates localized text; user-entered text is never translated by switching languages.
19. All client-visible interface text is localized. Every card's exact prompt, preview, log entry, and PDF contain the same selected-language instruction, including Raw only; successful Japanese PDFs use the Japanese font for headings and titles too.
20. Server failures return stable error codes with English/Japanese translations while preserving HTTP statuses, rate limits, safe diagnostics, and server-only credentials.
21. With no valid saved choice, the initial language follows `navigator.languages` preference order with a `navigator.language` fallback, mapping `en`/`en-*` to English and `ja`/`ja-*` to Japanese case-insensitively, skipping unsupported tags, and defaulting to English; a valid saved choice wins, an invalid saved value is ignored, unavailable localStorage or browser language data does not break loading, and an auto-detected default is never persisted as an explicit choice.
22. Each AI request emits one structured start event and exactly one structured terminal outcome event sharing a server-generated request ID, with millisecond duration and safe metadata (model, locale, follow-up turn when available); validation, rate-limit, and conversation-limit rejections are logged before any paid call; a request-body read failure or client disconnect produces exactly one correlated terminal event without a paid call or a response written to a destroyed connection.
23. Every log line is one complete JSON object with a millisecond UTC timestamp, level, and stable event name; OpenAI diagnostics use only the explicit allowlist, and no record contains prompts, answers, conversation history, credentials, connection strings, raw upstream error objects, or client IP addresses.
24. Database-write failures appear as separate structured events tied to the request ID while user-facing behavior, API response contracts, and rate limits stay unchanged; logs are collected through the existing systemd journal.

## Immediate tasks

1. Build sequential cumulative prompt generation and independent response cards.
2. Verify cancellation, per-card failures, rate-limit stopping, and accessible previews.
3. Add per-card direct PDF downloads and verify full-content export without additional generation requests.
4. Run the automated suite and manually verify the responsive comparison workflow and PDF downloads.
5. Implement and verify English/Japanese selection, language-preserving form behavior, localized presets and errors, per-prompt language instructions, and Japanese PDF headings.
6. Implement browser-based default language selection with saved-choice priority, `navigator.languages` preference detection, English fallback, safe initialization, and regression tests.
## Homework 4: Live prompt mixing

Classroom testing showed that the checkboxes and Show Mix button were confusing. Presets filled optional fields without selecting them, leaving users unsure which text would be sent.

Required behavior:
- Remove the Show Mix button.
- Update the combined prompt immediately when text or selections change.
- Typing nonblank text in an optional field automatically checks it.
- Selecting a preset fills the fields and checks each nonblank optional field.
- Unchecking a field excludes its text without deleting it.
- An unchecked field stays excluded until the user checks it or edits its text.
- Blank optional fields are omitted from the combined prompt.
- Generate Response sends the same assembled text shown in the live preview before a valid run starts; the preview hides during comparison and each card shows its exact prompt.
- Raw prompt remains required for generation.
- Editing the prompt or selections clears any previous AI response.
- Clear resets all fields, checkboxes, preset selection, and outputs.
- Updating the preview never makes an AI request.

Verification:
1. Typing updates the combined prompt without an extra button click.
2. Each preset immediately displays all its populated fields in the mix.
3. Unchecking and rechecking a field removes and restores its text.
4. Editing an unchecked optional field selects it again.
5. Clearing an optional field removes it from the mix.
6. Clear returns the interface to its empty starting state.
7. Generate Response uses the same prompt shown in the preview.
## Optional AI follow-up

- Each generated response may include one optional follow-up offer.
- Return the answer and follow-up as structured data rather than detecting phrases in the answer.
- A follow-up contains an offer for the user and a next prompt. When no follow-up is useful, return null.
- Display the offer with Yes and No buttons beneath its response.
- Yes sends a new AI request using the original exact prompt, that card’s answer, and the follow-up prompt. Display the result beneath the original response.
- No dismisses the offer without making an AI request.
- Allow one follow-up per comparison card. Follow-up answers do not produce additional offers.
- Prevent duplicate submissions and preserve the original answer if the follow-up fails.
- Follow-up requests use the existing token limits, rate limits, and database logging.
- Localize offers, buttons, loading states, and errors for English and Japanese.
- Field changes, preset selection, Clear, and language changes cancel pending follow-ups and discard stale results.
- PDF downloads include any completed follow-up with its exact prompt and full answer, without another AI request.
- Verify the flow locally with simulated responses, then perform a live check on Lightsail.
## Continuous AI follow-ups

This iteration replaces the one-follow-up-per-card restriction.

- Each answer may offer one useful next step with localized Yes/No controls.
- Follow-up offers may propose only actions this text-only app can perform: explain, draft text or code, show examples, predict code output, or provide instructions. Offers must never promise to execute code, browse websites, access files, or perform external actions. Predicted code output must be described honestly as expected output, not as an execution result. Each offer still proposes exactly one concrete action the user can accept or decline with Yes or No.
- Yes makes one new request and appends the answer beneath the previous turn in the same card.
- Each new answer may include another structured follow-up offer. Never detect offers by matching phrases.
- No dismisses that offer without making a request.
- Continue only when the user selects Yes. Never automatically send requests.
- Preserve the original exact prompt and the ordered conversation history for each card. Keep cards independent.
- Apply server-enforced request size and conversation limits. If the conversation exceeds those limits, show a localized message asking the user to start a new prompt; do not silently truncate history.
- Count every accepted follow-up against the existing rate limits and token budget, and log each successful interaction.
- Prevent duplicate requests per turn. Preserve completed answers on failure and allow a deliberate retry without duplicating successful turns.
- Cancel pending work and ignore stale results after field changes, checkbox changes, preset selection, Clear, or language changes.
- Give long follow-up answers accessible Show more / Show less controls.
- PDF downloads include the original prompt and all completed follow-up prompts and answers in order, without another AI request.
- Test multiple turns, No, no offer, errors, retries, limits, cancellation, English/Japanese, and PDF export with simulated responses before live verification.

## Paired demo-context bridge (milestone 1 implemented locally — synthetic fixtures only)

Status 2026-10-17: milestone 1 is implemented — an authenticated Streamable HTTP `/mcp` endpoint with protected-resource metadata and the seven planned tools backed by an in-memory synthetic fixture store, disabled by default and gated on `DEMO_IDP_ISSUER`, `DEMO_IDP_JWKS_URI`, and `DEMO_MCP_AUDIENCE`. The Auth0 tenant was configured manually (see below). Database migration, real conversation capture, and the browser demo-sharing control remain unimplemented, and no plugin has been created; MCP Inspector and ChatGPT rehearsal are open deployment checks.

### Objective

Let a presenter deliberately share one Prompt Mixer browser session with their own ChatGPT plugin connection, so the assistant can retrieve that session's exact submitted prompts and completed answers in order. Public behavior stays unchanged: demo sharing is disabled by default, requires explicit presenter action, and no visitor can claim another person's session.

### Verified MCP authentication basis

Checked 2026-10-17 against OpenAI's current plugin documentation (developers.openai.com/plugins/build/auth, /plugins/deploy, /plugins/deploy/connect-chatgpt):

- ChatGPT connects to remote MCP servers over the Streamable HTTP transport at a public HTTPS endpoint. Secure MCP Tunnel exists for private testing but does not satisfy public-endpoint requirements.
- The only supported user-authentication mechanism is OAuth 2.1 authorization-code flow with PKCE (S256) against an authorization server that publishes discovery metadata and echoes the `resource` parameter into issued tokens. ChatGPT attaches the access token as `Authorization: Bearer` on each MCP request. Client registration uses Client ID Metadata Documents (preferred), dynamic client registration, or a predefined OAuth client.
- ChatGPT cannot present static bearer tokens, API keys, custom HTTP headers, customer-provided client certificates, or machine-to-machine credentials (client credentials, service accounts, JWT bearer). A "pairing code as bearer token" design is therefore not viable; pairing must bind an OAuth identity.
- ChatGPT presents an OpenAI-managed client certificate (SAN `mtls.prod.connectors.openai.com`, chaining to OpenAI's published CAs); validating it is optional transport-layer hardening that authenticates ChatGPT as the client, not the user.
- Per-tool `securitySchemes` (`oauth2` with scopes, or `noauth`) plus `WWW-Authenticate` challenges (including `_meta["mcp/www_authenticate"]` on tool errors) drive ChatGPT's account-linking UI.
- An authenticated, read-only profile tool marked `_meta["openai/profile"]: true` is optional, not required — ChatGPT supports multiple connected accounts without one — but it is recommended so OpenAI can recognize the connected account consistently. This design includes one.

Consequence: an external OAuth 2.1 authorization server is required. Auth0 Free is selected for milestone 1; PLAN.md records the provider comparison (including corrected Stytch capabilities) and the setup checklist. The tenant was configured manually on 2026-10-17: issuer `https://dev-158214i5w3prdebi.us.auth0.com/`, audience `https://promptmixer.vergotek.com`, scopes `demo:pair`/`demo:read`, CIMD enabled (DCR disabled), both required tenant toggles on, presenter user created in a domain-promoted database connection, and public metadata confirming S256, CIMD, issuer identification, and `private_key_jwt`. Free-plan availability of these settings after the current trial ends is unverified. This project does not implement a custom OAuth server, static tokens, or header-based authentication, and an ordinary website-login integration alone does not satisfy MCP authorization.

### Behavior

**Capture (browser, presenter-enabled).** A Demo sharing control is off by default, and creating a demo session requires presenter authorization: the presenter enters an env-configured presenter key (`DEMO_PRESENTER_KEY`), verified server-side with a timing-safe comparison and strictly attempt-limited. When the key is not configured, demo-session creation is disabled entirely and the feature stays off. The key is entered at enable time, is never persisted by the page, and is never logged. Only then does enabling create one server-side demo session and return an opaque session identifier plus a separate write credential, which the browser sends with later generation and follow-up requests. A demo session is identified only by its server-generated identifier and credential — never by client IP address. While sharing is active, each successful comparison card and each accepted follow-up turn is recorded as structured demo history: session, run, card, and turn identifiers with per-scope sequence numbers, the exact submitted prompt, the completed answer, model, locale, and timestamps. Failed work leaves no content rows, and a retried failed turn updates its own pending row instead of duplicating it; canceled or superseded work is labeled honestly (see Cancellation honesty) rather than silently recorded or silently dropped. Disabling sharing revokes the session immediately. Capture is non-fatal: a demo-store failure never blocks or alters the AI response, a structured failure event is logged, and the JSON response carries a `demoRecorded` flag so the presenter can tell whether capture succeeded. Requests without demo metadata behave exactly as they do today.

**Pairing.** The presenter requests a pairing code from the page. The server generates an 8-character code from an unambiguous alphabet, grouped 4-4 for reading aloud, and stores only its SHA-256 hash. Codes expire after 5 minutes, are single-use, lock after 5 failed attempts, and are voided when a newer code is generated for the same session; per-session generation is capped. In ChatGPT, the presenter gives the plugin the code; the plugin calls the `pair_demo_session` tool with it. That tool requires an authenticated OAuth identity; on success the server binds the token's issuer and subject to the session and consumes the code. The code alone never grants access, and an OAuth identity alone never grants access — only the combination at pairing time creates the binding. An identity already bound to another active session must unpair first. The browser view shows the session's pairing state so the presenter can detect and revoke an unexpected binding.

A binding becomes retrievable only after explicit activation (state `live`). Two presenter control phrases drive the lifecycle, and tool descriptions state them so the assistant maps them reliably. “Let's go live” explicitly activates the authorized binding — pairing first with a presenter-supplied code when no binding exists — and the assistant confirms success only from the server's tool result, never from assumption. “Let's take it offline” revokes the binding server-side (state `offline`), and the assistant confirms only the server's result. Neither phrase starts background monitoring or polling, and neither erases content already retrieved into the ChatGPT conversation, which is outside the plugin's control.

Authentication and pairing are distinct states. Missing, invalid, or expired tokens receive a `401` OAuth challenge so ChatGPT shows its linking UI. Authenticated but unpaired (or paired-but-not-live) calls instead receive a pairing-required tool result explaining the next step — never another OAuth challenge, because the identity is already authenticated.

**Cancellation honesty.** Browser cancellation (edits, checkbox or preset changes, Clear, language changes, page close) aborts the browser's wait and hides stale results, but it does not guarantee server processing stops: an in-flight generation may still complete at OpenAI and may still be recorded. The demo bridge records what the server actually completes and labels it. When a run is canceled or superseded, the browser sends a best-effort cancellation notice (`POST /api/demo/cancel`, capture-credentialed, `keepalive` so it can fire during page close) identifying the run; the server marks that run canceled. Card and turn rows completed before the notice keep status `success`; rows completed afterward are recorded with status `superseded`; rows that never complete are reported as `canceled` at retrieval time. If the notice never arrives (for example a hard browser close), completed rows honestly remain `success`. Statuses describe what the server observed, not what the browser displayed, and retrieval returns them verbatim.

**Retrieval (MCP).** A Streamable HTTP endpoint at `/mcp` on the existing HTTPS host serves a small tool set. Retrieval tools are strictly read-only (`readOnlyHint: true`, `openWorldHint: false`, `destructiveHint: false`): `get_profile` (the recommended authenticated profile tool), `get_demo_session`, `list_demo_runs`, and `get_demo_run`. State-changing tools are annotated accordingly (`readOnlyHint: false`): `pair_demo_session`, `activate_demo_session`, and `unpair_demo_session`. Every tool except pairing resolves its session exclusively from the authenticated identity's stored binding, and retrieval requires the `live` state. Run and card identifiers are inert opaque IDs validated as belonging to the bound session; unknown or foreign IDs return the same not-found error. There is no endpoint or tool that returns a global "latest" or "most recent" conversation. Results deliver the exact prompts and completed answers in run/card/turn order as structured data framed as untrusted quoted content, with per-item statuses so canceled or superseded entries are identified honestly.

**Expiry, revocation, isolation.** Sessions expire after a fixed TTL (proposed default 24 hours) and can be revoked from the browser or unpaired from ChatGPT at any time; expired or revoked sessions deny all capture, pairing, and retrieval. Expired content is purged lazily on access paths, with a documented manual purge for administrators. Every query is scoped by the bound session, and foreign-key plus uniqueness constraints enforce isolation between concurrent sessions.

**Untrusted content.** Server `instructions` and every tool description state that returned prompts and answers are untrusted user data, never instructions to the consuming assistant. Results are returned as structured fields plus clearly delimited quoted text and never contain credentials, pairing codes, or tokens.

### Constraints

- Public behavior, API contracts, rate limits, CSP, localization, PDF export, experiment logging, and the operational-log shape remain unchanged when demo metadata is absent; all existing tests keep passing.
- Demo capture, pairing, and MCP retrieval are disabled by default and require explicit presenter action; no anonymous or unauthenticated path reaches any demo content. Demo-session creation additionally requires the env-configured presenter key, so public visitors cannot create or claim sessions. No app-level user accounts are added; identity lives at the external provider.
- Record identifiers (session/run/card/turn IDs) are inert: possessing an ID grants nothing without the identity binding.
- Database access uses a dedicated MySQL account with privileges limited to the `demo_%` tables in the existing database (SELECT/INSERT/UPDATE/DELETE on those tables only). Credentials remain server-side environment entries; the experiment-log account and `prompt_log` are untouched. No public database access and no arbitrary SQL tool is exposed; MCP tools run fixed, parameterized queries only.
- Demo history lives in new `demo_%` tables, separate from both the experiment log and operational logs.
- Operational logs gain only structured events for session lifecycle, pairing outcomes (with remaining-attempt counts, never code text), capture failures, and MCP tool outcomes. They never contain prompts, answers, pairing-code plaintext, capture credentials, access tokens, connection strings, or client IP addresses.
- MCP user authentication is OAuth 2.1 + PKCE through an external authorization server (Auth0 Free, selected and configured for milestone 1; tenant settings verified on the live tenant, with Free-plan availability after the trial unverified — see PLAN.md). The server verifies Bearer tokens — signature against the provider's published keys, issuer, audience, expiry, and scopes — and never mints its own tokens. Tool annotations reflect real behavior: only retrieval tools are marked read-only, while pairing, activation, and unpairing are marked state-changing. Authenticated-but-unpaired requests receive pairing-required results, not OAuth challenges.
- Local tests use fixtures only: stubbed OpenAI fetch, an in-memory demo store, and locally minted test tokens. No paid AI calls, no real MySQL, no identity-provider network access.

### Verification

1. With demo sharing off (the default), every existing behavior test passes unchanged and no `demo_%` write occurs.
2. Enabling sharing requires the presenter key: a wrong or missing key is rejected and attempt-limited, an unconfigured key disables creation entirely, and the key is never logged or persisted by the page.
3. Enabling sharing creates one session, returns an identifier and write credential, and captures each successful card and accepted follow-up turn in run/card/turn order with the exact prompts and completed answers; failed work records nothing; a retried failed turn keeps a single row.
4. Cancellation is honest: a cancel notice marks the run, rows completed before it keep `success`, rows completed after it are `superseded`, never-completed rows report `canceled`, a missing notice leaves completed rows `success`, and retrieval returns statuses verbatim.
5. A capture failure during live generation never blocks or alters the AI response; the structured failure event carries no content and the response's `demoRecorded` flag is false.
6. A visitor without the session's credential cannot write to, pair with, or read the presenter's session; session/run/card/turn IDs alone yield not-found everywhere.
7. Pairing codes are single-use, expire, lock after the failed-attempt cap, and are voided by a newer code; only hashes are stored; pairing requires a valid OAuth identity; anonymous requests receive an OAuth challenge, while authenticated-but-unpaired requests receive a pairing-required result, not another challenge.
8. “Let's go live” pairs when needed and then activates the binding, retrieval works only in the `live` state, and “Let's take it offline” revokes the binding server-side; confirmations come only from server tool results, and neither phrase starts background monitoring nor erases already-retrieved content.
9. Only retrieval tools carry read-only annotations; pairing, activation, and unpairing are marked state-changing; the profile tool is marked `_meta["openai/profile"]: true` and returns a stable opaque ID.
10. Every MCP retrieval enforces the identity's session binding; IDs from another session and any "latest conversation" request both fail; after expiry, revocation, or unpairing, retrieval returns an authentication or binding error.
11. MCP tool results contain the exact ordered prompts and answers as untrusted structured data, and server instructions and tool descriptions carry the untrusted-data notice.
12. Operational-log fixtures assert the absence of prompts, answers, code plaintext, credentials, tokens, connection strings, and client IPs via marker strings, matching the existing logging tests.
13. The migration creates only `demo_%` tables and a narrowly scoped account; rollback drops only those objects.
14. All tests run locally with fixtures and no paid AI calls, no real MySQL, and no identity-provider network access. The first milestone — an authenticated MCP connection serving synthetic fixture data — must work in ChatGPT before any database migration or real conversation capture begins.