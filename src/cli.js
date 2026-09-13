import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { parseCli } from './args.js';
import { clearTokens, getToken, saveTokens, startLogin, waitForLogin } from './grok/auth.js';
import { getBot, getPreview } from './grok/client.js';
import { GrokError } from './grok/errors.js';
import { parseShareId } from './grok/link.js';
import { FOLDER_TARGET, HARNESSES, checkTargets, detectHarnesses, planInstall } from './harnesses.js';
import { applyPlan } from './install.js';
import { openUrl } from './open-url.js';
import { cleanText } from './text.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const TARGETS = [...HARNESSES, FOLDER_TARGET];
const EXIT_CANCELLED = 130;

class Cancelled extends Error {}

/** Runs grokport and resolves to the process exit code. */
export async function main(argv) {
  try {
    const args = parseCli(argv);
    switch (args.command) {
      case 'help':
        console.log(helpText());
        return 0;
      case 'version':
        console.log(version);
        return 0;
      case 'logout':
        await clearTokens();
        console.log(`${pc.green('✔')} Signed out of Grok Bot.`);
        return 0;
      case 'login':
        p.intro(title());
        await signIn();
        p.outro('Signed in. Privately shared bots will work now.');
        return 0;
      default:
        p.intro(title());
        return (await install(args)) ? 0 : 1;
    }
  } catch (error) {
    return fail(error);
  }
}

/** @returns {Promise<boolean>} true when every chosen agent got the bot */
async function install({ link, targets, yes }) {
  if (targets) checkTargets(targets);
  if (!isInteractive() && (!link || (!targets && !yes))) {
    throw new GrokError(
      'usage',
      "grokport can't ask you questions here because this isn't a terminal. Add the link and --to <agents>, or -y.",
    );
  }

  const shareId = parseShareId(link ?? (await askForLink()));
  const preview = await step(
    'Looking up the bot',
    ({ template, ownerDisplayName }) =>
      `Found ${paint(template.avatarColor, cleanText(template.name))}` +
      (ownerDisplayName ? pc.dim(` by ${cleanText(ownerDisplayName)}`) : ''),
    () => getPreview(shareId),
  );
  const bot = await download(preview, yes);
  p.note(summary(bot), paint(bot.color, bot.name));

  const ids = targets ?? (await chooseTargets(bot, yes));
  const results = await applyPlan(planInstall(bot, ids, { home: homedir(), cwd: process.cwd() }));
  return report(bot, ids, results);
}

async function download(preview, yes) {
  const message = 'Downloading its skills and routines';
  const fetchBot = () => getBot(preview, { getToken });
  const needsSignIn = (error) => error.code === 'login-required';

  try {
    return await step(message, 'Downloaded', fetchBot, needsSignIn);
  } catch (error) {
    if (!needsSignIn(error)) throw error;
  }

  if (!isInteractive()) {
    throw new GrokError(
      'login-required',
      'This bot is shared privately. Sign in first by running `npx grokport login` in a terminal, then try again.',
    );
  }
  p.log.info("This bot is shared privately, so Grok Bot wants you signed in before it hands over the bot's skills.");
  const confirmed =
    yes || (await ask(() => p.confirm({ message: 'Sign in with your Grok Bot account? This opens your browser.' })));
  if (!confirmed) throw new Cancelled();
  await signIn();

  try {
    return await step(message, 'Downloaded', fetchBot);
  } catch (error) {
    if (!needsSignIn(error)) throw error;
    throw new GrokError(
      'access-denied',
      "You're signed in, but Grok Bot still won't hand over this bot. Make sure you used the account that has Grok Bot.",
    );
  }
}

async function signIn() {
  const login = startLogin();
  openUrl(login.url);
  p.log.message(`${pc.dim("Your browser should open. If it doesn't, visit:")}\n${pc.cyan(login.url)}`);
  const tokens = await step('Waiting for you to approve the sign-in in your browser', 'Signed in', () =>
    waitForLogin(login),
  );
  await saveTokens(tokens);
}

async function chooseTargets(bot, yes) {
  const detected = detectHarnesses(homedir());
  if (yes) return detected.length > 0 ? detected : [FOLDER_TARGET.id];

  return ask(() =>
    p.multiselect({
      message: `Where should ${bot.name} go?`,
      options: TARGETS.map((target) => ({
        value: target.id,
        label: target.name,
        hint: target === FOLDER_TARGET ? `./${bot.slug}` : detected.includes(target.id) ? 'found' : undefined,
      })),
      initialValues: detected,
      required: true,
    }),
  );
}

/** Prints what happened for each chosen agent. Returns true when nothing failed. */
function report(bot, ids, results) {
  const worked = (target, kind) =>
    results.some((r) => r.ok && r.item.kind === kind && r.item.harnesses.includes(target.id));

  const lines = TARGETS.filter((target) => ids.includes(target.id)).map((target) => {
    if (!worked(target, 'bundle')) return `${pc.red('✖')} ${target.name.padEnd(20)} ${pc.dim('not installed')}`;
    const ways = [target.usage(bot)];
    if (target.agentUsage && worked(target, 'file')) ways.push(target.agentUsage(bot));
    return `${pc.green('✔')} ${target.name.padEnd(20)} ${pc.cyan(ways.join('  or  '))}`;
  });
  p.log.message(lines.join('\n'));
  for (const { error } of results.filter((r) => !r.ok && r.error.code !== 'skipped')) {
    p.log.warn(tildify(error.message));
  }

  const failed = results.some((r) => !r.ok);
  if (!results.some((r) => r.ok && r.item.kind === 'bundle')) {
    p.outro(pc.red('Nothing was installed.'));
  } else if (failed) {
    p.outro(pc.yellow('Installed where possible. Fix the warnings above, then run grokport again for the rest.'));
  } else {
    p.outro(`Ready! Restart any agent that was already open, then say hi to ${paint(bot.color, bot.name)}.`);
  }
  return !failed;
}

function summary(bot) {
  const memories = bot.memory.filter((memory) => memory.kind !== 'log').length;
  const counts = [
    count(bot.skills.length, 'skill'),
    count(bot.routines.length, 'routine'),
    count(memories, 'memory', 'memories'),
  ].filter(Boolean);

  const lines = [wrap(bot.description)];
  if (counts.length > 0) lines.push('', counts.join(pc.dim(' · ')));
  if (bot.connectors.length > 0) {
    lines.push(`${pc.dim('Works with')} ${bot.connectors.map((app) => app.name).join(', ')}`);
  }
  lines.push('', pc.dim(wrap(`Made by ${bot.author ?? 'someone else'}. Like any skill, it can do anything your agent is allowed to do.`)));
  return lines.join('\n');
}

/**
 * Shows a spinner while `task` runs. `quiet(error)` hides the spinner instead of marking it failed.
 *
 * Ctrl+C stops grokport right away with exit code 130. Without a terminal it arrives as SIGINT, which
 * clack's spinner would otherwise swallow (hence onCancel). In a terminal clack itself calls
 * process.exit(0), so an exit during a step is reported as a cancel.
 */
async function step(message, done, task, quiet = () => false) {
  const spinner = p.spinner({ cancelMessage: 'Cancelled.', onCancel: () => process.exit(EXIT_CANCELLED) });
  const reportCancel = () => {
    process.exitCode = EXIT_CANCELLED;
  };
  process.once('exit', reportCancel);
  spinner.start(message);
  try {
    const result = await task();
    spinner.stop(typeof done === 'function' ? done(result) : done);
    return result;
  } catch (error) {
    if (quiet(error)) spinner.clear();
    else spinner.error(message);
    throw error;
  } finally {
    process.removeListener('exit', reportCancel);
  }
}

function isInteractive() {
  return Boolean(process.stdin.isTTY);
}

async function ask(showPrompt) {
  if (!isInteractive()) {
    throw new GrokError('usage', "grokport can't ask you questions here because this isn't a terminal.");
  }
  const answer = await showPrompt();
  if (p.isCancel(answer)) throw new Cancelled();
  return answer;
}

function askForLink() {
  return ask(() =>
    p.text({
      message: 'Paste a Grok Bot link',
      placeholder: 'https://x.ai/bot/...',
      validate: (value) => {
        try {
          parseShareId(value);
        } catch (error) {
          return error.message;
        }
      },
    }),
  );
}

function fail(error) {
  if (error instanceof Cancelled) {
    p.cancel('Cancelled.');
    return EXIT_CANCELLED;
  }
  if (error instanceof GrokError) {
    const hint = error.code === 'usage' ? `\n${pc.dim('Run npx grokport --help for examples.')}` : '';
    p.cancel(`${error.message}${details(error)}${hint}`);
    return 1;
  }
  p.cancel(`Something went wrong: ${error.message}`);
  console.error(pc.dim(error.stack));
  return 1;
}

/** The low-level reason behind an error, like "connect ECONNREFUSED 127.0.0.1:443", as a dim extra line. */
function details(error) {
  let cause = error.cause;
  while (cause?.cause) cause = cause.cause;
  const reason = cause?.message || cause?.code;
  return reason ? `\n${pc.dim(`Details: ${cleanText(reason)}`)}` : '';
}

// Grok Bot's avatar palette, so each bot's name shows in its own color.
const AVATAR_RGB = {
  black: [229, 229, 229],
  brown: [147, 100, 57],
  red: [255, 38, 60],
  orange: [255, 103, 0],
  yellow: [255, 152, 0],
  green: [0, 201, 114],
  cyan: [0, 188, 166],
  blue: [16, 132, 254],
  violet: [145, 89, 254],
  magenta: [255, 48, 155],
  gray: [119, 119, 119],
};
const AVATAR_BASIC = {
  brown: pc.yellow,
  red: pc.red,
  orange: pc.yellow,
  yellow: pc.yellow,
  green: pc.green,
  cyan: pc.cyan,
  blue: pc.blue,
  violet: pc.magenta,
  magenta: pc.magenta,
  gray: pc.gray,
};
const TRUECOLOR = /truecolor|24bit/i.test(process.env.COLORTERM ?? '') || Boolean(process.env.WT_SESSION);

function paint(color, text) {
  if (!pc.isColorSupported) return text;
  const rgb = AVATAR_RGB[color];
  if (TRUECOLOR && rgb) return pc.bold(`\x1b[38;2;${rgb.join(';')}m${text}\x1b[39m`);
  return pc.bold((AVATAR_BASIC[color] ?? String)(text));
}

function title() {
  return pc.bgWhite(pc.black(pc.bold(' grokport ')));
}

function count(n, one, many = `${one}s`) {
  return n === 0 ? '' : `${n} ${n === 1 ? one : many}`;
}

function wrap(text, width = Math.max(40, Math.min(70, (process.stdout.columns ?? 80) - 10))) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

function tildify(text) {
  return text.split(homedir()).join('~');
}

function helpText() {
  const ids = TARGETS.map((target) => target.id).join(', ');
  return `
${pc.bold('grokport')}  add a Grok Bot to your coding agents

${pc.bold('Usage')}
  npx grokport <link>                  add a bot (asks where to put it)
  npx grokport <link> --to claude -y   add a bot without asking anything
  npx grokport login                   sign in (only needed for private bots)
  npx grokport logout                  sign out

${pc.bold('Options')}
  --to <agents>   where to put the bot, with commas between agents
  -y, --yes       don't ask anything (without --to, the bot goes into every
                  agent grokport finds on this computer)
  -h, --help      show this help
  -v, --version   show the version number

${pc.bold('Agents')}
  ${ids}
  (folder puts a copy in the current folder)

${pc.bold('Example')}
  npx grokport https://x.ai/bot/NIEguoGUjA648fUPle8F5
`;
}
