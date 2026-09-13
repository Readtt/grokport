/**
 * A failure we can explain to a person. `code` is stable and meant for the CLI
 * to branch on; `message` is written for humans.
 */
export class GrokError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'GrokError';
    this.code = code;
  }
}

/** Grok Bot sent something grokport doesn't understand: its API or bot format changed. */
export function formatChanged(detail) {
  return new GrokError(
    'format',
    `Grok Bot's data format has changed (${detail}), so grokport needs an update. Try \`npx grokport@latest\`.`,
  );
}
