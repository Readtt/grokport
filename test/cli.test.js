import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFixture } from './helpers.js';

// End-to-end: runs the real bin/grokport.js (not in a terminal) against a local stand-in for
// Grok Bot's API that serves the test fixtures, with a throwaway home folder.

const CLI = fileURLToPath(new URL('../bin/grokport.js', import.meta.url));
const SHARE_ID = 'AbCdEfGhIjKlMnOpQrStU';
const LINK = `https://x.ai/bot/${SHARE_ID}`;
const RPC = '/aiserver.v1.GrokBotService/';

const tempDir = () => mkdtemp(join(tmpdir(), 'grokport-cli-'));

const listing = {
  slug: 'study-buddy',
  name: 'Study Buddy',
  description: 'Keeps your coursework on track.',
  defaultAvatar: { shape: 'blob', color: 'blue' },
  category: 'Education',
  createdAtMs: '1788428936125',
  updatedAtMs: '1788560500855',
  shareId: SHARE_ID,
  creator: { name: 'Ada', profilePhotoUrl: 'https://example.com/ada.png', handles: { x: 'ada' } },
  categories: ['Education'],
};

/** Serves the Study Buddy fixtures like Grok Bot's API would, and records every request path. */
async function startFakeGrokBot({ inMarketplace = true } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    req.resume();
    const base = `http://127.0.0.1:${server.address().port}`;
    const routes = {
      [`${RPC}GetPublicGrokBotTemplate`]: () => [200, loadFixture('template.json')],
      [`${RPC}ListPublicGrokBotMarketplaceListings`]: () => [
        200,
        { featuredListings: [], listings: inMarketplace ? [listing] : [], nextPageToken: '', allCategoriesOrder: [] },
      ],
      [`${RPC}GetPublicGrokBotMarketplaceListing`]: () => [
        200,
        { listing, templateGetUrl: `${base}/templates/5549-8216?X-Amz-Signature=abc` },
      ],
      '/templates/5549-8216?X-Amz-Signature=abc': () => [200, loadFixture('recipe.json')],
    };
    const [status, json] = routes[req.url]?.() ?? [404, { code: 'not_found', message: 'Error' }];
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(json));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function runGrokport(args, { api, home, cwd }) {
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd,
    env: { ...process.env, HOME: home, USERPROFILE: home, GROKPORT_API_URL: api.url, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const code = await new Promise((resolve) => child.on('close', resolve));
  return { code, output };
}

async function withFakeGrokBot(options, run) {
  const api = await startFakeGrokBot(options);
  try {
    return await run(api, { home: await tempDir(), cwd: await tempDir() });
  } finally {
    await api.close();
  }
}

test('installs a marketplace bot into the chosen agents without asking anything', () =>
  withFakeGrokBot({}, async (api, { home, cwd }) => {
    const { code, output } = await runGrokport([LINK, '--to', 'claude,folder', '-y'], { api, home, cwd });

    assert.equal(code, 0, output);
    assert.ok(existsSync(join(home, '.claude', 'skills', 'study-buddy', 'SKILL.md')), output);
    assert.ok(existsSync(join(home, '.claude', 'agents', 'study-buddy.md')), output);
    assert.ok(existsSync(join(cwd, 'study-buddy', 'skills', 'weekly-plan.md')), output);
  }));

test('checks agent names before downloading anything', () =>
  withFakeGrokBot({}, async (api, dirs) => {
    const { code } = await runGrokport([LINK, '--to', 'vim', '-y'], { api, ...dirs });

    assert.equal(code, 1);
    assert.deepEqual(api.requests, []);
  }));

test('without a terminal, asks for --to up front instead of downloading first', () =>
  withFakeGrokBot({}, async (api, dirs) => {
    const { code, output } = await runGrokport([LINK], { api, ...dirs });

    assert.equal(code, 1);
    assert.deepEqual(api.requests, []);
    assert.match(output, /--to/);
  }));

test('never starts a browser sign-in without a terminal, and says how to sign in instead', () =>
  withFakeGrokBot({ inMarketplace: false }, async (api, dirs) => {
    const { code, output } = await runGrokport([LINK, '--to', 'folder', '-y'], { api, ...dirs });

    assert.equal(code, 1);
    assert.match(output, /grokport login/);
    assert.ok(!api.requests.some((path) => path.startsWith('/auth/')), api.requests.join('\n'));
  }));

test('says why Grok Bot could not be reached', async () => {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));

  const api = { url: `http://127.0.0.1:${port}` };
  const { code, output } = await runGrokport([LINK, '--to', 'folder', '-y'], {
    api,
    home: await tempDir(),
    cwd: await tempDir(),
  });

  assert.equal(code, 1, output);
  assert.match(output, /Couldn't reach Grok Bot/);
  assert.ok(output.includes(`Details: connect ECONNREFUSED 127.0.0.1:${port}`), output);
});

test('exits with an error when one of the chosen agents could not be installed', () =>
  withFakeGrokBot({}, async (api, { home, cwd }) => {
    const ownSkill = join(home, '.claude', 'skills', 'study-buddy');
    await mkdir(ownSkill, { recursive: true });
    await writeFile(join(ownSkill, 'SKILL.md'), '---\nname: study-buddy\n---\nMine.\n');

    const { code, output } = await runGrokport([LINK, '--to', 'claude,folder', '-y'], { api, home, cwd });

    assert.equal(code, 1, output);
    assert.ok(existsSync(join(cwd, 'study-buddy', 'SKILL.md')), output);
  }));

test('removes an installed bot from every agent, but not a copy saved in a folder', () =>
  withFakeGrokBot({}, async (api, { home, cwd }) => {
    const installed = await runGrokport([LINK, '--to', 'claude,codex,folder', '-y'], { api, home, cwd });
    assert.equal(installed.code, 0, installed.output);
    const requestsBeforeRemove = api.requests.length;

    const { code, output } = await runGrokport(['remove', 'study-buddy', '-y'], { api, home, cwd });

    assert.equal(code, 0, output);
    for (const path of [
      join(home, '.claude', 'skills', 'study-buddy'),
      join(home, '.agents', 'skills', 'study-buddy'),
      join(home, '.claude', 'agents', 'study-buddy.md'),
    ]) {
      assert.equal(existsSync(path), false, `${path}\n${output}`);
    }
    assert.ok(existsSync(join(cwd, 'study-buddy', 'SKILL.md')), output);
    assert.equal(api.requests.length, requestsBeforeRemove, 'remove never talks to Grok Bot');
  }));

test('without a terminal, remove deletes nothing unless you name the bot and add -y', () =>
  withFakeGrokBot({}, async (api, { home, cwd }) => {
    const installed = await runGrokport([LINK, '--to', 'claude', '-y'], { api, home, cwd });
    assert.equal(installed.code, 0, installed.output);

    for (const args of [['remove', 'study-buddy'], ['remove', '-y'], ['remove']]) {
      const { code, output } = await runGrokport(args, { api, home, cwd });
      assert.equal(code, 1, `${args.join(' ')}\n${output}`);
      assert.match(output, /-y/, args.join(' '));
      assert.doesNotMatch(output, /--to/, `remove has no --to, so it must not suggest it\n${output}`);
    }
    assert.ok(existsSync(join(home, '.claude', 'skills', 'study-buddy', 'SKILL.md')));
  }));
