import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCli } from '../src/args.js';

const LINK = 'https://x.ai/bot/NIEguoGUjA648fUPle8F5';

/** What parseCli returns, with everything not listed left at its default. */
const parsed = (fields) => ({
  command: 'install',
  link: undefined,
  bot: undefined,
  targets: undefined,
  yes: false,
  ...fields,
});

test('reads the command, link and flags', () => {
  const cases = [
    [[], parsed({})],
    [[LINK], parsed({ link: LINK })],
    [[LINK, '--to', 'claude,codex', '-y'], parsed({ link: LINK, targets: ['claude', 'codex'], yes: true })],
    [['--to=cursor', LINK], parsed({ link: LINK, targets: ['cursor'] })],
    [[LINK, '--to', ' claude , ,codex '], parsed({ link: LINK, targets: ['claude', 'codex'] })],
    [['remove'], parsed({ command: 'remove' })],
    [['remove', 'overheard', '-y'], parsed({ command: 'remove', bot: 'overheard', yes: true })],
    [['remove', 'Exam', 'Prep'], parsed({ command: 'remove', bot: 'Exam Prep' })],
    [['login'], parsed({ command: 'login' })],
    [['logout'], parsed({ command: 'logout' })],
    [['--help'], parsed({ command: 'help' })],
    [['-h'], parsed({ command: 'help' })],
    [['--version'], parsed({ command: 'version' })],
    [['-v'], parsed({ command: 'version' })],
  ];
  for (const [argv, expected] of cases) assert.deepEqual(parseCli(argv), expected, argv.join(' '));
});

test('explains unknown flags and extra arguments', () => {
  for (const argv of [['--nope'], [LINK, 'another-link'], ['--to'], [LINK, '--to', ''], [LINK, '--to', ' , ']]) {
    assert.throws(() => parseCli(argv), { code: 'usage' }, argv.join(' '));
  }
});

test("won't take --to with remove, because agents share skill folders", () => {
  assert.throws(() => parseCli(['remove', 'overheard', '--to', 'claude']), { code: 'usage', message: /--to/ });
});
