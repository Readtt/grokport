import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getBot, getPreview } from '../src/grok/client.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

const RPC = 'https://api2.cursor.sh/aiserver.v1.GrokBotService/';
const ID = 'AbCdEfGhIjKlMnOpQrStU';
const OTHER_ID = 'zzzzzzzzzzzzzzzzzzzzz';
const SIGNED_URL =
  'https://grok-bot-marketplace-public-assets.s3.us-east-1.amazonaws.com/templates/5549-8216?X-Amz-Signature=abc';

/** Stand-in for Grok Bot's servers: answers known URLs and records every request. */
function fakeServer(routes) {
  const requests = [];
  async function fetch(url, init = {}) {
    const request = {
      url,
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    const route = routes[url];
    if (!route) throw new TypeError('fetch failed');
    const reply = typeof route === 'function' ? route(request) : route;
    const body = 'text' in reply ? reply.text : JSON.stringify(reply.json);
    return new Response(body, { status: reply.status ?? 200 });
  }
  return { fetch, requests };
}

const listing = (shareId, slug) => ({
  slug,
  name: 'Study Buddy',
  description: 'Keeps your coursework on track.',
  defaultAvatar: { shape: 'blob', color: 'blue' },
  category: 'Education',
  createdAtMs: '1788428936125',
  updatedAtMs: '1788560500855',
  shareId,
  creator: { name: 'Ada', profilePhotoUrl: 'https://example.com/ada.png', handles: { x: 'ada' } },
  categories: ['Education'],
});

const page = (listings, nextPageToken = '') => ({
  json: { featuredListings: [], listings, nextPageToken, allCategoriesOrder: ['Education'] },
});

const connectError = (status, code, error, title, detail) => ({
  status,
  json: {
    code,
    message: 'Error',
    details: [
      {
        type: 'aiserver.v1.ErrorDetails',
        debug: { error, details: { title, detail, isRetryable: false }, isExpected: true },
        value: 'CCc',
      },
    ],
  },
});

const notFound = connectError(404, 'not_found', 'ERROR_NOT_FOUND', 'Resource not found.', 'Grok Bot template not found.');
const unauthenticated = connectError(
  401,
  'unauthenticated',
  'ERROR_NOT_LOGGED_IN',
  'Authentication error',
  'If you are logged in, try logging out and back in.',
);
const noSignInExpected = async () => assert.fail('marketplace bots must not need a sign-in');

test('fetches the public preview of a bot', async () => {
  const server = fakeServer({ [`${RPC}GetPublicGrokBotTemplate`]: { json: load('template.json') } });

  const preview = await getPreview(ID, { fetch: server.fetch });

  assert.deepEqual(preview, load('template.json'));
  assert.deepEqual(
    server.requests.map((r) => [r.method, r.body, r.headers['content-type']]),
    [['POST', { shareId: ID }, 'application/json']],
  );
});

test('reports a bot that does not exist', async () => {
  const server = fakeServer({ [`${RPC}GetPublicGrokBotTemplate`]: notFound });
  await assert.rejects(getPreview(ID, { fetch: server.fetch }), { code: 'not-found' });
});

test('reports being offline', async () => {
  const server = fakeServer({});
  await assert.rejects(getPreview(ID, { fetch: server.fetch }), { code: 'offline' });
});

test('downloads marketplace bots without signing in', async () => {
  const server = fakeServer({
    [`${RPC}ListPublicGrokBotMarketplaceListings`]: page([listing(OTHER_ID, 'other'), listing(ID, 'study-buddy')]),
    [`${RPC}GetPublicGrokBotMarketplaceListing`]: ({ body }) =>
      body.slug === 'study-buddy' ? { json: { listing: listing(ID, 'study-buddy'), templateGetUrl: SIGNED_URL } } : notFound,
    [SIGNED_URL]: { json: load('recipe.json') },
  });

  const bot = await getBot(load('template.json'), { fetch: server.fetch, getToken: noSignInExpected });

  assert.equal(bot.name, 'Study Buddy');
  assert.equal(bot.skills.length, 2);
  assert.ok(server.requests.every((r) => !('authorization' in r.headers)));
});

test('looks through every marketplace page', async () => {
  const server = fakeServer({
    [`${RPC}ListPublicGrokBotMarketplaceListings`]: ({ body }) =>
      body.pageToken === 'page-2' ? page([listing(ID, 'study-buddy')]) : page([listing(OTHER_ID, 'other')], 'page-2'),
    [`${RPC}GetPublicGrokBotMarketplaceListing`]: {
      json: { listing: listing(ID, 'study-buddy'), templateGetUrl: SIGNED_URL },
    },
    [SIGNED_URL]: { json: load('recipe.json') },
  });

  const bot = await getBot(load('template.json'), { fetch: server.fetch, getToken: noSignInExpected });

  assert.equal(bot.id, ID);
});

test('asks for a sign-in when a private bot is fetched without a token', async () => {
  const server = fakeServer({ [`${RPC}ListPublicGrokBotMarketplaceListings`]: page([listing(OTHER_ID, 'other')]) });
  await assert.rejects(getBot(load('template.json'), { fetch: server.fetch, getToken: async () => null }), {
    code: 'login-required',
  });
});

test('downloads private bots with the signed-in token', async () => {
  const BLOB = 'https://templates.example.com/templates/AbCdEfGhIjKlMnOpQrStU_v3.json?sig=1';
  const server = fakeServer({
    [`${RPC}ListPublicGrokBotMarketplaceListings`]: page([listing(OTHER_ID, 'other')]),
    [`${RPC}GetGrokBotTemplateImportDetails`]: ({ headers, body }) =>
      headers.authorization === 'Bearer tok-123' && body.shareId === ID
        ? {
            json: {
              template: load('template.json').template,
              blobGetUrl: BLOB,
              expectedActiveVersion: 3,
              creatorDisplayName: 'Ada',
            },
          }
        : unauthenticated,
    [BLOB]: { json: load('recipe.json') },
  });

  const bot = await getBot(load('template.json'), { fetch: server.fetch, getToken: async () => 'tok-123' });

  assert.equal(bot.skills[1].slug, 'exam-prep-review');
});

test('asks to sign in again when the saved token is rejected', async () => {
  const server = fakeServer({
    [`${RPC}ListPublicGrokBotMarketplaceListings`]: page([]),
    [`${RPC}GetGrokBotTemplateImportDetails`]: unauthenticated,
  });
  await assert.rejects(getBot(load('template.json'), { fetch: server.fetch, getToken: async () => 'expired' }), {
    code: 'login-required',
  });
});

test('explains when Grok Bot will not share the bot with this account', async () => {
  const server = fakeServer({
    [`${RPC}ListPublicGrokBotMarketplaceListings`]: page([]),
    [`${RPC}GetGrokBotTemplateImportDetails`]: connectError(
      403,
      'permission_denied',
      'ERROR_UNAUTHORIZED',
      'Unauthorized',
      'You do not have access to this template.',
    ),
  });
  await assert.rejects(getBot(load('template.json'), { fetch: server.fetch, getToken: async () => 'tok' }), {
    code: 'access-denied',
  });
});

test('passes along unexpected server errors, without terminal control codes', async () => {
  const server = fakeServer({
    [`${RPC}GetPublicGrokBotTemplate`]: connectError(
      503,
      'unavailable',
      'ERROR_UNAVAILABLE',
      'Service unavailable',
      'Try again \x1b[31mlater.',
    ),
  });
  await assert.rejects(getPreview(ID, { fetch: server.fetch }), (error) => {
    assert.equal(error.code, 'api');
    assert.match(error.message, /Try again later\./);
    assert.doesNotMatch(error.message, /\x1b/);
    return true;
  });
});

test('says the Grok Bot API changed when a response is missing what grokport needs', async () => {
  const noTemplate = fakeServer({ [`${RPC}GetPublicGrokBotTemplate`]: { json: { ownerDisplayName: 'Ada' } } });
  await assert.rejects(getPreview(ID, { fetch: noTemplate.fetch }), { code: 'format' });

  const noMarketplaceUrl = fakeServer({
    [`${RPC}ListPublicGrokBotMarketplaceListings`]: page([listing(ID, 'study-buddy')]),
    [`${RPC}GetPublicGrokBotMarketplaceListing`]: { json: { listing: listing(ID, 'study-buddy') } },
  });
  await assert.rejects(getBot(load('template.json'), { fetch: noMarketplaceUrl.fetch }), { code: 'format' });

  const noBlobUrl = fakeServer({
    [`${RPC}ListPublicGrokBotMarketplaceListings`]: page([]),
    [`${RPC}GetGrokBotTemplateImportDetails`]: {
      json: { template: load('template.json').template, expectedActiveVersion: 3, creatorDisplayName: 'Ada' },
    },
  });
  await assert.rejects(getBot(load('template.json'), { fetch: noBlobUrl.fetch, getToken: async () => 'tok' }), {
    code: 'format',
  });
});

test('explains a failed recipe download', async () => {
  const server = fakeServer({
    [`${RPC}ListPublicGrokBotMarketplaceListings`]: page([listing(ID, 'study-buddy')]),
    [`${RPC}GetPublicGrokBotMarketplaceListing`]: {
      json: { listing: listing(ID, 'study-buddy'), templateGetUrl: SIGNED_URL },
    },
    [SIGNED_URL]: {
      status: 403,
      text: '<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>',
    },
  });
  await assert.rejects(getBot(load('template.json'), { fetch: server.fetch }), { code: 'download-failed' });
});
