import { cleanText } from '../text.js';
import { API_URL } from './endpoints.js';
import { GrokError, formatChanged } from './errors.js';
import { toBot } from './recipe.js';

// The same Connect RPCs the Grok Bot app calls.
const RPC_BASE = `${API_URL}/aiserver.v1.GrokBotService/`;

/** The public card for a bot (name, description, author). Works without an account. */
export async function getPreview(shareId, { fetch = globalThis.fetch } = {}) {
  const preview = await rpc(fetch, 'GetPublicGrokBotTemplate', { shareId });
  if (!preview.template?.shareId) throw formatChanged('GetPublicGrokBotTemplate returned no template');
  return preview;
}

/**
 * Downloads the bot's full recipe: instructions, skills, routines, memory.
 * Marketplace bots are public. Any other shared bot needs a Grok Bot sign-in, because
 * Grok Bot only hands those recipes to signed-in users.
 *
 * @param {{ template: { shareId: string } }} preview  result of getPreview
 * @param {{ fetch?: typeof fetch, getToken?: () => Promise<string | null> }} [options]
 *   `getToken` is only called for bots that need a sign-in.
 */
export async function getBot(preview, { fetch = globalThis.fetch, getToken = async () => null } = {}) {
  const { shareId } = preview.template;
  const recipeUrl =
    (await findMarketplaceRecipe(fetch, shareId)) ?? (await findSharedRecipe(fetch, shareId, getToken));
  return toBot(preview, await download(fetch, recipeUrl));
}

async function findMarketplaceRecipe(fetch, shareId) {
  let pageToken = '';
  do {
    const page = await rpc(fetch, 'ListPublicGrokBotMarketplaceListings', { pageSize: 100, pageToken });
    const listings = [...(page.featuredListings ?? []), ...(page.listings ?? [])];
    const listing = listings.find((l) => l.shareId === shareId);
    if (listing) {
      const { templateGetUrl } = await rpc(fetch, 'GetPublicGrokBotMarketplaceListing', { slug: listing.slug });
      if (!templateGetUrl) throw formatChanged('GetPublicGrokBotMarketplaceListing returned no templateGetUrl');
      return templateGetUrl;
    }
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);
  return null;
}

async function findSharedRecipe(fetch, shareId, getToken) {
  const token = await getToken();
  if (!token) throw loginRequired();
  const { blobGetUrl } = await rpc(fetch, 'GetGrokBotTemplateImportDetails', { shareId }, token);
  if (!blobGetUrl) throw formatChanged('GetGrokBotTemplateImportDetails returned no blobGetUrl');
  return blobGetUrl;
}

async function rpc(fetch, method, body, token) {
  const headers = { 'content-type': 'application/json', 'connect-protocol-version': '1' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await send(fetch, RPC_BASE + method, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;

  switch (data.code) {
    case 'not_found':
      throw new GrokError('not-found', 'No Grok Bot at that link. It may have been deleted or unshared.');
    case 'unauthenticated':
      throw loginRequired();
    case 'permission_denied':
      throw new GrokError(
        'access-denied',
        "Grok Bot won't share this bot with your account. Try signing in with an account that has Grok Bot.",
      );
    default:
      throw new GrokError('api', `Grok Bot's server returned an error: ${detailOf(data) ?? `HTTP ${res.status}`}`);
  }
}

/** Connect errors carry a human-readable message in details[].debug.details.detail. */
function detailOf(data) {
  const detail = data.details?.find((d) => d.debug?.details?.detail)?.debug.details.detail;
  return detail ? cleanText(detail) : undefined;
}

async function download(fetch, url) {
  const res = await send(fetch, url);
  if (!res.ok) {
    throw new GrokError('download-failed', `Couldn't download the bot (HTTP ${res.status}). Please try again.`);
  }
  return res.json().catch(() => null);
}

async function send(fetch, url, init) {
  try {
    return await fetch(url, init);
  } catch (cause) {
    throw new GrokError('offline', "Couldn't reach Grok Bot. Check your internet connection and try again.", {
      cause,
    });
  }
}

function loginRequired() {
  return new GrokError('login-required', 'This bot is shared privately, so Grok Bot needs you to sign in first.');
}
