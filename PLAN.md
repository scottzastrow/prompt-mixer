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
