import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCli } from '../src/args.js';

const LINK = 'https://x.ai/bot/NIEguoGUjA648fUPle8F5';

test('reads the command, link and flags', () => {
  const cases = [
    [[], { command: 'install', link: undefined, targets: undefined, yes: false }],
    [[LINK], { command: 'install', link: LINK, targets: undefined, yes: false }],
    [[LINK, '--to', 'claude,codex', '-y'], { command: 'install', link: LINK, targets: ['claude', 'codex'], yes: true }],
    [['--to=cursor', LINK], { command: 'install', link: LINK, targets: ['cursor'], yes: false }],
    [[LINK, '--to', ' claude , ,codex '], { command: 'install', link: LINK, targets: ['claude', 'codex'], yes: false }],
    [['login'], { command: 'login', link: undefined, targets: undefined, yes: false }],
    [['logout'], { command: 'logout', link: undefined, targets: undefined, yes: false }],
    [['--help'], { command: 'help', link: undefined, targets: undefined, yes: false }],
    [['-h'], { command: 'help', link: undefined, targets: undefined, yes: false }],
    [['--version'], { command: 'version', link: undefined, targets: undefined, yes: false }],
    [['-v'], { command: 'version', link: undefined, targets: undefined, yes: false }],
  ];
  for (const [argv, expected] of cases) assert.deepEqual(parseCli(argv), expected, argv.join(' '));
});

test('explains unknown flags and extra arguments', () => {
  for (const argv of [['--nope'], [LINK, 'another-link'], ['--to'], [LINK, '--to', ''], [LINK, '--to', ' , ']]) {
    assert.throws(() => parseCli(argv), { code: 'usage' }, argv.join(' '));
  }
});
