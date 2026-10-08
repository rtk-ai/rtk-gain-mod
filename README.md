# rtk-gain: RTK's token savings, live in Claude Code

A Claude Code mod that shows what [RTK](https://github.com/rtk-ai/rtk) saves while Claude works: one bar for the commands (planned, used, saved), one for the context window broken down by category, and a viking who breaks the saved tokens with a different animation each time.

[Français](README_fr.md)

![A viking strikes three commands in a real session: bow, raven, lightning](docs/screens/viking-session.gif)

Tested with Claude Code 2.1.290 in the terminal. Mods need Claude Code 2.1.287 or later in the terminal, 2.1.286 in the Desktop app.

## What you see

Three places in Claude Code:

- **The pane**, opened with `/rtk-gain`: the viking, both bars with their legends, and the last commands with each one's own saving. `/rtk-gain` again, or Esc, closes it.
- **The band above the prompt**: one line, always visible once a command has gone through rtk.
- **The spinner**: the running saving at the end of the line while Claude works, and a line under each answer with the turn's saving.

Reading the bars:

- **Commands**: the whole bar is what was planned (what the commands would have returned without RTK). Blue is what was used, green is what was saved.
- **Context**: what fills the context window, by category (the four largest, the rest folded into "other"), as Claude Code counts it for `/context`. The hatched part extends the bar by what RTK kept out: "without RTK", the context would be the sum of the two.

![End of a turn: 34.8k planned, 8.5k used](docs/screens/05-end-of-turn.png)

In that turn, RTK kept 26.2k tokens out of the context: 79.7k instead of 106k.

## The viking

At the top of the pane, a pixel-art viking breaks the tokens: two pixels per terminal cell (the `▀` character, its color for the top pixel, its background for the bottom one).

While a command runs he waits, weapon raised, in front of a grey block. When it returns, he strikes the command's block at the cut between what was kept (blue) and what RTK saved (green), and the saved part is destroyed. The command's name and its saving show above.

There are fifty animations, ten attacks times five ways the saved part goes:

| Attacks | Effects |
| :- | :- |
| axe, hammer, sword, spear, torch, twin axes, thrown axe, bow, lightning, raven | shards, explosion, melt, dust, swept |

One is drawn at random for each command, never the same attack or effect twice in a row. A big saving leans toward the loud effects (shards, explosion, swept), a small one toward the quiet ones (melt, dust); all fifty stay possible.

The viking shows in the terminal only: text in the Desktop app need not be monospaced, and the drawing would come apart there.

## Screenshots

All taken in a real Claude Code 2.1.290 session, on a clone of the `rtk` repository, with the RTK hook installed. Claude ran `git log -30`, `git diff HEAD~10`, `git show HEAD~3`, `git log --stat -8` and `git status`.

| | |
| :- | :- |
| ![The pane when it opens](docs/screens/01-opening.png) | ![git diff running](docs/screens/02-command-running.png) |
| 1. `/rtk-gain` when it opens: the viking at rest, the starting context, no command yet. | 2. Claude runs `git diff`: the viking readies his attack, the command shows as running. |
| ![The strike](docs/screens/03-strike.png) | ![After the commands](docs/screens/04-after-commands.png) |
| 3. `git diff` returns: the strike lands on the cut and the bars move toward their new values. | 4. After the commands: `git diff` 31.8k → 6.7k (−79%), `git log` 2.9k → 1.8k (−38%). |

## Install

You need Claude Code 2.1.287 or later, `rtk` in your `PATH`, and the RTK hook installed (`rtk init -g`): without the hook no command goes through RTK, and the pane says so.

From the marketplace in this repository:

```text
/plugin marketplace add rtk-ai/rtk-gain-mod
/plugin install rtk-gain@rtk
```

Or for one session, without installing:

```bash
git clone https://github.com/rtk-ai/rtk-gain-mod.git
claude --plugin-dir ./rtk-gain-mod
```

Then, in the session, run `/rtk-gain` and ask Claude for a few commands (`git log`, `git diff`, `cargo test`). `/plugin` shows `1 mod active · rtk-gain` when the mod is loaded.

A mod is code that runs with your permissions. This one reads `rtk gain`, Claude Code's own context figures and, when present, the RTK proxy's database; `claude plugin validate` lists every call it makes before you install it.

## Settings

All by environment variable:

| Variable | Effect |
| :- | :- |
| `RTK_GAIN_LANG=<code>` | Forces the language: `en`, `zh`, `hi`, `es`, `ar`, `fr`, `bn` or `pt` |
| `RTK_GAIN_VIKING=0` | Removes the viking from the pane |
| `RTK_GAIN_ANIMATION=<attack>:<effect>` | Pins an attack, an effect or both, such as `hammer:melt`, `raven` or `:dust` |
| `RTK_PROXY_DB=<path>` | The RTK proxy's database, when it is not in the usual place |

## Languages

The mod speaks the eight most spoken languages in the world ([Ethnologue](https://www.ethnologue.com/faq/ten-largest-languages/), total speakers): English, Mandarin Chinese (simplified), Hindi, Spanish, Arabic, French, Bengali and Portuguese.

The language is detected. The first source that names one of the eight wins:

1. `RTK_GAIN_LANG` (`fr`, `pt_BR`, `spanish`…)
2. Claude Code's `language` setting (`"language": "french"` in `settings.json`)
3. `LC_ALL`, `LC_MESSAGES`, then `LANG` (`C.UTF-8` and `POSIX` don't count)
4. on macOS, the system language, often the only clue when `LANG` is `C.UTF-8`
5. otherwise English

Every text goes through `hooks/lib/i18n.js`, including the categories `/context` names in English. Numbers follow the language (`48.2k`, `48,2 k` in French, `48,2k` in Spanish and Portuguese), in Western digits everywhere.

Good to know:

- The translations were not written by native speakers: corrections are welcome, especially for Hindi, Arabic and Bengali.
- **Arabic**: a terminal without bidirectional text support draws the letters left to right.
- **Hindi and Bengali**: combining marks count for zero columns; depending on the terminal font, the numbers column can shift by a character.

## How it works

A mod is a JavaScript plugin that runs inside Claude Code ([official documentation](https://code.claude.com/docs/en/plugins/mods/overview)). This one is a few files:

```text
.claude-plugin/plugin.json        manifest
.claude-plugin/marketplace.json   lets people install it with /plugin install
hooks/hooks.json                  points to register.js
hooks/register.js                 the hooks and the calls to Claude Code
hooks/lib/                        the model, the drawing, the viking, the translations
```

Where the numbers come from:

1. Claude runs a command. The mod sees it go by (`tool.call` on `Bash`), picks the viking's attack and shows the command as running.
2. The RTK hook rewrites it (`git diff` becomes `rtk git diff`) and RTK records what the command would have returned and what it returned.
3. When it returns, the mod reads `rtk gain --format json --project` again. The difference with the previous reading is the command's saving; the difference with the session's first reading is the session's saving.
4. The mod animates the bars toward the new totals (12 frames, 0.4 s) while the viking strikes (24 frames, 0.8 s).

The mod cannot measure by itself: settings hooks, RTK's included, run after mods, so it sees a command before it is rewritten and only its filtered output afterwards. The numbers come from RTK.

The context comes from Claude Code (`$.session.usage({ breakdown: 'summary' })`, the same breakdown as `/context`, estimated locally with no request).

## With the RTK proxy

When RTK's LLM proxy is running and has written to its database since the session started, the pane adds a "PROXY" section: what the proxy removed from the requests, by stage, and the breakdown of the latest request (tool results, tool call arguments, the rest, duplicates). The pane then reads "hook + proxy".

The mod reads the proxy's database read-only with `sqlite3`. It looks for `~/Library/Application Support/rtk/llm-proxy/rtk-proxy.db` (macOS), then `~/.config/rtk/llm-proxy/rtk-proxy.db`.

## Tests

```bash
claude plugin validate .   # what Claude Code reads from the mod: hooks and calls
claude plugin test         # 53 tests, no session and no network
```

The tests stand in for Claude Code: `rtk gain` output, the context breakdown, proxy rows, the clock. They cover the band, the pane (terminal and Desktop), the bars frame by frame, the line under an answer, a missing rtk, the proxy section, the eight languages, and the viking: each of the fifty animations is played through, and the random draw is checked to reach every one.

## Known limits

- **Two sessions on one project** mix their numbers: `rtk gain --project` counts by directory, not by session.
- **Estimated tokens**: RTK counts bytes / 4, with no tokenizer. Percentages are reliable, absolute values approximate; the pane says so.
- **Where it draws**: the terminal and the Desktop app. Nothing in the VS Code extension's panel or in a cloud session; `/rtk-gain` then answers with one line of text.
- **A command that chains several** (`git log && git status`) shows as one line, with the number of RTK commands: `git log +1`.
- **Desktop**: drawn with the same elements as the terminal and covered by the tests, not yet looked at in the app.

## License

Apache-2.0, like RTK. See [LICENSE](LICENSE).
