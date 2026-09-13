# How grokport works

grokport works in four steps. Each step lives in its own file, so when something breaks you know
where to look.

```
Grok Bot link  ->  src/grok/          download the bot and read it into a Bot object
Bot            ->  src/bundle.js      turn the Bot into one Agent Skill folder
skill folder   ->  src/harnesses.js   work out where each chosen agent looks for skills
install plan   ->  src/install.js     write the files, but never over files grokport didn't make
```

| If you see this                                      | Look here                                         |
| ---------------------------------------------------- | ------------------------------------------------- |
| "doesn't look like a Grok Bot link"                  | `src/grok/link.js`                                |
| "data format has changed (... is missing)"           | `src/grok/recipe.js`                              |
| "data format has changed (... returned no ...)"      | `src/grok/client.js`                              |
| HTTP 404, "could not be routed", other server errors | `src/grok/client.js`                              |
| "Couldn't reach Grok Bot"                            | its `Details:` line, then `src/grok/endpoints.js` |
| sign-in never ends, or Grok Bot says no to the token | `src/grok/auth.js`                                |
| an agent stops finding a bot you installed           | `src/harnesses.js`                                |
| you want SKILL.md to say something else              | `src/bundle.js`                                   |

## Where Grok Bot keeps a bot

Grok Bot has no public API. Everything below comes from looking inside the Grok Bot desktop app and
watching what it asks the server for when you press **Add to Grok Bot**. (The app is built with
Electron and runs on Cursor's servers.)

### 1. The share link

A share link looks like `https://x.ai/bot/<shareId>`. The `shareId` is 21 characters long and matches
`^[A-Za-z0-9_-]{21}$`. The **Add to Grok Bot** button on that page opens
`grokbot://app/v1/bot-template?id=<shareId>`. The page itself only shows a preview: the bot's name,
description, author and avatar color.

### 2. The preview (no account needed)

```
POST https://api2.cursor.sh/aiserver.v1.GrokBotService/GetPublicGrokBotTemplate
Content-Type: application/json

{"shareId": "NIEguoGUjA648fUPle8F5"}
```

The answer is `{ template: { shareId, name, description, avatarShape, avatarColor, activeVersion,
blobObjectKey, ownerType, ... }, ownerDisplayName }`. If no bot has that id, the answer is HTTP 404
with `{"code":"not_found"}`.

All of these calls use [Connect](https://connectrpc.com/docs/protocol/), so plain JSON works for
every one of them.

### 3. The recipe (the whole bot)

The whole bot is a JSON file that Grok Bot calls a recipe. It's stored on Amazon S3, and there are
two ways to get a download link for it:

- **Marketplace bots (no account needed).** `ListPublicGrokBotMarketplaceListings` with
  `{"pageSize":100,"pageToken":""}` lists every public bot with its `shareId` and `slug`. Then
  `GetPublicGrokBotMarketplaceListing` with `{"slug":"..."}` returns `templateGetUrl`, a download
  link that works for 15 minutes.
- **Every other bot (sign-in needed).** `GetGrokBotTemplateImportDetails` with `{"shareId":"..."}`
  and the header `Authorization: Bearer <token>` returns `blobGetUrl`. This is the same call the
  Grok Bot app makes. Without a token, the answer is HTTP 401 `unauthenticated`.

A recipe looks like this. The Grok Bot app checks it with zod, and `src/grok/recipe.js` checks the
same fields:

```jsonc
{
  "profile": {
    "name": "Overheard",
    "title": "Overheard",
    "description": "Standing instructions (the bot's Description field)",
    "avatarColor": "orange",   // black|brown|red|orange|yellow|green|cyan|blue|violet|magenta|gray
    "avatarShape": "teardrop"
  },
  "skills":   [{ "name": "...", "description": "Use when ...", "content": "# Markdown body" }],
  "routines": [{ "name": "...", "slug": "...", "description": "cadence + purpose", "content": "prompt" }],
  "memory":   [{ "kind": "profile" /* or "log" */, "createdAt": "2026-09-03", "content": "..." }],
  "plugins":  [{ "pluginId": "674", "name": "Slack", "description": "..." }],
  "gettingStarted": { "skill": "<name of one of the skills>" }  // optional
}
```

Routines have no schedule that a program can read. When a routine has one, it's only written in its
description (for example "Cron 44 8 * * 1-5").

### 4. Signing in

A Grok Bot account is a Cursor account. grokport signs in the way Cursor's own command-line tools
do:

1. Make a random `verifier`, and set `challenge = base64url(sha256(verifier))`.
2. Open `https://cursor.com/loginDeepControl?challenge=...&uuid=...&mode=login&redirectTarget=cli`
   in the browser.
3. Keep calling `GET https://api2.cursor.sh/auth/poll?uuid=...&verifier=...`. It answers 404 until the
   person approves the sign-in, and then `{ accessToken, refreshToken }`. grokport asks every second
   at first, slows down to every 5 seconds, and gives up after about 12 minutes.
4. When the access token has less than 5 minutes left, get a new one with
   `POST https://api2.cursor.sh/oauth/token` and
   `{"client_id":"KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB","grant_type":"refresh_token","refresh_token":"..."}`.
   If that answers 400, 401 or 403, grokport forgets the sign-in.

grokport saves the tokens in `~/.grokport/auth.json` (mode 600, so only your user can read it) and
only ever sends them to `api2.cursor.sh`. `npx grokport logout` deletes the file.

## How updates keep your files

Every file grokport writes ends with a note that names the bot it came from:

```html
<!-- generated by grokport from https://x.ai/bot/<shareId>. Reinstalling replaces this file. -->
```

`SKILL.md` also lists the skill and routine files grokport wrote (`<!-- grokport files: [...] -->`).
When you install again, grokport deletes only those files and then writes the new ones, so anything
you added to the folder stays. If a file has no note, or its note names a different bot, grokport
leaves it alone and says so. `src/bundle.js` owns this format and `src/install.js` uses it.

## Testing without Grok Bot

`npm test` never goes online. `test/cli.test.js` runs the real command against a fake Grok Bot
server on your own computer by setting `GROKPORT_API_URL`. That setting replaces
`https://api2.cursor.sh` everywhere grokport uses it, but only when it points at your own computer
(`localhost`, `127.0.0.1` or `[::1]`). That way a stray setting can't send your sign-in anywhere
else.

To check that the real Grok Bot still works the same way, install a marketplace bot into an empty
folder:

```sh
node bin/grokport.js https://x.ai/bot/NIEguoGUjA648fUPle8F5 --to folder -y
```

## Finding the API again after a Grok Bot update

Unpack the Grok Bot app:

```sh
# Windows: %LOCALAPPDATA%\Programs\Grok Bot\resources\app.asar
# macOS:   /Applications/Grok Bot.app/Contents/Resources/app.asar
npx @electron/asar extract "<path to app.asar>" grokbot-app
```

Then search:

- `dist/electron-main/proto.cjs` for `aiserver.v1.GrokBotService`. It lists every call and the
  fields each one sends and returns.
- `dist/electron-main/main-app.cjs` for `getPublicTemplate`, the code behind **Add to Grok Bot**,
  and for `gettingStarted`, to find where the recipe format is checked.
