import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { API_URL } from './endpoints.js';
import { GrokError } from './errors.js';

// Grok Bot accounts live on Cursor's auth. This is Cursor's standard browser sign-in for CLIs:
// the person approves in their browser, we poll for the result. Nothing is scraped or reused.
const WEBSITE = 'https://cursor.com';
const BACKEND = API_URL;
const CLIENT_ID = 'KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB';
const TOKEN_FILE = join(homedir(), '.grokport', 'auth.json');
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Starts a sign-in. Open `url` in a browser, then pass the result to waitForLogin. */
export function startLogin() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const uuid = randomUUID();
  const params = new URLSearchParams({ challenge, uuid, mode: 'login', redirectTarget: 'cli' });
  return { url: `${WEBSITE}/loginDeepControl?${params}`, uuid, verifier };
}

/**
 * Polls until the sign-in is approved in the browser: every second at first, easing off to every
 * five seconds, and giving up after about 12 minutes (finding the right tab can take a while).
 */
export async function waitForLogin(
  { uuid, verifier },
  { fetch = globalThis.fetch, sleep = delay, attempts = 150 } = {},
) {
  const pollUrl = `${BACKEND}/auth/poll?${new URLSearchParams({ uuid, verifier })}`;
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(pollUrl).catch(() => null);
    if (res?.ok) {
      const { accessToken, refreshToken } = await res.json().catch(() => ({}));
      if (accessToken && refreshToken) return { accessToken, refreshToken };
    }
    await sleep(Math.min(1000 * 1.2 ** i, 5000));
  }
  throw new GrokError('login-timeout', 'Sign-in timed out. Run the command again to retry.');
}

export async function saveTokens({ accessToken, refreshToken }, { file = TOKEN_FILE } = {}) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify({ accessToken, refreshToken }, null, 2)}\n`, { mode: 0o600 });
  await chmod(file, 0o600); // writeFile only applies `mode` when it creates the file
}

export async function loadTokens({ file = TOKEN_FILE } = {}) {
  try {
    const { accessToken, refreshToken } = JSON.parse(await readFile(file, 'utf8'));
    return accessToken && refreshToken ? { accessToken, refreshToken } : null;
  } catch {
    return null;
  }
}

export async function clearTokens({ file = TOKEN_FILE } = {}) {
  await rm(file, { force: true });
}

/** A usable access token (refreshed when close to expiry), or null when not signed in. */
export async function getToken({ fetch = globalThis.fetch, file = TOKEN_FILE, now = Date.now() } = {}) {
  const tokens = await loadTokens({ file });
  if (!tokens) return null;
  if (expiresAt(tokens.accessToken) - now > REFRESH_MARGIN_MS) return tokens.accessToken;

  let res;
  try {
    res = await fetch(`${BACKEND}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: tokens.refreshToken }),
    });
  } catch (cause) {
    throw new GrokError('offline', "Couldn't reach Grok Bot to refresh your sign-in. Check your internet connection.", {
      cause,
    });
  }

  const data = await res.json().catch(() => ({}));
  // Only forget the sign-in when the server says it's no longer valid, never on outages or rate limits.
  if (data.shouldLogout || [400, 401, 403].includes(res.status)) {
    await clearTokens({ file });
    return null;
  }
  if (!res.ok || !data.access_token) {
    throw new GrokError('api', "Grok Bot's sign-in service is having trouble. Try again in a minute.");
  }

  const refreshed = { accessToken: data.access_token, refreshToken: data.refresh_token ?? tokens.refreshToken };
  await saveTokens(refreshed, { file });
  return refreshed.accessToken;
}

function expiresAt(jwt) {
  try {
    const { exp } = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
    return typeof exp === 'number' ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}
