# Prompt Mixer — cumulative response comparison

## Objective

Make the effect of prompt context visible in both the assembled instructions and the AI responses they produce.

## Behavior

The raw prompt is required. Context, Role, and Constraints are optional and are included only when their checkboxes are selected and their fields are nonempty. The combined prompt updates live as the user types or changes selections. Keep the button label **Generate Response**.

One click generates a comparison run in this order: the raw prompt alone, then one additional response for each selected, nonempty optional field cumulatively added in the order Context, Role, Constraints. Skip unchecked or empty optional fields. With all optional fields selected and nonempty, show four response cards. Each card has a clear label, its exact submitted prompt, a compact answer preview, and accessible Show more / Show less controls.

Each response card has its own loading, success, or error state. A failed request does not clear successful answers or prevent later requests from running, except that a rate-limit response stops the remaining requests. Each prompt is a separate server request and counts against the existing server rate limits. Prevent duplicate runs while generation is active.

Each response card has a compact download icon button in its upper-right corner, using the supplied download SVG, with accessible label and tooltip “Download response as PDF”. Keep it disabled until that card succeeds. Clicking it downloads a real PDF directly, with no print dialog and no additional AI request or database write. The PDF contains the Prompt Mixer title, card label, exact submitted prompt, and complete AI response. Export all text regardless of the exact-prompt disclosure or answer expansion state, without changing either state. Preserve paragraphs and line breaks, wrap long text, support Unicode, and paginate long content without clipping. Use a maintained PDF library served locally under the existing Content Security Policy and give each file a meaningful filesystem-safe name.

Editing a prompt field, changing a checkbox or preset, or clicking Clear cancels the current run and clears its results. Responses from a canceled or superseded run must never appear. Preserve checkbox behavior, the live combined-prompt preview, server-side credentials, safe OpenAI diagnostics, rate limits, and non-fatal database logging for each successful response.

Treat Combined prompt as a pre-generation preview. Keep it visible when validation prevents generation. Hide the entire preview section as soon as a valid Generate Response run starts, because each response card displays its exact prompt. Restore the live preview when any prompt input or checkbox changes, a preset is selected, or Clear is clicked. Place the existing compact, left-aligned Generate Response button after Combined prompt and before Response comparison, outside the preview section. Keep this order in the DOM so keyboard navigation matches the visual order, and keep the button visible while the preview is hidden. In each card, keep the title and collapsible Exact prompt before a Response section; put loading and error messages directly below the Response heading and show successful answer text in that same section.

Each successful AI response is also recorded in the experiment log with its timestamp, model, assembled prompt, and response. Logging is secondary to response generation: a database failure must not prevent a successful AI response from being displayed to the user.

Observed issue: some OpenAI responses can return an incomplete payload with a successful HTTP status but no `output_text` content. In those cases, the server must emit a diagnostic log containing only the OpenAI response ID, the `x-request-id` header value, HTTP status, `incomplete_details`, `error`, `usage`, and output item types. It must not log credentials, prompts, or response contents in these diagnostics.

Confirmed live diagnosis: `response_status=incomplete`, `incomplete_details.reason=max_output_tokens`, and all 768 output tokens were consumed by reasoning with no visible answer. The server request must therefore use `reasoning: { effort: "low" }` and increase `max_output_tokens` from 800 to 3000 while preserving the existing user-selected prompt constraints and without adding automatic retries.

## Constraints

- OpenAI requests happen on the server. The browser never receives the API key.
- Successful AI responses are written to the existing experiment log with timestamp, model, exact prompt, and response. Logging is secondary to response generation: a database failure must not prevent an answer from being displayed. This iteration does not add a history UI or user accounts.
- The initial deployment is protected by HTTPS and Nginx basic authentication to prevent anonymous API spending.
- A public classroom release allows the page to load without a password. Only Generate Response is rate limited on the server: 100 accepted requests per minute per IP, 200 per UTC day per IP, and 1,000 per UTC day for the site. Valid generation attempts count even if OpenAI fails. The live preview remains available when a limit is reached.
- The private rate state survives service restarts. The server returns 429 and a clear retry message before contacting OpenAI when a limit is reached. A missing or unwritable state store blocks generation.
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

## Immediate tasks

1. Build sequential cumulative prompt generation and independent response cards.
2. Verify cancellation, per-card failures, rate-limit stopping, and accessible previews.
3. Add per-card direct PDF downloads and verify full-content export without additional generation requests.
4. Run the automated suite and manually verify the responsive comparison workflow and PDF downloads.
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