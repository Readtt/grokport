import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShareId } from '../src/grok/link.js';

const ID = 'NIEguoGUjA648fUPle8F5';

test('pulls the share id out of every link shape people paste', () => {
  const inputs = [
    `https://x.ai/bot/${ID}`,
    `https://x.ai/bot/${ID}/`,
    `https://x.ai/bot/${ID}?ref=share`,
    `https://x.ai/bot/${ID}?id=junk`,
    `http://www.x.ai/bot/${ID}`,
    `x.ai/bot/${ID}`,
    `  https://x.ai/bot/${ID}  `,
    `grokbot://app/v1/bot-template?id=${ID}`,
    `https://cursor.com/grok-bot/link/v1/bot-template?id=${ID}`,
    ID,
  ];
  for (const input of inputs) assert.equal(parseShareId(input), ID, input);
});

test('keeps ids that contain - and _', () => {
  assert.equal(parseShareId('https://x.ai/bot/wOE4e95HNxhSbrzyLkSI-'), 'wOE4e95HNxhSbrzyLkSI-');
  assert.equal(parseShareId('_jOdbfkB16zxu7MRcmReE'), '_jOdbfkB16zxu7MRcmReE');
});

test('rejects anything that is not a bot link', () => {
  const inputs = [
    '',
    'hello',
    'https://x.ai/',
    'https://x.ai/bot/plugin/674',
    `https://x.ai/bot/${ID}extra`,
    `https://x.ai/bot/${ID.slice(1)}`,
  ];
  for (const input of inputs) {
    assert.throws(() => parseShareId(input), /Grok Bot link/, JSON.stringify(input));
  }
});
