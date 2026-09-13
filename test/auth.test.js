import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearTokens, getToken, loadTokens, saveTokens, startLogin, waitForLogin } from '../src/grok/auth.js';

const NOW = Date.parse('2026-09-13T12:00:00Z');
const secondsFromNow = (s) => Math.floor(NOW / 1000) + s;
const b64url = (text) => Buffer.from(text).toString('base64url');
const jwt = (payload) => `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify(payload))}.sig`;
const tempTokenFile = async () => join(await mkdtemp(join(tmpdir(), 'grokport-')), 'auth.json');

function fakeFetch(reply) {
  const requests = [];
  async function fetch(url, init = {}) {
    const request = {
      url: new URL(url),
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    const { status = 200, json } = reply(request, requests.length);
    return new Response(JSON.stringify(json), { status });
  }
  return { fetch, requests };
}

const noNetwork = async () => {
  throw new Error('unexpected network call');
};
const noSleep = async () => {};

test('builds a browser sign-in link that only this run can complete', () => {
  const login = startLogin();
  const url = new URL(login.url);

  assert.equal(url.origin + url.pathname, 'https://cursor.com/loginDeepControl');
  assert.equal(url.searchParams.get('uuid'), login.uuid);
  assert.equal(url.searchParams.get('mode'), 'login');
  assert.equal(url.searchParams.get('redirectTarget'), 'cli');
  assert.equal(
    url.searchParams.get('challenge'),
    createHash('sha256').update(login.verifier).digest('base64url'),
  );
  assert.notEqual(startLogin().verifier, login.verifier);
});

test('waits for the browser sign-in to finish', async () => {
  const login = startLogin();
  const server = fakeFetch((request, n) =>
    n < 3
      ? { status: 404, json: {} }
      : { json: { accessToken: 'access-1', refreshToken: 'refresh-1', authId: 'auth0|user_1' } },
  );

  const tokens = await waitForLogin(login, { fetch: server.fetch, sleep: noSleep });

  assert.deepEqual(tokens, { accessToken: 'access-1', refreshToken: 'refresh-1' });
  const poll = server.requests.at(-1).url;
  assert.equal(poll.origin + poll.pathname, 'https://api2.cursor.sh/auth/poll');
  assert.deepEqual([poll.searchParams.get('uuid'), poll.searchParams.get('verifier')], [login.uuid, login.verifier]);
});

test('gives up on a sign-in that never finishes', async () => {
  const server = fakeFetch(() => ({ status: 404, json: {} }));
  await assert.rejects(waitForLogin(startLogin(), { fetch: server.fetch, sleep: noSleep, attempts: 5 }), {
    code: 'login-timeout',
  });
  assert.equal(server.requests.length, 5);
});

test('gives a person about ten minutes to approve the sign-in before giving up', async () => {
  let waitedMs = 0;
  const server = fakeFetch(() => ({ status: 404, json: {} }));
  const sleep = async (ms) => {
    waitedMs += ms;
  };

  await assert.rejects(waitForLogin(startLogin(), { fetch: server.fetch, sleep }), { code: 'login-timeout' });

  assert.ok(waitedMs >= 9 * 60_000 && waitedMs <= 15 * 60_000, `waited ${waitedMs / 1000}s`);
});

test('remembers the sign-in between runs', async () => {
  const file = await tempTokenFile();
  await saveTokens({ accessToken: 'a', refreshToken: 'r' }, { file });

  assert.deepEqual(await loadTokens({ file }), { accessToken: 'a', refreshToken: 'r' });
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test('has no token before signing in', async () => {
  assert.equal(await getToken({ file: await tempTokenFile(), fetch: noNetwork, now: NOW }), null);
});

test('uses a saved token that is still fresh', async () => {
  const file = await tempTokenFile();
  const access = jwt({ sub: 'user_1', exp: secondsFromNow(3600) });
  await saveTokens({ accessToken: access, refreshToken: 'r' }, { file });

  assert.equal(await getToken({ file, fetch: noNetwork, now: NOW }), access);
});

test('refreshes a token that is about to expire', async () => {
  const file = await tempTokenFile();
  const fresh = jwt({ sub: 'user_1', exp: secondsFromNow(86400) });
  await saveTokens({ accessToken: jwt({ sub: 'user_1', exp: secondsFromNow(60) }), refreshToken: 'refresh-1' }, { file });
  const server = fakeFetch(() => ({ json: { access_token: fresh, refresh_token: 'refresh-2', shouldLogout: false } }));

  assert.equal(await getToken({ file, fetch: server.fetch, now: NOW }), fresh);
  assert.deepEqual(
    server.requests.map((r) => [r.method, r.url.href, r.body]),
    [
      [
        'POST',
        'https://api2.cursor.sh/oauth/token',
        { client_id: 'KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB', grant_type: 'refresh_token', refresh_token: 'refresh-1' },
      ],
    ],
  );
  assert.deepEqual(await loadTokens({ file }), { accessToken: fresh, refreshToken: 'refresh-2' });
});

test('keeps the refresh token when the server does not rotate it', async () => {
  const file = await tempTokenFile();
  const fresh = jwt({ sub: 'user_1', exp: secondsFromNow(86400) });
  await saveTokens({ accessToken: jwt({ exp: secondsFromNow(-10) }), refreshToken: 'refresh-1' }, { file });
  const server = fakeFetch(() => ({ json: { access_token: fresh } }));

  await getToken({ file, fetch: server.fetch, now: NOW });

  assert.deepEqual(await loadTokens({ file }), { accessToken: fresh, refreshToken: 'refresh-1' });
});

test('forgets a sign-in the server has revoked', async () => {
  const file = await tempTokenFile();
  await saveTokens({ accessToken: jwt({ exp: secondsFromNow(-10) }), refreshToken: 'refresh-1' }, { file });
  const server = fakeFetch(() => ({ json: { shouldLogout: true } }));

  assert.equal(await getToken({ file, fetch: server.fetch, now: NOW }), null);
  assert.equal(await loadTokens({ file }), null);
});

test('keeps the sign-in when the refresh service is down', async () => {
  const file = await tempTokenFile();
  const saved = { accessToken: jwt({ exp: secondsFromNow(-10) }), refreshToken: 'refresh-1' };
  await saveTokens(saved, { file });
  const server = fakeFetch(() => ({ status: 503, json: {} }));

  await assert.rejects(getToken({ file, fetch: server.fetch, now: NOW }), { code: 'api' });
  assert.deepEqual(await loadTokens({ file }), saved);
});

test('reports being offline while refreshing, and keeps the sign-in', async () => {
  const file = await tempTokenFile();
  const saved = { accessToken: jwt({ exp: secondsFromNow(-10) }), refreshToken: 'refresh-1' };
  await saveTokens(saved, { file });
  const offline = async () => {
    throw new TypeError('fetch failed');
  };

  await assert.rejects(getToken({ file, fetch: offline, now: NOW }), { code: 'offline' });
  assert.deepEqual(await loadTokens({ file }), saved);
});

test('keeps the sign-in when refreshing is rate limited', async () => {
  const file = await tempTokenFile();
  const saved = { accessToken: jwt({ exp: secondsFromNow(-10) }), refreshToken: 'refresh-1' };
  await saveTokens(saved, { file });
  const server = fakeFetch(() => ({ status: 429, json: { error: 'rate_limited' } }));

  await assert.rejects(getToken({ file, fetch: server.fetch, now: NOW }), { code: 'api' });
  assert.deepEqual(await loadTokens({ file }), saved);
});

test('forgets a sign-in the server rejects', async () => {
  const file = await tempTokenFile();
  await saveTokens({ accessToken: jwt({ exp: secondsFromNow(-10) }), refreshToken: 'refresh-1' }, { file });
  const server = fakeFetch(() => ({ status: 401, json: { error: 'invalid_grant' } }));

  assert.equal(await getToken({ file, fetch: server.fetch, now: NOW }), null);
  assert.equal(await loadTokens({ file }), null);
});

test('signs out', async () => {
  const file = await tempTokenFile();
  await saveTokens({ accessToken: 'a', refreshToken: 'r' }, { file });

  await clearTokens({ file });

  assert.equal(await loadTokens({ file }), null);
});
