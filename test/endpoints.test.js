import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveApiUrl } from '../src/grok/endpoints.js';

test("talks to Grok Bot's real API unless told otherwise", () => {
  assert.equal(resolveApiUrl(undefined), 'https://api2.cursor.sh');
  assert.equal(resolveApiUrl(''), 'https://api2.cursor.sh');
});

test('GROKPORT_API_URL can point grokport at a local test server', () => {
  assert.equal(resolveApiUrl('http://127.0.0.1:4173/'), 'http://127.0.0.1:4173');
  assert.equal(resolveApiUrl('http://localhost:9000'), 'http://localhost:9000');
  assert.equal(resolveApiUrl('http://[::1]:8080'), 'http://[::1]:8080');
});

test('GROKPORT_API_URL is ignored for any other host, so sign-in tokens never leave for one', () => {
  const values = [
    'https://evil.example.com',
    'http://api2.cursor.sh.evil.example',
    'http://127.0.0.1.evil.example',
    'not a url',
  ];
  for (const value of values) assert.equal(resolveApiUrl(value), 'https://api2.cursor.sh', value);
});
