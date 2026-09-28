import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import mysql from 'mysql2/promise';
import { RequestLimits } from './limits.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8081);
const host = process.env.HOST || '127.0.0.1';
const model = process.env.OPENAI_MODEL || 'gpt-5-mini';

async function logInteraction(prompt, response) {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    await connection.execute(
      'INSERT INTO prompt_log (model, prompt, response) VALUES (?, ?, ?)',
      [model, prompt, response]
    );
  } finally {
    await connection.end();
  }
}

let limits;
function getLimits() {
  const path = process.env.LIMIT_STATE_FILE || join(root, '.limit-state.json');
  if (!limits || limits.path !== path) {
    const setting = (name, fallback) => {
      const value = Number(process.env[name] || fallback);
      if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}`);
      return value;
    };
    limits = new RequestLimits(path, {
      perMinute: setting('LIMIT_PER_MINUTE', 100),
      perDay: setting('LIMIT_PER_IP_DAY', 200),
      sitePerDay: setting('LIMIT_SITE_DAY', 1000),
    });
  }
  return limits;
}
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/script.js', ['script.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

function send(res, status, data, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(JSON.stringify(data));
}

async function generate(req, res) {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    send(res, 415, { error: 'Send a JSON request.' });
    return;
  }

  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 12000) {
      send(res, 413, { error: 'Prompt is too long.' });
      return;
    }
  }

  let prompt;
  try {
    prompt = JSON.parse(body).prompt;
  } catch {
    send(res, 400, { error: 'Invalid JSON.' });
    return;
  }
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 6000) {
    send(res, 400, { error: 'Enter a prompt of up to 6,000 characters.' });
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    send(res, 503, { error: 'AI is not configured on this server.' });
    return;
  }

  // Nginx appends the actual client address to this header. The app only listens
  // on loopback, so external clients cannot bypass the proxy or choose its final IP.
  const forwarded = req.headers['x-forwarded-for'];
  const ip = typeof forwarded === 'string' ? forwarded.split(',').at(-1).trim() : req.socket.remoteAddress;
  try {
    const blocked = getLimits().reserve(ip);
    if (blocked) {
      send(res, blocked.status, { error: blocked.error }, { 'Retry-After': String(blocked.retryAfter) });
      return;
    }
  } catch (error) {
    console.error('Could not persist AI request limit:', error.name);
    send(res, 503, { error: 'AI responses are temporarily unavailable. Please try again later.' });
    return;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model, input: prompt, max_output_tokens: 800, store: false }),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) {
      console.error(`OpenAI request failed: HTTP ${response.status}`);
      send(res, response.status === 429 ? 429 : 502, {
        error: response.status === 429 ? 'AI is busy or usage is limited. Try again later.' : 'AI response unavailable. Please try again.',
      });
      return;
    }
    const data = await response.json();
    const output = data.output?.flatMap(item => item.content || [])
      .filter(item => item.type === 'output_text')
      .map(item => item.text).join('\n').trim();
    if (!output) {
      send(res, 502, { error: 'The AI returned no text. Please try again.' });
      return;
    }
    try {
      await logInteraction(prompt, output);
    } catch (error) {
      console.error('Could not log AI interaction:', error.name);
    }

    send(res, 200, { response: output });
  } catch (error) {
    console.error('OpenAI request failed:', error.name);
    send(res, 502, { error: 'AI response unavailable. Please try again.' });
  }
}

export const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/health' && req.method === 'GET') {
    send(res, 200, { status: 'ok' });
    return;
  }
  if (path === '/api/generate' && req.method === 'POST') {
    await generate(req, res);
    return;
  }
  if (req.method !== 'GET' || !assets.has(path)) {
    send(res, 404, { error: 'Not found.' });
    return;
  }
  const [filename, contentType] = assets.get(path);
  try {
    const content = await readFile(join(root, filename));
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    res.end(content);
  } catch {
    send(res, 500, { error: 'Could not load the page.' });
  }
});

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  server.listen(port, host, () => console.log(`Prompt Mixer listening on http://${host}:${port}`));
}
