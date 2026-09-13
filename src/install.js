import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readGenerated } from './bundle.js';
import { GrokError } from './grok/errors.js';

/**
 * Writes an install plan (see planInstall) to disk.
 *
 * grokport only touches what it generated for the same bot. Files it didn't make, or that belong
 * to a different bot with the same name, are left alone and reported. Updating a skill folder
 * removes only the playbooks grokport wrote there, so anything the user added survives.
 * One failure never stops the rest of the plan, except that an agent whose skill folder failed
 * doesn't get its persona file (it would load whatever else sits at that skill path).
 *
 * @returns {Promise<Array<{ item: object, ok: true } | { item: object, ok: false, error: Error }>>}
 *   in the same order as `plan`
 */
export async function applyPlan(plan) {
  const outcomes = new Map();
  const agentsWithoutSkill = new Set();

  for (const item of plan.filter((i) => i.kind === 'bundle')) {
    const outcome = await attempt(() => updateFolder(item));
    if (!outcome.ok) item.harnesses.forEach((id) => agentsWithoutSkill.add(id));
    outcomes.set(item, outcome);
  }
  for (const item of plan.filter((i) => i.kind === 'file')) {
    const skipped = item.harnesses.some((id) => agentsWithoutSkill.has(id));
    outcomes.set(
      item,
      skipped
        ? { ok: false, error: new GrokError('skipped', `Skipped ${item.path} because the skill wasn't installed.`) }
        : await attempt(() => updateFile(item)),
    );
  }

  return plan.map((item) => ({ item, ...outcomes.get(item) }));
}

async function attempt(write) {
  try {
    await write();
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

async function updateFolder({ path, files, source }) {
  if (existsSync(path)) {
    const previous = readGenerated(await readText(join(path, 'SKILL.md')));
    // A real folder (not a link) that holds none of the bot's files is safe to write into, like one
    // `grokport remove` kept because the user had added files to it.
    const isRealFolder = (await lstat(path)).isDirectory();
    const holdsBotFiles = Object.keys(files).some((file) => existsSync(join(path, file)));
    if (previous || holdsBotFiles || !isRealFolder) {
      assertSameBot(previous, source, path);
      for (const file of previous.files) await rm(join(path, file), { force: true });
    }
  }
  for (const [relative, content] of Object.entries(files)) {
    const file = join(path, relative);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
  }
}

async function updateFile({ path, content, source }) {
  if (existsSync(path)) assertSameBot(readGenerated(await readText(path)), source, path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

function assertSameBot(previous, source, path) {
  const fix = 'Rename or remove it, then run grokport again.';
  if (!previous) {
    throw new GrokError('exists', `${path} already exists and wasn't made by grokport, so it was left alone. ${fix}`);
  }
  if (previous.source !== source) {
    throw new GrokError(
      'exists',
      `${path} already holds a different bot (${previous.source}), so it was left alone. ${fix}`,
    );
  }
}

function readText(path) {
  return readFile(path, 'utf8').catch(() => '');
}
