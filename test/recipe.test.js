import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toBot } from '../src/grok/recipe.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

test('maps a Grok Bot recipe to the portable bot format', () => {
  const bot = toBot(load('template.json'), load('recipe.json'));

  assert.deepEqual(bot, {
    id: 'AbCdEfGhIjKlMnOpQrStU',
    url: 'https://x.ai/bot/AbCdEfGhIjKlMnOpQrStU',
    name: 'Study Buddy',
    slug: 'study-buddy',
    author: 'Ada',
    color: 'blue',
    description: 'Keeps your coursework on track: deadlines, weekly plans, and exam prep.',
    instructions: 'Keeps your coursework on track. Never writes graded work for you.',
    skills: [
      {
        name: 'Weekly Plan',
        slug: 'weekly-plan',
        description: 'Use when the user wants a plan for the week ahead.',
        content: '# Weekly plan\n\n1. List deadlines.\n2. Block study time.',
      },
      {
        name: 'Exam Prep & Review',
        slug: 'exam-prep-review',
        description: 'Use when an exam is within 14 days.',
        content: '# Exam prep\n\nBuild a spaced review schedule.',
      },
    ],
    routines: [
      {
        name: 'Monday kickoff',
        slug: 'monday-kickoff',
        description: "Every Monday 8am: the week's deadlines.",
        content: "List this week's deadlines and propose a plan.",
      },
    ],
    memory: [
      { kind: 'profile', content: 'One job: keep deadlines visible and plans realistic.' },
      { kind: 'log', content: 'Imported from template.' },
    ],
    connectors: [{ name: 'Slack', description: 'Optional. Post the plan to a channel.' }],
    starterSkill: 'weekly-plan',
  });
});

test('gives clashing skill names distinct slugs', () => {
  const recipe = load('recipe.json');
  recipe.skills = [
    { name: 'Plan', description: 'a', content: 'a' },
    { name: 'plan!', description: 'b', content: 'b' },
  ];
  assert.deepEqual(
    toBot(load('template.json'), recipe).skills.map((s) => s.slug),
    ['plan', 'plan-2'],
  );
});

test('falls back to a safe slug when a name has no letters or digits', () => {
  const recipe = load('recipe.json');
  recipe.profile.name = '🤖';
  recipe.skills = [{ name: '!!!', description: 'a', content: 'a' }];
  const bot = toBot(load('template.json'), recipe);
  assert.equal(bot.slug, 'grok-bot');
  assert.equal(bot.skills[0].slug, 'skill-1');
});

test('caps slugs at 64 characters without a dangling hyphen', () => {
  const recipe = load('recipe.json');
  recipe.profile.name = `${'a'.repeat(63)} b`;
  assert.equal(toBot(load('template.json'), recipe).slug, 'a'.repeat(63));
});

test('treats missing optional sections as empty', () => {
  const template = load('template.json');
  template.template.description = '';
  delete template.ownerDisplayName;
  const recipe = load('recipe.json');
  delete recipe.memory;
  delete recipe.routines;
  delete recipe.plugins;
  delete recipe.gettingStarted;

  const bot = toBot(template, recipe);

  assert.equal(bot.description, 'Keeps your coursework on track. Never writes graded work for you.');
  assert.equal(bot.author, undefined);
  assert.deepEqual([bot.memory, bot.routines, bot.connectors, bot.starterSkill], [[], [], [], undefined]);
});

test('ignores a starter skill that is not in the recipe', () => {
  const recipe = load('recipe.json');
  recipe.gettingStarted = { skill: 'Nope' };
  assert.equal(toBot(load('template.json'), recipe).starterSkill, undefined);
});

test('strips terminal control codes from everything the bot author wrote', () => {
  const template = load('template.json');
  template.template.description = 'Evil \x1b[2J\x1b[31mred\x1b[0m description\x07';
  template.ownerDisplayName = 'Ada\x1b]0;pwned\x07';
  const recipe = load('recipe.json');
  recipe.profile.name = 'Study\x1b[1m Buddy';
  recipe.profile.description = 'Line one\r\nLine\ttwo\x00';
  recipe.skills[0].content = '# Weekly plan\x1b[?25l\n\n1. List deadlines.';
  recipe.memory[0].content = 'Remember\x7f this';
  recipe.plugins[0].name = 'Sla\x9bck';

  const bot = toBot(template, recipe);

  assert.equal(bot.name, 'Study Buddy');
  assert.equal(bot.slug, 'study-buddy');
  assert.equal(bot.author, 'Ada');
  assert.equal(bot.description, 'Evil red description');
  assert.equal(bot.instructions, 'Line one\nLine\ttwo');
  assert.equal(bot.skills[0].content, '# Weekly plan\n\n1. List deadlines.');
  assert.equal(bot.memory[0].content, 'Remember this');
  assert.equal(bot.connectors[0].name, 'Slack');
});

test('says the Grok Bot format changed when required fields are missing', () => {
  const noProfile = {};
  const skillWithoutContent = { ...load('recipe.json'), skills: [{ name: 'x', description: 'y' }] };
  for (const recipe of [noProfile, skillWithoutContent]) {
    assert.throws(() => toBot(load('template.json'), recipe), /format/i);
  }
});
