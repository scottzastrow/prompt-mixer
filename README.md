# Prompt Mixer

Prompt Mixer lets you start with a raw prompt, toggle Context, Role, and Constraints, inspect the assembled prompt, and generate a real AI response. Change one input and generate again to see the effect. The app stores no accounts, prompts, or responses.

## Run locally

Requires Node.js 20 or newer and an OpenAI API key with API billing enabled. API usage is billed separately from ChatGPT.

In a PowerShell terminal in this repository:

```powershell
$env:OPENAI_API_KEY = 'your-key-here'
npm start
```

Open http://127.0.0.1:8081. Set `OPENAI_MODEL` to change the default `gpt-5-mini`. Remove the key from your shell when finished (`Remove-Item Env:OPENAI_API_KEY`). Never enter a key in browser code, Copilot Chat, screenshots, or Git. `python -m http.server` only serves the old static UI; it cannot generate AI responses.

Run `npm test` for a local server check with a simulated OpenAI response. A live AI smoke test requires the key and network access.

## Deployment

The deployment procedure for `promptmixer.vergotek.com` is in [DEPLOY.md](DEPLOY.md). Its initial public release requires HTTPS and access control at Nginx because anonymous calls would spend the owner's API credits. Keep the key in a private service environment file on the host.

## Scope

The original Homework 2 specification and mockup remain as submitted. [SPEC.md](SPEC.md) tracks the subsequent online iteration with AI output.
