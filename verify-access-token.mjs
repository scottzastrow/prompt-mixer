/*
 * Project: Prompt Mixer
 * Author: Scott Zastrow
 * Course: SEIS 606 — University of St. Thomas
 * Description: Bearer access-token verification for the demo-context MCP bridge, built on the maintained jose library. Verifies RS256 signatures against the identity provider's JWKS — with bounded cache lifetime, unknown-key refresh cooldown, concurrent-fetch deduplication, and fetch timeout — then checks issuer, audience, expiry, subject, and scopes. Never logs token material.
 * Copyright (c) 2026 Scott Zastrow
 * SPDX-License-Identifier: MIT
 */

import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';

const BEARER_PATTERN = /^bearer ([A-Za-z0-9\-._~+/]+=*)$/i;
const DEFAULT_CLOCK_TOLERANCE_SECONDS = 30;
const DEFAULT_JWKS_TIMEOUT_MS = 5000;
const DEFAULT_JWKS_COOLDOWN_MS = 30_000; // at most one unknown-key-triggered refetch per window
const DEFAULT_JWKS_CACHE_MAX_AGE_MS = 600_000; // cached keys are revalidated after ten minutes

// Error codes map onto RFC 6750 WWW-Authenticate parameters. Messages are safe
// to return to the client and to log; they never contain token material.
export class TokenError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TokenError';
    this.code = code; // 'missing_token' | 'invalid_token'
  }
}

// The signing keys could not be fetched or parsed at all — a server-side
// condition, answered with 503 rather than an OAuth challenge.
export class KeysUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'KeysUnavailableError';
  }
}

// Maps jose failures onto the two public error categories without leaking
// token contents. error.claim identifies which JWT claim failed validation.
function mapVerifyError(error) {
  switch (error?.code) {
    case 'ERR_JWT_EXPIRED':
      return new TokenError('invalid_token', 'The access token has expired');
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
      return new TokenError('invalid_token', 'The access token signature is invalid');
    case 'ERR_JWKS_NO_MATCHING_KEY':
      return new TokenError('invalid_token', 'The access token references an unknown signing key');
    case 'ERR_JOSE_ALG_NOT_ALLOWED':
      return new TokenError('invalid_token', 'The access token uses an unsupported signature algorithm');
    case 'ERR_JWS_INVALID':
    case 'ERR_JWT_INVALID':
      return new TokenError('invalid_token', 'The access token is malformed');
    case 'ERR_JWT_CLAIM_VALIDATION_FAILED':
      if (error.claim === 'iss') return new TokenError('invalid_token', 'The access token issuer is not trusted');
      if (error.claim === 'aud') return new TokenError('invalid_token', 'The access token was not issued for this resource');
      if (error.claim === 'nbf') return new TokenError('invalid_token', 'The access token is not yet valid');
      return new TokenError('invalid_token', 'The access token claims are invalid');
    case 'ERR_JWKS_TIMEOUT':
    case 'ERR_JWKS_INVALID':
    case 'ERR_JWKS_MULTIPLE_MATCHING_KEYS':
    case 'ERR_JOSE_GENERIC': // JWKS fetch returned non-200 or unparseable content
      return new KeysUnavailableError('Token verification keys are unavailable');
    default:
      // Network-level fetch failures arrive as TypeError from undici.
      return error instanceof TypeError
        ? new KeysUnavailableError('Token verification keys are unavailable')
        : new TokenError('invalid_token', 'The access token could not be verified');
  }
}

// Creates a verifier bound to one issuer/audience pair. jwksFetch and now are
// injectable so tests can use locally minted keys and controlled time without
// identity-provider network access.
export function createAccessTokenVerifier({
  issuer,
  audience,
  jwksUri,
  jwksFetch,
  now = Date.now,
  clockToleranceSeconds = DEFAULT_CLOCK_TOLERANCE_SECONDS,
  jwksTimeoutMs = DEFAULT_JWKS_TIMEOUT_MS,
  jwksCooldownMs = DEFAULT_JWKS_COOLDOWN_MS,
  jwksCacheMaxAgeMs = DEFAULT_JWKS_CACHE_MAX_AGE_MS,
}) {
  if (typeof issuer !== 'string' || !issuer) throw new RangeError('issuer is required');
  if (typeof audience !== 'string' || !audience) throw new RangeError('audience is required');
  if (typeof jwksUri !== 'string' || !jwksUri) throw new RangeError('jwksUri is required');

  // createRemoteJWKSet supplies the caching policy: keys are refetched when the
  // cache exceeds jwksCacheMaxAgeMs, an unknown kid triggers a refetch at most
  // once per jwksCooldownMs window, concurrent verifications share one
  // in-flight fetch, and each fetch aborts after jwksTimeoutMs.
  const keySet = createRemoteJWKSet(new URL(jwksUri), {
    timeoutDuration: jwksTimeoutMs,
    cooldownDuration: jwksCooldownMs,
    cacheMaxAge: jwksCacheMaxAgeMs,
    headers: { Accept: 'application/json' },
    ...(jwksFetch ? { [customFetch]: jwksFetch } : {}),
  });

  // Resolves to an MCP AuthInfo-shaped object on success; throws TokenError on
  // any authentication failure and KeysUnavailableError when the provider's
  // keys cannot be loaded, so the caller can answer 503 instead of a challenge.
  return async function verifyAccessToken(authorizationHeader) {
    if (typeof authorizationHeader !== 'string') {
      throw new TokenError('missing_token', 'No access token was provided');
    }
    const match = BEARER_PATTERN.exec(authorizationHeader.trim());
    if (!match) {
      throw new TokenError('missing_token', 'A Bearer access token is required');
    }
    const token = match[1];
    let payload;
    try {
      ({ payload } = await jwtVerify(token, keySet, {
        issuer,
        audience,
        algorithms: ['RS256'],
        clockTolerance: clockToleranceSeconds,
        currentDate: new Date(now()),
      }));
    } catch (error) {
      throw mapVerifyError(error);
    }
    if (typeof payload.exp !== 'number') {
      throw new TokenError('invalid_token', 'The access token has no expiry');
    }
    if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
      throw new TokenError('invalid_token', 'The access token has no subject');
    }
    const scopes = typeof payload.scope === 'string'
      ? payload.scope.split(' ').filter(Boolean)
      : [];
    return {
      token,
      clientId: payload.sub,
      scopes,
      expiresAt: payload.exp,
      resource: new URL(audience),
      extra: { iss: payload.iss, sub: payload.sub },
    };
  };
}
