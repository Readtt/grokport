import { parseArgs } from 'node:util';
import { GrokError } from './grok/errors.js';

const COMMANDS = new Set(['login', 'logout']);

/**
 * `grokport [link] [--to claude,codex] [-y]`, `grokport login`, `grokport logout`.
 * @returns {{ command: 'install'|'login'|'logout'|'help'|'version', link?: string, targets?: string[], yes: boolean }}
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
  if (positionals.length > 1) {
    throw new GrokError('usage', `Expected one bot link, but got ${positionals.length}: ${positionals.join(' ')}`);
  }

  const targets = values.to
    ?.split(',')
    .map((target) => target.trim())
    .filter(Boolean);
  if (targets?.length === 0) throw new GrokError('usage', '--to needs at least one agent, like --to claude,codex');

  const [first] = positionals;
  const command = values.help ? 'help' : values.version ? 'version' : COMMANDS.has(first) ? first : 'install';
  return { command, link: command === 'install' ? first : undefined, targets, yes: values.yes ?? false };
}
