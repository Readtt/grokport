import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectHarnesses, planInstall } from '../src/harnesses.js';
import { readFrontmatter, studyBuddy } from './helpers.js';

const HOME = join('/home', 'ada');
const CWD = join('/work');
const inHome = (...parts) => join(HOME, ...parts);
const plan = (ids) => planInstall(studyBuddy(), ids, { home: HOME, cwd: CWD });

/** [folder, agents reading it] for every copy of the bot's skill folder. */
const skillFolders = (items) => items.filter((i) => i.kind === 'bundle').map((i) => [i.path, i.harnesses]);

// Where each agent loads user skills from, according to each agent's docs (September 2026).
const READS = {
  claude: ['.claude/skills'],
  codex: ['.agents/skills'],
  cursor: ['.cursor/skills', '.claude/skills', '.agents/skills'],
  gemini: ['.gemini/skills', '.agents/skills'],
  opencode: ['.config/opencode/skills', '.claude/skills', '.agents/skills'],
  copilot: ['.copilot/skills', '.agents/skills'],
  grok: ['.grok/skills', '.claude/skills', '.agents/skills'],
};
const AGENTS = Object.keys(READS);

/** All 127 non-empty combinations of agents. */
function everyCombination() {
  const combinations = [];
  for (let mask = 1; mask < 1 << AGENTS.length; mask++) {
    combinations.push(AGENTS.filter((_, i) => mask & (1 << i)));
  }
  return combinations;
}

/** How many copies of the bot each chosen agent will load. */
function copiesSeen(ids) {
  const folders = plan(ids)
    .filter((i) => i.kind === 'bundle')
    .map((i) => i.path);
  return Object.fromEntries(
    ids.map((id) => [id, READS[id].filter((dir) => folders.includes(join(HOME, dir, 'study-buddy'))).length]),
  );
}

test("installs for one agent into that agent's own skills folder", () => {
  const cases = [
    ['claude', inHome('.claude', 'skills', 'study-buddy')],
    ['codex', inHome('.agents', 'skills', 'study-buddy')],
    ['cursor', inHome('.cursor', 'skills', 'study-buddy')],
    ['gemini', inHome('.gemini', 'skills', 'study-buddy')],
    ['opencode', inHome('.config', 'opencode', 'skills', 'study-buddy')],
    ['copilot', inHome('.copilot', 'skills', 'study-buddy')],
    ['grok', inHome('.grok', 'skills', 'study-buddy')],
  ];
  for (const [id, folder] of cases) {
    assert.deepEqual(skillFolders(plan([id])), [[folder, [id]]], id);
  }
});

test('shares one copy between agents that read the same folder', () => {
  const cases = [
    [['claude', 'cursor'], [[inHome('.claude', 'skills', 'study-buddy'), ['claude', 'cursor']]]],
    [['codex', 'cursor'], [[inHome('.agents', 'skills', 'study-buddy'), ['codex', 'cursor']]]],
    [['cursor', 'gemini'], [[inHome('.agents', 'skills', 'study-buddy'), ['cursor', 'gemini']]]],
    [['opencode', 'grok'], [[inHome('.agents', 'skills', 'study-buddy'), ['opencode', 'grok']]]],
  ];
  for (const [ids, expected] of cases) {
    assert.deepEqual(skillFolders(plan(ids)), expected, ids.join('+'));
  }
});

test('writes an extra copy rather than letting an agent see the bot twice', () => {
  assert.deepEqual(skillFolders(plan(['claude', 'cursor', 'gemini', 'copilot'])), [
    [inHome('.claude', 'skills', 'study-buddy'), ['claude', 'cursor']],
    [inHome('.gemini', 'skills', 'study-buddy'), ['gemini']],
    [inHome('.copilot', 'skills', 'study-buddy'), ['copilot']],
  ]);
});

test('every chosen agent gets the bot, in every combination of agents', () => {
  for (const ids of everyCombination()) {
    const seen = copiesSeen(ids);
    for (const id of ids) assert.ok(seen[id] >= 1, `${ids.join('+')}: ${id} sees ${seen[id]} copies`);
  }
});

test('no agent loads the bot twice unless Claude Code and Codex are both chosen', () => {
  // Claude Code only reads .claude/skills and Codex only reads .agents/skills, so choosing both
  // forces two copies, which Cursor, OpenCode and Grok (they read both folders) will each see.
  for (const ids of everyCombination()) {
    const seen = copiesSeen(ids);
    const forced = ids.includes('claude') && ids.includes('codex');
    for (const id of ids) {
      const expected = forced && ['cursor', 'opencode', 'grok'].includes(id) ? 2 : 1;
      assert.equal(seen[id], expected, `${ids.join('+')}: ${id}`);
    }
  }
});

test('each copy lists every chosen agent that reads it', () => {
  for (const ids of everyCombination()) {
    for (const item of plan(ids).filter((i) => i.kind === 'bundle')) {
      const readers = ids.filter((id) => READS[id].some((dir) => item.path === join(HOME, dir, 'study-buddy')));
      assert.deepEqual(item.harnesses, readers, `${ids.join('+')}: ${item.path}`);
    }
  }
});

test('adds a persona agent where a whole session can run as the bot', () => {
  const files = plan(['claude', 'codex', 'opencode'])
    .filter((i) => i.kind === 'file')
    .map((i) => [i.path, i.harnesses]);

  assert.deepEqual(files, [
    [inHome('.claude', 'agents', 'study-buddy.md'), ['claude']],
    [inHome('.config', 'opencode', 'agents', 'study-buddy.md'), ['opencode']],
  ]);
});

test('persona agents pull in the bot skill', () => {
  const items = plan(['claude', 'opencode']);
  const frontmatterAt = (path) => readFrontmatter(items.find((i) => i.path === path).content);

  const claude = frontmatterAt(inHome('.claude', 'agents', 'study-buddy.md'));
  assert.equal(claude.name, 'study-buddy');
  assert.deepEqual(claude.skills, ['study-buddy']);
  assert.ok(claude.description.includes('Study Buddy'));

  const opencode = frontmatterAt(inHome('.config', 'opencode', 'agents', 'study-buddy.md'));
  assert.equal(opencode.mode, 'primary');
  assert.ok(opencode.description.includes('Study Buddy'));
});

test('can simply save the skill folder in the current directory', () => {
  assert.deepEqual(skillFolders(plan(['folder'])), [[join(CWD, 'study-buddy'), ['folder']]]);
});

test('every copy of the skill folder has the full bundle', () => {
  const [bundle] = plan(['claude']);
  assert.deepEqual(Object.keys(bundle.files).sort(), [
    'SKILL.md',
    'routines/monday-kickoff.md',
    'skills/exam-prep-review.md',
    'skills/weekly-plan.md',
  ]);
});

test('rejects agents it does not know', () => {
  assert.throws(() => plan(['claude', 'vim']), { code: 'usage', message: /vim/ });
});

test('detects installed agents from their config folders', async () => {
  const home = await mkdtemp(join(tmpdir(), 'grokport-home-'));
  await mkdir(join(home, '.claude'));
  await mkdir(join(home, '.config', 'opencode'), { recursive: true });

  assert.deepEqual(detectHarnesses(home), ['claude', 'opencode']);
});
