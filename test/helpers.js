import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toBot } from '../src/grok/recipe.js';

export const loadFixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

/** The Study Buddy fixture as grokport's portable Bot. */
export const studyBuddy = () => toBot(loadFixture('template.json'), loadFixture('recipe.json'));

/** Reads the `key: value` lines of a frontmatter block. Quoted and [list] values are parsed as JSON. */
export function readFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, 'file starts with a frontmatter block');
  return Object.fromEntries(
    match[1].split('\n').map((line) => {
      const separator = line.indexOf(': ');
      const value = line.slice(separator + 2);
      return [line.slice(0, separator), /^["[]/.test(value) ? JSON.parse(value) : value];
    }),
  );
}
