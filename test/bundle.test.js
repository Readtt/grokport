import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBundle } from '../src/bundle.js';
import { readFrontmatter, studyBuddy } from './helpers.js';

test('packs a bot into one skill folder with a file per playbook and routine', () => {
  const files = renderBundle(studyBuddy());

  assert.deepEqual(Object.keys(files).sort(), [
    'SKILL.md',
    'routines/monday-kickoff.md',
    'skills/exam-prep-review.md',
    'skills/weekly-plan.md',
  ]);
  assert.equal(files['skills/weekly-plan.md'], '# Weekly plan\n\n1. List deadlines.\n2. Block study time.\n');
  assert.equal(files['routines/monday-kickoff.md'], "List this week's deadlines and propose a plan.\n");
});

test('a bot with only instructions is still a complete skill', () => {
  const bot = { ...studyBuddy(), skills: [], routines: [], memory: [], connectors: [], starterSkill: undefined };

  const files = renderBundle(bot);

  assert.deepEqual(Object.keys(files), ['SKILL.md']);
  assert.equal(readFrontmatter(files['SKILL.md']).name, 'study-buddy');
});

test('names and describes the skill the way agents look for it', () => {
  const { name, description } = readFrontmatter(renderBundle(studyBuddy())['SKILL.md']);

  assert.equal(name, 'study-buddy');
  assert.ok(
    description.startsWith('Keeps your coursework on track: deadlines, weekly plans, and exam prep.'),
    description,
  );
  assert.ok(description.includes('Study Buddy'), description);
});

test('keeps the description within what every agent accepts', () => {
  const bot = studyBuddy();
  bot.description = `Uses <b>bold</b>\nideas: ${'very long words '.repeat(100)}`;

  const { description } = readFrontmatter(renderBundle(bot)['SKILL.md']);

  assert.ok(description.length <= 1024, `length ${description.length}`);
  assert.doesNotMatch(description, /[<>\n]/);
});

test('keeps control characters out of the frontmatter, so every YAML parser accepts it', () => {
  const bot = studyBuddy();
  bot.description = 'Tabs\tand DEL\x7f and bell\x07 are gone';

  const { description } = readFrontmatter(renderBundle(bot)['SKILL.md']);

  assert.doesNotMatch(description, /[\x00-\x1f\x7f-\x9f]/);
});

test('links every playbook and routine from SKILL.md, and nothing that is missing', () => {
  const files = renderBundle(studyBuddy());

  const linked = new Set(files['SKILL.md'].match(/(?:skills|routines)\/[a-z0-9-]+\.md/g));

  assert.deepEqual(
    [...linked].sort(),
    Object.keys(files)
      .filter((path) => path !== 'SKILL.md')
      .sort(),
  );
});

test("carries the bot's instructions, standing memory and apps, but not its activity log", () => {
  const skill = renderBundle(studyBuddy())['SKILL.md'];

  for (const text of [
    'Never writes graded work for you.',
    'One job: keep deadlines visible and plans realistic.',
    'Slack',
  ]) {
    assert.ok(skill.includes(text), text);
  }
  assert.ok(!skill.includes('Imported from template.'));
});

test('sends a first-time user to the starter playbook', () => {
  const bot = studyBuddy();
  const mentions = (b) => renderBundle(b)['SKILL.md'].split('skills/weekly-plan.md').length - 1;

  assert.equal(mentions(bot), mentions({ ...bot, starterSkill: undefined }) + 1);
});
