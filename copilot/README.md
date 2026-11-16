# thimble for GitHub Copilot CLI

This folder ports [thimble](https://github.com/safety-research/thimble), by Matthew Joerke ([@mjoerke](https://github.com/mjoerke)) and licensed Apache-2.0, from Claude Code to [GitHub Copilot CLI](https://github.com/github/copilot-cli). It is a modified fork; see [NOTICE](NOTICE) and [LICENSE](../LICENSE). Bugs in the port belong in [ayushnangia/thimble](https://github.com/ayushnangia/thimble/issues), not upstream.

thimble helps you check what the agent tells you about your data:

| | Copilot command | workbench key | what it does |
|---|---|---|---|
| workbench | `/thimble-open` | | opens the thimble canvas (a local web panel) |
| visualize | `/thimble-visualize` | `v` | cards: charts and tables of the data behind an answer, drawn by generated code in a sandboxed iframe |
| simplify | `/thimble-simplify` | `s` | a shorter, plainer version of the last answer |
| cite | `/thimble-cite [words]` | `c` | cite words of the answer; a second model, the verifier, checks them against the lines of your files |
| explain | `/thimble-explain <term>` | `e` | a short note on a term |
| ask | `/thimble-ask <question>` | `a` | a side thread that does not touch the main conversation |
| threads | `/thimble-threads` | `t` | the side threads |
| catch-up | `/thimble-catchup` | `b` | what happened while you were away |
| coverage | `/thimble-coverage` | `r` | how much of each file the agent read |
| labels | `/thimble-labels` | `l` | labels and their values |
| claims | `/thimble-claims` | | the claims the answers rest on |
| settings | `/thimble-settings [key value]` | `w` | the same options as upstream's `/thimble-settings` |
| fix | `/thimble-fix <what should change>` | | change your own copy of thimble (see below) |
| tour | `/thimble-tour` | | a short guided tour on a sample file |

Copilot CLI has no key-binding API for extensions, so upstream's bar keys are slash commands (each `/thimble-*` is a skill) and keys inside the workbench. Heads-ups (notes on misleading details) and explainers come on their own after each answer when their settings are on.

## Install

Needs Copilot CLI 1.0.112 or later with experimental features on (extensions are experimental) and `git` on PATH. The CLI runs the extension itself; `node` (20+) on PATH is needed only for the status line, doctor and the tests.

```sh
copilot plugin install ayushnangia/thimble:copilot
copilot --experimental        # or turn experimental on once with /experimental
```

Then type `/thimble-open` (or ask "open thimble"). The extension serves the workbench on `127.0.0.1` at a random port, with a random token in the URL; without the token it answers 403. Copilot shows it as a canvas; you can also open the URL in a browser.

`copilot plugin install owner/repo:copilot` copies only this folder, while the port reads upstream's prompts and modules from `../plugin` by path. An installed plugin therefore keeps a sparse, shallow clone of the fork's `plugin/` folder in `~/.thimble-copilot/upstream` (made on first use, refreshed by the update script). Set `THIMBLE_UPSTREAM` to use another checkout.

To try a clone without installing:

```sh
git clone -c core.longpaths=true https://github.com/ayushnangia/thimble.git
copilot --experimental --plugin-dir thimble/copilot
```

### Status line (optional)

`statusline.mjs` prints a one-line thimble bar (cards, citations and their verdicts, notes, threads, files read, the modes). To show it under the prompt, add this to `~/.copilot/settings.json` yourself, with the plugin's folder (`copilot plugin list` shows where it is):

```json
"statusLine": { "command": "node /path/to/thimble/copilot/statusline.mjs" }
```

## Update

```sh
copilot update
copilot plugin update thimble
```

`scripts/update.ps1` (Windows) and `scripts/update.sh` (Linux, macOS) do both, install the plugin when it is missing, refresh the upstream cache, print the versions and exit nonzero on failure. They log to `%LOCALAPPDATA%\thimble-copilot\update.log` or `~/.thimble-copilot/update.log`, so a daily scheduled task or cron job can run them:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File <plugin>\scripts\update.ps1
```
```sh
bash <plugin>/scripts/update.sh
```

## Uninstall

```sh
copilot plugin uninstall thimble
```

thimble's settings, session state and the upstream cache stay in `~/.thimble-copilot` (or `THIMBLE_COPILOT_HOME`); delete that folder to remove them.

## Doctor

`scripts/doctor.ps1` or `scripts/doctor.sh` (or `node scripts/doctor.mjs`) checks Node, git, the Copilot CLI, the upstream root and every upstream file the port needs, the prompts, the settings file and the workbench server. `-Fetch` / `--fetch` makes the upstream cache when it is missing. Under a restricted PowerShell execution policy, run `powershell -ExecutionPolicy Bypass -File scripts\doctor.ps1` (same for `update.ps1`).

## How it works

- `com.github.copilot/extensions/thimble/extension.mjs` joins the session with `joinSession` from `@github/copilot-sdk/extension` and hands off to `lib/main.mjs`.
- Tools the main agent calls: `thimble_card`, `thimble_cite`, `thimble_verify`, `thimble_explain`, `thimble_headsup`, `thimble_label`, `thimble_claim`, `thimble_open`, `thimble_simplify`, `thimble_catchup`, `thimble_ask`, `thimble_visualize`, `thimble_tour`, `thimble_fix`, `thimble_status`, `thimble_settings`.
- Hooks: session start and each prompt add thimble's guidance (upstream `prompts/main.md` with the port's tools section, following the settings' modes); post-tool-use counts file reads for coverage; pre-tool-use allows file tools in the temp folder, as upstream's `temp-allow.sh` does.
- After each answer (`session.idle`), the observer (upstream's lenses and prompts) writes heads-ups, explainers and claims, and in `auto` citations mode the verifier checks new citations. Results go to the canvas, with one short line in the timeline.
- Second-model work (verifier, observer, simplify, explain, threads) runs in a child `copilot -p` with read-only tools (`view`, `grep`, `glob`), on the model from settings (`checkerModel`; `same` is the session's model).
- The canvas `thimble` has actions the agent can call too: `add_card`, `add_citation`, `add_note`, `add_claim`, `add_label`, `show_tab`, `get_state`.
- Cards run in `<iframe sandbox="allow-scripts">` (no same-origin, a CSP with `default-src 'none'`), never in the extension's process.
- Settings live in `~/.thimble-copilot/settings.json`; their names and choices come from upstream `settings/features.mjs`.

## Fixing thimble

`/thimble-fix <what should change>` clones the fork into `~/.thimble-copilot/fixes/N` on a branch `fix-N`, and the agent changes and tests it there with upstream's fixer prompt. Try the fix with `copilot --experimental --plugin-dir ~/.thimble-copilot/fixes/N/copilot`, then push the branch and open a pull request against `ayushnangia/thimble` with `gh pr create`.

## Keeping up with upstream

Everything Copilot-specific is in this folder and in `.github/workflows/copilot-*.yml`; upstream files are untouched except a section at the end of the top-level README. The port imports upstream code and prompts by path, so most upstream changes reach it with no edit.

- `.github/workflows/copilot-upstream-sync.yml` merges `safety-research/thimble` main into the fork's main daily, runs the tests below, and pushes only when the merge is clean and the tests pass. Otherwise it opens or updates the issue "upstream sync needs a fix" (label `upstream-sync`).
- [PORT_MAP.md](PORT_MAP.md) maps each upstream module to its counterpart here. Follow it to redo the port of a module that changed.

## Tests

```sh
cd copilot
node --test test/
```

No dependencies. The tests load the extension with a fake SDK, round-trip settings, check citations and the verifier's prompt with a mocked model, count coverage, check the server's token and the card sandbox, and check that every upstream path the port reads still resolves.

## Not ported

The browser workbench (`browser/`) talks to Claude through the Claude Agent SDK and Anthropic's API and runs Claude Code sessions, so it does not run on Copilot; the canvas above is the Copilot workbench. See [PORT_MAP.md](PORT_MAP.md) for the rest.
