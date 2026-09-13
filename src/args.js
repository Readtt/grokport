import { parseArgs } from 'node:util';
import { GrokError } from './grok/errors.js';

const COMMANDS = new Set(['login', 'logout', 'remove']);

/**
 * `grokport [link] [--to claude,codex] [-y]`, `grokport remove [bot] [-y]`, `grokport login`, `grokport logout`.
 * For remove, `bot` is the bot's name or link, and a name of several words works without quotes.
 * @returns {{
 *   command: 'install'|'remove'|'login'|'logout'|'help'|'version',
 *   link?: string, bot?: string, targets?: string[], yes: boolean,
 * }}
 */
export function parseCli(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        to: { type: 'string' },
        yes: { type: 'boolean', short: 'y' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    throw new GrokError('usage', error.message);
  }

  const { values, positionals } = parsed;
  const [first, ...rest] = positionals;
  if (first !== 'remove' && rest.length > 0) {
    throw new GrokError('usage', `Expected one bot link, but got ${positionals.length}: ${positionals.join(' ')}`);
  }

  const targets = values.to
    ?.split(',')
    .map((target) => target.trim())
    .filter(Boolean);
  if (targets?.length === 0) throw new GrokError('usage', '--to needs at least one agent, like --to claude,codex');

  const command = values.help ? 'help' : values.version ? 'version' : COMMANDS.has(first) ? first : 'install';
  if (command === 'remove' && targets) {
    throw new GrokError(
      'usage',
      "--to doesn't work with remove. Agents share skill folders, so grokport removes the bot from every agent at once.",
    );
  }
  return {
    command,
    link: command === 'install' ? first : undefined,
    bot: command === 'remove' ? rest.join(' ') || undefined : undefined,
    targets,
    yes: values.yes ?? false,
  };
}
