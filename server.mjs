import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import mysql from 'mysql2/promise';
import { RequestLimits } from './limits.mjs';
import { normalizeLocale, serverErrorMessage } from './i18n.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pdfFonts = require('pdfmake/build/vfs_fonts.js');
const port = Number(process.env.PORT || 8081);
const host = process.env.HOST || '127.0.0.1';
const model = process.env.OPENAI_MODEL || 'gpt-5-mini';

function sendError(res, status, errorCode, locale = 'en', extraHeaders = {}) {
  send(res, status, { errorCode, error: serverErrorMessage(locale, errorCode) }, extraHeaders);
}

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
  ['/comparison.mjs', ['comparison.mjs', 'text/javascript; charset=utf-8']],
  ['/i18n.mjs', ['i18n.mjs', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/pdfmake.min.js', ['node_modules/pdfmake/build/pdfmake.min.js', 'text/javascript; charset=utf-8']],
  ['/fonts/NotoSansJP-Regular.otf', ['assets/fonts/NotoSansJP-Regular.otf', 'font/otf']],
  ['/fonts/OFL.txt', ['assets/fonts/OFL.txt', 'text/plain; charset=utf-8']],
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

function logIncompleteOpenAIResponse(response, data) {
  const outputItemTypes = Array.isArray(data?.output)
    ? data.output.map(item => item?.type).filter(Boolean)
    : [];

  console.error('OpenAI response did not produce usable text output.', {
    id: data?.id ?? null,
    xRequestId: response.headers.get('x-request-id') ?? null,
    http_status: response.status,
    response_status: data?.status ?? null,
    incomplete_details: data?.incomplete_details ?? null,
    error: data?.error ?? null,
    usage: data?.usage ?? null,
    output_item_types: outputItemTypes,
  });
}

async function generate(req, res) {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    sendError(res, 415, 'unsupported_media_type');
    return;
  }

  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 12000) {
      sendError(res, 413, 'request_too_large');
      return;
    }
  }

  let prompt;
  let locale = 'en';
  try {
    const payload = JSON.parse(body);
    prompt = payload.prompt;
    locale = normalizeLocale(payload.locale);
  } catch {
    sendError(res, 400, 'invalid_json');
    return;
  }
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 6000) {
    sendError(res, 400, 'invalid_prompt', locale);
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    sendError(res, 503, 'ai_not_configured', locale);
    return;
  }

  // Nginx appends the actual client address to this header. The app only listens
  // on loopback, so external clients cannot bypass the proxy or choose its final IP.
  const forwarded = req.headers['x-forwarded-for'];
  const ip = typeof forwarded === 'string' ? forwarded.split(',').at(-1).trim() : req.socket.remoteAddress;
  try {
    const blocked = getLimits().reserve(ip);
    if (blocked) {
      sendError(res, blocked.status, blocked.errorCode, locale, { 'Retry-After': String(blocked.retryAfter) });
      return;
    }
  } catch (error) {
    console.error('Could not persist AI request limit:', error.name);
    sendError(res, 503, 'rate_limit_unavailable', locale);
    return;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        input: prompt,
        max_output_tokens: 3000,
        reasoning: { effort: 'low' },
        store: false,
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) {
      console.error(`OpenAI request failed: HTTP ${response.status}`);
      sendError(res, response.status === 429 ? 429 : 502, response.status === 429 ? 'upstream_busy' : 'upstream_unavailable', locale);
      return;
    }
    const data = await response.json();
    const output = data.output?.flatMap(item => item.content || [])
      .filter(item => item.type === 'output_text')
      .map(item => item.text).join('\n').trim();

    if (!output || data.status === 'incomplete') {
      logIncompleteOpenAIResponse(response, data);
    }

    if (!output) {
      sendError(res, 502, 'empty_response', locale);
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
    sendError(res, 502, 'upstream_unavailable', locale);
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
  if (path === '/vfs_fonts.js' && req.method === 'GET') {
    const content = `pdfMake.addVirtualFileSystem(${JSON.stringify(pdfFonts)});`;
    res.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    res.end(content);
    return;
  }
  if (req.method !== 'GET' || !assets.has(path)) {
    sendError(res, 404, 'not_found');
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
    sendError(res, 500, 'page_load_failed');
  }
});

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  server.listen(port, host, () => console.log(`Prompt Mixer listening on http://${host}:${port}`));
}
