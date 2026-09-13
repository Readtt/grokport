import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openCommand } from '../src/open-url.js';

const URL_WITH_QUERY = 'https://cursor.com/loginDeepControl?challenge=abc&uuid=123&mode=login';

test("uses each platform's own way to open a link, passing the link as one argument", () => {
  assert.deepEqual(openCommand(URL_WITH_QUERY, 'win32'), {
    command: 'rundll32.exe',
    args: ['url.dll,FileProtocolHandler', URL_WITH_QUERY],
  });
  assert.deepEqual(openCommand(URL_WITH_QUERY, 'darwin'), { command: 'open', args: [URL_WITH_QUERY] });
  assert.deepEqual(openCommand(URL_WITH_QUERY, 'linux'), { command: 'xdg-open', args: [URL_WITH_QUERY] });
});
