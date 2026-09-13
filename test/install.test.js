import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { renderBundle } from '../src/bundle.js';
import { planInstall } from '../src/harnesses.js';
import { applyPlan } from '../src/install.js';
import { studyBuddy } from './helpers.js';

const tempDir = () => mkdtemp(join(tmpdir(), 'grokport-install-'));
const STUDY_BUDDY_URL = 'https://x.ai/bot/AbCdEfGhIjKlMnOpQrStU';
const bundleAt = (path, files = renderBundle(studyBuddy())) => ({
  kind: 'bundle',
  path,
  files,
  source: STUDY_BUDDY_URL,
  harnesses: ['claude'],
});
/** A different bot that happens to have the same name. */
const anotherStudyBuddy = () => ({
  ...studyBuddy(),
  id: 'ZZZZZZZZZZZZZZZZZZZZZ',
  url: 'https://x.ai/bot/ZZZZZZZZZZZZZZZZZZZZZ',
});

test('writes a new skill folder', async () => {
  const path = join(await tempDir(), 'skills', 'study-buddy');
  const files = renderBundle(studyBuddy());

  const [result] = await applyPlan([bundleAt(path, files)]);

  assert.equal(result.ok, true);
  for (const [relative, content] of Object.entries(files)) {
    assert.equal(await readFile(join(path, relative), 'utf8'), content, relative);
  }
});

test('replaces a folder it installed before, dropping playbooks the bot no longer has', async () => {
  const path = join(await tempDir(), 'study-buddy');
  await applyPlan([bundleAt(path)]);
  const updated = renderBundle(studyBuddy());
  delete updated['skills/exam-prep-review.md'];

  const [result] = await applyPlan([bundleAt(path, updated)]);

  assert.equal(result.ok, true);
  assert.equal(existsSync(join(path, 'skills', 'exam-prep-review.md')), false);
  assert.equal(existsSync(join(path, 'skills', 'weekly-plan.md')), true);
});

test('updating keeps files the user added to the skill folder', async () => {
  const path = join(await tempDir(), 'study-buddy');
  await applyPlan([bundleAt(path)]);
  await mkdir(join(path, '.git'));
  await writeFile(join(path, '.git', 'config'), '[core]\n');
  await writeFile(join(path, 'my-notes.md'), 'notes\n');
  await writeFile(join(path, 'skills', 'my-own-playbook.md'), 'mine\n');

  const [result] = await applyPlan([bundleAt(path)]);

  assert.equal(result.ok, true);
  assert.equal(await readFile(join(path, '.git', 'config'), 'utf8'), '[core]\n');
  assert.equal(await readFile(join(path, 'my-notes.md'), 'utf8'), 'notes\n');
  assert.equal(await readFile(join(path, 'skills', 'my-own-playbook.md'), 'utf8'), 'mine\n');
});

test("leaves alone a folder that grokport didn't create", async () => {
  const path = join(await tempDir(), 'study-buddy');
  await mkdir(path);
  await writeFile(join(path, 'SKILL.md'), '---\nname: study-buddy\n---\nMy own skill.\n');

  const [result] = await applyPlan([bundleAt(path)]);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'exists');
  assert.equal(await readFile(join(path, 'SKILL.md'), 'utf8'), '---\nname: study-buddy\n---\nMy own skill.\n');
});

test("won't write into a folder without grokport's note when one of the bot's files is already there", async () => {
  const path = join(await tempDir(), 'study-buddy');
  await mkdir(join(path, 'skills'), { recursive: true });
  await writeFile(join(path, 'skills', 'weekly-plan.md'), 'my own plan\n');

  const [result] = await applyPlan([bundleAt(path)]);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'exists');
  assert.equal(await readFile(join(path, 'skills', 'weekly-plan.md'), 'utf8'), 'my own plan\n');
  assert.equal(existsSync(join(path, 'SKILL.md')), false);
});

test("won't write through a link into a folder grokport didn't make", async () => {
  const dir = await tempDir();
  const project = join(dir, 'my-project');
  await mkdir(project);
  await writeFile(join(project, 'notes.md'), 'notes\n');
  const path = join(dir, 'skills', 'study-buddy');
  await mkdir(dirname(path), { recursive: true });
  await symlink(project, path, 'junction');

  const [result] = await applyPlan([bundleAt(path)]);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'exists');
  assert.equal(existsSync(join(project, 'SKILL.md')), false);
});

test("won't replace a different bot that has the same name", async () => {
  const home = await tempDir();
  await applyPlan(planInstall(studyBuddy(), ['claude'], { home, cwd: home }));

  const results = await applyPlan(planInstall(anotherStudyBuddy(), ['claude'], { home, cwd: home }));

  assert.deepEqual(
    results.map((r) => [r.item.kind, r.ok]),
    [
      ['bundle', false],
      ['file', false],
    ],
  );
  assert.equal(results[0].error.code, 'exists');
  const skill = await readFile(join(home, '.claude', 'skills', 'study-buddy', 'SKILL.md'), 'utf8');
  const agent = await readFile(join(home, '.claude', 'agents', 'study-buddy.md'), 'utf8');
  assert.ok(skill.includes(STUDY_BUDDY_URL));
  assert.ok(agent.includes(STUDY_BUDDY_URL));
});

test("won't replace a persona agent that belongs to a different bot", async () => {
  const home = await tempDir();
  await applyPlan(planInstall(studyBuddy(), ['opencode'], { home, cwd: home }));
  const agentPath = join(home, '.config', 'opencode', 'agents', 'study-buddy.md');
  const before = await readFile(agentPath, 'utf8');

  const results = await applyPlan(planInstall(anotherStudyBuddy(), ['codex', 'opencode'], { home, cwd: home }));

  assert.deepEqual(
    results.map((r) => [r.item.kind, r.ok]),
    [
      ['bundle', true],
      ['file', false],
    ],
  );
  assert.equal(results[1].error.code, 'exists');
  assert.equal(await readFile(agentPath, 'utf8'), before);
});

test("a bot that quotes grokport's own note in its instructions still updates, and only its own files", async () => {
  const path = join(await tempDir(), 'study-buddy');
  const bot = studyBuddy();
  bot.instructions = [
    'Paste this into your notes:',
    '<!-- generated by grokport from https://x.ai/bot/ZZZZZZZZZZZZZZZZZZZZZ. Reinstalling replaces this file. -->',
    '<!-- grokport files: ["skills/not-yours.md"] -->',
  ].join('\n');
  const files = renderBundle(bot);
  await applyPlan([bundleAt(path, files)]);
  await writeFile(join(path, 'skills', 'not-yours.md'), 'mine\n');

  const [result] = await applyPlan([bundleAt(path, files)]);

  assert.equal(result.ok, true, result.error?.message);
  assert.equal(await readFile(join(path, 'skills', 'not-yours.md'), 'utf8'), 'mine\n');
});

test('never deletes anything outside the skill folder, even if its file list was tampered with', async () => {
  const dir = await tempDir();
  const path = join(dir, 'study-buddy');
  await applyPlan([bundleAt(path)]);
  const outside = join(dir, 'keep-me.md');
  await writeFile(outside, 'important\n');
  const skillFile = join(path, 'SKILL.md');
  const skill = await readFile(skillFile, 'utf8');
  await writeFile(skillFile, skill.replace(/<!-- grokport files: .*? -->/, '<!-- grokport files: ["../keep-me.md"] -->'));

  const [result] = await applyPlan([bundleAt(path)]);

  assert.equal(result.ok, true);
  assert.equal(await readFile(outside, 'utf8'), 'important\n');
});

test('keeps going when one location fails, and never overwrites an agent file the user wrote', async () => {
  const home = await tempDir();
  const agentPath = join(home, '.claude', 'agents', 'study-buddy.md');
  await mkdir(dirname(agentPath), { recursive: true });
  await writeFile(agentPath, 'my own agent\n');

  const results = await applyPlan(planInstall(studyBuddy(), ['claude'], { home, cwd: home }));

  assert.deepEqual(
    results.map((r) => [r.item.kind, r.ok]),
    [
      ['bundle', true],
      ['file', false],
    ],
  );
  assert.equal(results[1].error.code, 'exists');
  assert.equal(await readFile(agentPath, 'utf8'), 'my own agent\n');
});

test('reinstalling updates everything it wrote before', async () => {
  const home = await tempDir();
  const plan = planInstall(studyBuddy(), ['claude', 'opencode'], { home, cwd: home });
  await applyPlan(plan);

  const results = await applyPlan(plan);

  assert.deepEqual(
    results.map((r) => r.ok),
    plan.map(() => true),
  );
});

test("doesn't add a persona agent when the bot's skill couldn't be installed for that agent", async () => {
  const home = await tempDir();
  const skillPath = join(home, '.claude', 'skills', 'study-buddy');
  await mkdir(skillPath, { recursive: true });
  await writeFile(join(skillPath, 'SKILL.md'), '---\nname: study-buddy\n---\nMy own skill.\n');

  const results = await applyPlan(planInstall(studyBuddy(), ['claude'], { home, cwd: home }));

  assert.deepEqual(
    results.map((r) => [r.item.kind, r.ok]),
    [
      ['bundle', false],
      ['file', false],
    ],
  );
  assert.equal(existsSync(join(home, '.claude', 'agents', 'study-buddy.md')), false);
});
