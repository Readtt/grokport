# grokport

Paste a Grok Bot link, and grokport adds that bot to Claude Code, Codex, Cursor and the other coding
agents you use.

For example, this adds Overheard, a bot from the Grok Bot marketplace:

```sh
npx grokport https://x.ai/bot/NIEguoGUjA648fUPle8F5
```

grokport downloads the bot (its instructions, skills, routines and memory) and saves it as an
[Agent Skill](https://agentskills.io). That's a kind of folder most coding agents know how to read.
You need Node.js 20.12 or newer. There is nothing else to set up.

## How to use it

1. Copy a bot's link. It looks like `https://x.ai/bot/...`.
2. Run `npx grokport` and paste the link after it.
3. Pick your agents. The ones on your computer are already ticked.
4. If an agent was already open, close it and open it again.
5. Start the bot in your agent:

| Agent              | How to start the bot                                        |
| ------------------ | ----------------------------------------------------------- |
| Claude Code        | type `/bot-name`, or run `claude --agent bot-name`          |
| Codex              | type `$bot-name`                                            |
| Cursor             | type `/bot-name`                                            |
| Gemini CLI         | ask for the bot by name                                     |
| OpenCode           | ask for the bot by name, or run `opencode --agent bot-name` |
| GitHub Copilot CLI | type `/bot-name`                                            |
| Grok CLI           | type `/bot-name`                                            |

`bot-name` is the bot's name in lowercase, with dashes instead of spaces. Overheard becomes
`overheard`, and a bot called Exam Prep becomes `exam-prep`. When grokport is done, it shows you how
to start the bot in each agent.

If you'd rather have the files, pick **Save a copy here**. You get a folder you can change or share.

### Skip the questions

```sh
npx grokport <link> --to claude,cursor -y
```

After `--to` you can list `claude`, `codex`, `cursor`, `gemini`, `opencode`, `copilot`, `grok` and
`folder` (a copy in the folder you're in). If you leave out `--to`, `-y` uses every agent on your
computer, or saves a copy here if it finds none.

### Update a bot

Run the same command again. To make sure you also have the newest grokport, run
`npx grokport@latest <link>`.

### Remove a bot

```sh
npx grokport remove overheard
```

Use the bot's name or its link. Run `npx grokport remove` on its own to pick from the bots grokport
added. grokport shows you what it will delete and asks first. Add `-y` to skip that question.

grokport removes the bot from all your agents at once. Some agents read the same skill folder, so it
can't take a bot out of just one of them. That's why `--to` doesn't work with `remove`. Restart any
agent that was already open.

## Private bots need a sign-in

Bots in the Grok Bot marketplace work without an account. Other bots are shared privately, by link,
and Grok Bot only hands those over to people who are signed in.

For a private bot, grokport asks to open your browser so you can sign in to Grok Bot. It remembers
the sign-in for next time. You can also sign in before you start:

```sh
npx grokport login
```

grokport saves your sign-in in `~/.grokport/auth.json`. Only you can read that file, and grokport
only sends it to Grok Bot. To delete it, run:

```sh
npx grokport logout
```

## Only add bots you trust

Most bots are made by other people, and a bot can do anything your agent is allowed to do.

## What you get

Each bot becomes one folder:

```
bot-name/
  SKILL.md        who the bot is, its instructions, what it remembers, and a list of the other files
  skills/*.md     one file for each of the bot's skills
  routines/*.md   one file for each routine (a routine runs when you ask, not on a timer)
```

grokport puts this folder where each agent looks for skills. When agents look in the same place,
they share one copy.

If you pick both Claude Code and Codex, grokport has to save two copies, because those two agents
look in different places. Cursor, OpenCode and Grok CLI look in both places, so they may show the
bot twice.

Claude Code and OpenCode also get a small agent file. With it, the agent acts as the bot for the
whole chat.

## What grokport won't touch

grokport never writes over a file it didn't make. It also won't replace a different bot that has the
same name. In both cases it leaves the file alone and tells you.

When you update a bot, grokport replaces the files it made last time, so any changes you made to
those files are lost. Files you added to the folder yourself are kept.

Removing a bot works the same way. grokport only deletes the files it made for that bot. Files you
added stay, and so does the folder they're in. If you add the bot again later, its files go back into
that folder next to yours. grokport also leaves copies alone, both a copy you saved with **Save a copy
here** and a bot folder you copied under another name. Delete those yourself if you don't want them.

## How it works

Grok Bot doesn't offer an official way for other apps to get bots. grokport asks Grok Bot's servers
for the bot the same way the Grok Bot app does when you press **Add to Grok Bot**. If Grok Bot
changes how that works, grokport can stop working until it gets an update, so please
[open an issue](https://github.com/Readtt/grokport/issues) when that happens.
[docs/how-it-works.md](docs/how-it-works.md) has the details and says where to look when something
breaks.

grokport is not made by or connected to xAI, SpaceXAI or Cursor.

## Working on grokport

```sh
git clone https://github.com/Readtt/grokport
cd grokport
npm install
npm test
node bin/grokport.js <link>
```

```
src/grok/          talks to Grok Bot: reads links, downloads bots, signs in
src/bundle.js      turns a bot into a skill folder
src/harnesses.js   where each agent looks for skills
src/install.js     writes the files, but only over its own
src/remove.js      removes a bot, but only the files it made
src/cli.js         the command you run (args.js and open-url.js help it)
src/slug.js        makes names for folders and files
src/text.js        cleans up text that other people wrote
```
