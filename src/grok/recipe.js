import { botSlug, uniqueSlugs } from '../slug.js';
import { cleanText } from '../text.js';
import { formatChanged } from './errors.js';

/**
 * @typedef {{ name: string, slug: string, description: string, content: string }} Skill
 * @typedef {{
 *   id: string, url: string, name: string, slug: string, author?: string, color?: string,
 *   description: string, instructions: string,
 *   skills: Skill[], routines: Skill[],
 *   memory: { kind?: string, content: string }[],
 *   connectors: { name: string, description?: string }[],
 *   starterSkill?: string,
 * }} Bot
 */

/**
 * Turns Grok Bot's data into grokport's portable Bot. This is the only place that knows the
 * recipe's shape, so if Grok Bot changes its format, fix it here. Everything the bot's author
 * wrote is cleaned of terminal control codes on the way in.
 *
 * @param {{ template: object, ownerDisplayName?: string }} preview  GetPublicGrokBotTemplate response
 * @param {object} recipe  the template JSON the Grok Bot app downloads on "Add to Grok Bot"
 * @returns {Bot}
 */
export function toBot(preview, recipe) {
  const profile = recipe?.profile;
  requireText(profile?.name, 'profile.name');

  const skills = readList(recipe.skills, 'skills', ['name', 'content']);
  const routines = readList(recipe.routines, 'routines', ['name', 'content']);
  const memory = readList(recipe.memory, 'memory', ['content']);
  const plugins = readList(recipe.plugins, 'plugins', ['name']);

  const { template } = preview;
  const name = cleanText(profile.name);
  const instructions = cleanText(profile.description ?? '');
  const skillSlugs = uniqueSlugs(skills.map((s) => cleanText(s.name)), 'skill');
  const routineSlugs = uniqueSlugs(routines.map((r) => cleanText(r.slug || r.name)), 'routine');

  return {
    id: template.shareId,
    url: `https://x.ai/bot/${template.shareId}`,
    name,
    slug: botSlug(name),
    author: cleanText(preview.ownerDisplayName ?? '') || undefined,
    color: profile.avatarColor ?? template.avatarColor,
    description: cleanText(template.description ?? '') || instructions,
    instructions,
    skills: skills.map((s, i) => toPlaybook(s, skillSlugs[i])),
    routines: routines.map((r, i) => toPlaybook(r, routineSlugs[i])),
    memory: memory.map((m) => ({ kind: m.kind, content: cleanText(m.content) })),
    connectors: plugins.map((p) => ({
      name: cleanText(p.name),
      description: p.description === undefined ? undefined : cleanText(p.description),
    })),
    starterSkill: skillSlugs[skills.findIndex((s) => s.name === recipe.gettingStarted?.skill)],
  };
}

function toPlaybook(item, slug) {
  return {
    name: cleanText(item.name),
    slug,
    description: cleanText(item.description ?? ''),
    content: cleanText(item.content),
  };
}

function readList(value, path, requiredText) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw formatChanged(`${path} is not a list`);
  value.forEach((item, i) => requiredText.forEach((key) => requireText(item?.[key], `${path}[${i}].${key}`)));
  return value;
}

function requireText(value, path) {
  if (typeof value !== 'string' || value.length === 0) throw formatChanged(`${path} is missing`);
}
