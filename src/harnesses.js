import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describeBot, generatedNote, renderBundle, renderFrontmatter } from './bundle.js';
import { GrokError } from './grok/errors.js';

const SHARED_SKILLS = '.agents/skills'; // the cross-agent Agent Skills folder

/**
 * The agents grokport installs into. Paths are relative to the home folder and were checked
 * against each agent's docs (September 2026). If an agent moves its folders, fix it here.
 *
 *   configDir   exists when the agent is installed
 *   skillDirs   every folder the agent loads skills from, its own folder first
 *   agent       optional persona file, so a whole session can run as the bot
 *   usage       how to start the bot's skill
 *   agentUsage  how to start the persona, when there is one
 */
export const HARNESSES = [
  {
    id: 'claude',
    name: 'Claude Code',
    configDir: '.claude',
    skillDirs: ['.claude/skills'],
    agent: claudeAgent,
    usage: (bot) => `/${bot.slug}`,
    agentUsage: (bot) => `claude --agent ${bot.slug}`,
  },
  {
    id: 'codex',
    name: 'Codex',
    configDir: '.codex',
    skillDirs: [SHARED_SKILLS],
    usage: (bot) => `$${bot.slug}`,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    configDir: '.cursor',
    skillDirs: ['.cursor/skills', '.claude/skills', SHARED_SKILLS],
    usage: (bot) => `/${bot.slug}`,
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    configDir: '.gemini',
    skillDirs: ['.gemini/skills', SHARED_SKILLS],
    usage: (bot) => `ask for ${bot.name}`,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    configDir: '.config/opencode',
    skillDirs: ['.config/opencode/skills', '.claude/skills', SHARED_SKILLS],
    agent: opencodeAgent,
    usage: (bot) => `ask for ${bot.name}`,
    agentUsage: (bot) => `opencode --agent ${bot.slug}`,
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot CLI',
    configDir: '.copilot',
    skillDirs: ['.copilot/skills', SHARED_SKILLS],
    usage: (bot) => `/${bot.slug}`,
  },
  {
    id: 'grok',
    name: 'Grok CLI',
    configDir: '.grok',
    skillDirs: ['.grok/skills', '.claude/skills', SHARED_SKILLS],
    usage: (bot) => `/${bot.slug}`,
  },
];

/** Not an agent: just saves the skill folder where grokport was run. */
export const FOLDER_TARGET = { id: 'folder', name: 'Save a copy here', usage: (bot) => `./${bot.slug}` };

export function detectHarnesses(home) {
  return HARNESSES.filter((harness) => existsSync(join(home, harness.configDir))).map((harness) => harness.id);
}

/** Throws a usage error naming the first id that isn't a known agent (or `folder`). */
export function checkTargets(ids) {
  const known = [...HARNESSES.map((harness) => harness.id), FOLDER_TARGET.id];
  const unknown = ids.find((id) => !known.includes(id));
  if (unknown) throw new GrokError('usage', `Unknown agent "${unknown}". Choose from: ${known.join(', ')}`);
}

/**
 * Every file to write so each chosen agent picks the bot up. Agents that read the same folder
 * share one copy of the skill.
 *
 * @returns {Array<
 *   | { kind: 'bundle', path: string, files: Record<string, string>, source: string, harnesses: string[] }
 *   | { kind: 'file', path: string, content: string, source: string, harnesses: string[] }
 * >}  `source` is the bot's URL; `harnesses` lists every chosen agent that reads the item.
 */
export function planInstall(bot, ids, { home, cwd }) {
  checkTargets(ids);

  const selected = HARNESSES.filter((harness) => ids.includes(harness.id));
  const files = renderBundle(bot);
  const source = bot.url;
  const plan = chooseSkillDirs(selected).map(({ dir, readers }) => ({
    kind: 'bundle',
    path: join(home, dir, bot.slug),
    files,
    source,
    harnesses: readers.map((harness) => harness.id),
  }));

  for (const harness of selected.filter((h) => h.agent)) {
    const { path, content } = harness.agent(bot);
    plan.push({ kind: 'file', path: join(home, path), content, source, harnesses: [harness.id] });
  }
  if (ids.includes(FOLDER_TARGET.id)) {
    plan.push({ kind: 'bundle', path: join(cwd, bot.slug), files, source, harnesses: [FOLDER_TARGET.id] });
  }
  return plan;
}

/**
 * Picks which skill folders to write. Every chosen agent must see the bot; then, in order: as few
 * agents as possible see it twice, as few copies as possible, an agent's own folder over a borrowed
 * one, and the shared .agents/skills over another agent's folder. There are at most 7 folders, so
 * trying every combination is instant.
 */
function chooseSkillDirs(harnesses) {
  if (harnesses.length === 0) return [];
  const dirs = [...new Set(harnesses.flatMap((harness) => harness.skillDirs))];
  const ownDirs = new Set(harnesses.map((harness) => harness.skillDirs[0]));

  let best;
  for (let mask = 1; mask < 1 << dirs.length; mask++) {
    const chosen = dirs.filter((_, i) => mask & (1 << i));
    const copiesSeen = harnesses.map((harness) => harness.skillDirs.filter((dir) => chosen.includes(dir)).length);
    if (copiesSeen.includes(0)) continue;

    const borrowed = chosen.filter((dir) => !ownDirs.has(dir));
    const score = [
      copiesSeen.reduce((sum, copies) => sum + copies - 1, 0),
      chosen.length,
      borrowed.filter((dir) => dir !== SHARED_SKILLS).length,
      borrowed.length,
    ];
    if (!best || isLower(score, best.score)) best = { chosen, score };
  }

  return best.chosen.map((dir) => ({ dir, readers: harnesses.filter((harness) => harness.skillDirs.includes(dir)) }));
}

function isLower(a, b) {
  const i = a.findIndex((value, index) => value !== b[index]);
  return i !== -1 && a[i] < b[i];
}

function claudeAgent(bot) {
  return {
    path: `.claude/agents/${bot.slug}.md`,
    content: agentFile(
      bot,
      { name: bot.slug, description: describeBot(bot), skills: [bot.slug] },
      `You are ${bot.name}. Your instructions, playbooks, routines and memory are in the ${bot.slug} ` +
        'skill, which is loaded for you. Follow it in everything you do.',
    ),
  };
}

function opencodeAgent(bot) {
  return {
    path: `.config/opencode/agents/${bot.slug}.md`,
    content: agentFile(
      bot,
      { description: describeBot(bot), mode: 'primary' },
      `You are ${bot.name}. Before your first reply, load the ${bot.slug} skill and follow it: it ` +
        'holds your instructions, playbooks, routines and memory.',
    ),
  };
}

function agentFile(bot, frontmatter, body) {
  return `${renderFrontmatter(frontmatter)}\n\n${body}\n\n${generatedNote(bot)}\n`;
}
