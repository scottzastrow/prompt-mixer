# Prompt Mixer — online iteration

## Objective

Make the effect of prompt context visible in both the assembled instructions and the AI response they produce.

## Behavior

The raw prompt is required. Context, Role, and Constraints are optional and are included only when their checkboxes are selected and their fields are nonempty. The combined prompt updates live as the user types or changes selections, and that preview is the exact text sent by Generate Response.

Each successful AI response is also recorded in the experiment log with its timestamp, model, assembled prompt, and response. Logging is secondary to response generation: a database failure must not prevent a successful AI response from being displayed to the user.

## Constraints

- No database or user account in this iteration.
- OpenAI requests happen on the server. The browser never receives the API key.
- The initial deployment is protected by HTTPS and Nginx basic authentication to prevent anonymous API spending.
- A public classroom release allows the page to load without a password. Only Generate Response is rate limited on the server: 100 accepted requests per minute per IP, 200 per UTC day per IP, and 1,000 per UTC day for the site. Valid generation attempts count even if OpenAI fails. The live preview remains available when a limit is reached.
- The private rate state survives service restarts. The server returns 429 and a clear retry message before contacting OpenAI when a limit is reached. A missing or unwritable state store blocks generation.
- The app runs on a private local port behind Nginx, using systemd on an existing or dedicated Ubuntu host.
- No prompt or response history is saved by the app. OpenAI data handling follows the API platform's current policies.

## Verification

1. Raw alone produces a prompt and AI output.
2. Each optional checkbox changes the assembled prompt and the text sent for generation.
3. Blank optional fields are omitted, and an empty raw field is rejected.
4. The live preview reflects exactly the fields selected for generation and updates without an extra button click.
5. Loading or editing the page does not expose an API key in HTML or JavaScript.
6. An unavailable API returns a visible error without losing the inputs.
7. HTTPS, anonymous page access, local-only app port, and a live response work on the production hostname.
8. Limits distinguish client IPs through the trusted local Nginx proxy; blocked requests return 429 without contacting OpenAI.

## Immediate tasks

1. Build the server endpoint and connect Generate Response.
2. Verify prompt assembly, server validation, and API response handling.
3. Provision DNS, service environment, Nginx authentication, and TLS.
4. Test the live site, then record deployment and usage behavior.
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
- Generate Response sends exactly the displayed combined prompt.
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