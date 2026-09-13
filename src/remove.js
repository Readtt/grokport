import { existsSync } from 'node:fs';
import { readdir, readFile, realpath, rm, rmdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { PLAYBOOK_FOLDERS, readGenerated } from './bundle.js';
import { GrokError } from './grok/errors.js';
import { parseShareId } from './grok/link.js';
import { AGENT_DIRS, SKILL_DIRS } from './harnesses.js';
import { botSlug, slugify } from './slug.js';

/**
 * @typedef {{ kind: 'bundle' | 'file', path: string, slug: string }} Item  a skill folder or a persona file
 * @typedef {{ source: string, name: string, items: Item[] }} InstalledBot  `source` is the bot's link
 */

/**
 * Every bot grokport installed for the agents in `home`, sorted by name. grokport knows its own files
 * by the note it leaves in each one and by their names, so skills it didn't make, copies under another
 * name and links to folders elsewhere never show up. Copies saved with "Save a copy here" can be
 * anywhere, so they aren't listed either.
 * @returns {Promise<InstalledBot[]>}
 */
export async function findInstalled(home) {
  const bots = new Map();
  for (const { source, name, item } of await findGenerated(home)) {
    if (!bots.has(source)) bots.set(source, { source, name: undefined, items: [] });
    const bot = bots.get(source);
    bot.name ||= name;
    bot.items.push(item);
  }
  return [...bots.values()]
    .map((bot) => ({ ...bot, name: bot.name || bot.items[0].slug }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The installed bot that `wanted` names: its name ("Study Buddy" or "study-buddy") or its link.
 * @param {InstalledBot[]} bots
 * @throws {GrokError} when no bot, or more than one bot, goes by that name
 */
export function findBot(bots, wanted) {
  const shareId = shareIdIn(wanted);
  const name = wanted.trim().toLowerCase();
  const slug = slugify(wanted, '');
  const matches = bots.filter(
    (bot) =>
      (shareId && shareIdIn(bot.source) === shareId) ||
      bot.name.toLowerCase() === name ||
      bot.items.some((item) => item.slug === slug),
  );

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    const links = matches.map((bot) => bot.source).join(' or ');
    throw new GrokError('ambiguous', `More than one bot is called "${wanted}". Use its link instead: ${links}`);
  }
  throw new GrokError(
    'not-found',
    bots.length === 0
      ? `grokport hasn't added any bots to your agents, so there's no "${wanted}" to remove.`
      : `grokport didn't add a bot called "${wanted}". You can remove: ${bots.map((bot) => bot.name).join(', ')}.`,
  );
}

/**
 * Deletes what grokport wrote for `bot`. Each file's note is read again right before deleting. In a
 * skill folder only grokport's own files go, then its playbook folders and the folder itself if they
 * are empty, so files the user added stay. One failure never stops the rest.
 *
 * @param {InstalledBot} bot
 * @returns {Promise<Array<{ item: Item, ok: true, kept: boolean } | { item: Item, ok: false, error: Error }>>}
 *   in the same order as `bot.items`. `kept` is true when a skill folder stays because it still holds
 *   files the user added.
 */
export async function removeBot(bot) {
  const results = [];
  for (const item of bot.items) {
    try {
      const remove = item.kind === 'bundle' ? removeFolder : removeFile;
      results.push({ item, ok: true, kept: await remove(item.path, bot.source) });
    } catch (error) {
      results.push({ item, ok: false, error });
    }
  }
  return results;
}

/** Skill folders and persona files that grokport generated, straight inside the folders it installs into. */
async function findGenerated(home) {
  const found = [];
  const seen = new Set();
  const add = async (item, { source, name }) => {
    // When one agent's skills folder is a link to another's, the same bot folder turns up twice.
    const real = await realpath(item.path).catch(() => item.path);
    if (seen.has(real)) return;
    seen.add(real);
    found.push({ source, name, item });
  };

  // Only real folders and files count: a link could lead to a copy the user keeps somewhere else.
  for (const dir of SKILL_DIRS) {
    for (const entry of await entriesIn(join(home, dir))) {
      if (!entry.isDirectory()) continue;
      const path = join(home, dir, entry.name);
      const generated = readGenerated(await readText(join(path, 'SKILL.md')));
      // grokport names the folder after the bot, so a copy under another name isn't the bot's.
      if (generated && entry.name === botSlug(generated.name ?? '')) {
        await add({ kind: 'bundle', path, slug: entry.name }, generated);
      }
    }
  }
  for (const dir of AGENT_DIRS) {
    for (const entry of await entriesIn(join(home, dir))) {
      const slug = basename(entry.name, '.md');
      if (!entry.isFile() || !entry.name.endsWith('.md') || botSlug(slug) !== slug) continue;
      const path = join(home, dir, entry.name);
      const generated = readGenerated(await readText(path));
      if (generated) await add({ kind: 'file', path, slug }, generated);
    }
  }
  return found;
}

/**
 * @returns {Promise<boolean>} true when the folder stays because it still holds files the user added
 */
async function removeFolder(path, source) {
  if (!existsSync(path)) return false; // already deleted by hand
  const generated = readGenerated(await readText(join(path, 'SKILL.md')));
  assertOwnedBy(generated, source, path);

  // SKILL.md goes last: if something fails halfway, its note is still there to try again.
  for (const file of [...generated.files, 'SKILL.md']) await rm(join(path, file), { force: true });
  // With SKILL.md gone, agents no longer load the bot, so the rest is tidying up. rmdir only deletes an
  // empty folder, and a folder that is still in use or holds the user's files simply stays.
  for (const folder of [...PLAYBOOK_FOLDERS, '.']) await rmdir(join(path, folder)).catch(() => {});
  return (await readdir(path).catch(() => [])).length > 0;
}

async function removeFile(path, source) {
  if (!existsSync(path)) return false;
  assertOwnedBy(readGenerated(await readText(path)), source, path);
  await rm(path);
  return false;
}

function assertOwnedBy(generated, source, path) {
  if (generated?.source !== source) {
    throw new GrokError('changed', `${path} changed or couldn't be read, so grokport left it alone.`);
  }
}

function shareIdIn(text) {
  try {
    return parseShareId(text);
  } catch {
    return undefined;
  }
}

function entriesIn(dir) {
  return readdir(dir, { withFileTypes: true }).catch(() => []);
}

function readText(path) {
  return readFile(path, 'utf8').catch(() => '');
}
