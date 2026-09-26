# Prompt Mixer — online iteration

## Objective

Make the effect of prompt context visible in both the assembled instructions and the AI response they produce.

## Behavior

The raw prompt is required. Context, Role, and Constraints are optional and included only when their checkboxes are selected and their fields are nonempty. Show Mix displays the assembled text; Copy copies it. Generate Response sends the current assembled text to the server and displays an AI answer. Changing any input clears the old answer so it cannot be confused with the current mix.

## Constraints

- No database or user account in this iteration.
- OpenAI requests happen on the server. The browser never receives the API key.
- The initial deployment is protected by HTTPS and Nginx basic authentication to prevent anonymous API spending.
- The app runs on a private local port behind Nginx, using systemd on an existing or dedicated Ubuntu host.
- No prompt or response history is saved by the app. OpenAI data handling follows the API platform's current policies.

## Verification

1. Raw alone produces a prompt and AI output.
2. Each optional checkbox changes the assembled prompt and the text sent for generation.
3. Blank optional fields are omitted, and an empty raw field is rejected.
4. Copy copies exactly what Show Mix displays.
5. Loading or editing the page does not expose an API key in HTML or JavaScript.
6. An unavailable API returns a visible error without losing the inputs.
7. HTTPS, authentication, local-only app port, and a live response work on the production hostname.

## Immediate tasks

1. Build the server endpoint and connect Generate Response.
2. Verify prompt assembly, server validation, and API response handling.
3. Provision DNS, service environment, Nginx authentication, and TLS.
4. Test the live site, then record deployment and usage behavior.
