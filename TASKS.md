# Prompt Mixer — tasks

Tasks are grouped by a verifiable result. Status reflects the September 25 deployment handoff and the draft AI branch; a completed code task does not imply the feature is live.

## Prompt construction

- [x] T1: Build Raw, Context, Role, and Constraints inputs with optional checkboxes. Verify the Raw prompt is always included.
- [x] T2: Build Show Mix and Copy. Verify unchecked and blank optional fields do not appear in the assembled prompt.
- [x] T3: Commit the static app and Homework 2 files to the public repository.

## AI response

- [x] T4: Add a server-side generation endpoint with input validation and a private OpenAI API key reference.
- [x] T5: Connect Generate Response to the current mix and display loading, result, and error states.
- [x] T6: Run local server checks with a simulated AI response and verify public files contain no real key.
- [ ] T7: Run a live API request using the separate Prompt Mixer project key; verify the returned answer corresponds to the checked fields.

## Online deployment

- [x] T8: Create the Bluehost A record and deploy the original static app to the existing Lightsail host. Confirm HTTP loads and EDI still runs.
- [ ] T9: Retry Certbot when public DNS resolves; verify a valid HTTPS certificate and HTTP redirect.
- [ ] T10: Install Node.js, deploy the reviewed AI branch to `/opt/promptmixer`, and start a separate `promptmixer` systemd service on `127.0.0.1:8081`.
- [ ] T11: Store the project key outside Git in a protected service environment file. Add Nginx basic authentication to the HTTPS app location, then proxy to the service.
- [ ] T12: Verify Show Mix, Copy, real AI generation, access control, logs, and the unaffected EDI site. Record any changes needed for the next iteration.

## Homework 3 reflection — written by Scott

After implementation, write a short account **in your own words** of what you learned, how long the work took (especially implementation), and the challenges encountered. The professor suggested less than a page and does not want AI to write this reflection. Concrete points you might choose to discuss: correcting the checkbox behavior, the difference between Copilot building an app and an app calling AI, separating API keys, and DNS propagation delaying HTTPS. Use only points that match your own experience.
