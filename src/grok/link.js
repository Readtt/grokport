import { GrokError } from './errors.js';

// Same pattern the Grok Bot app uses to validate share ids.
const SHARE_ID = /^[A-Za-z0-9_-]{21}$/;

/**
 * Accepts whatever a person pastes: an x.ai/bot link, a grokbot:// deep link,
 * a cursor.com link, or the bare id. Returns the 21-character share id.
 */
export function parseShareId(input) {
  const text = String(input ?? '').trim();
  if (SHARE_ID.test(text)) return text;

  const url = toUrl(text);
  const candidates = [url?.searchParams.get('id'), url?.pathname.match(/\/bot\/([^/]+)\/?$/)?.[1]];
  const shareId = candidates.find((candidate) => candidate && SHARE_ID.test(candidate));
  if (shareId) return shareId;

  throw new GrokError(
    'bad-link',
    "That doesn't look like a Grok Bot link. It should look like https://x.ai/bot/NIEguoGUjA648fUPle8F5",
  );
}

function toUrl(text) {
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}
