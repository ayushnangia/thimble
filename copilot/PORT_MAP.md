# PORT_MAP: upstream thimble → Copilot CLI port

Upstream thimble (`plugin/`) is a Claude Code plugin. Most of it is TypeScript run by Claude Code's internal Register API (`$.ui`, `$.state`, `$.model`, panes, keys, `ui.render` hooks), which Copilot CLI does not have. The port (`copilot/`) uses Copilot's extension SDK instead (`joinSession`: tools, hooks, session events, `createCanvas`) and a web workbench.

Rules the port keeps, so that a daily upstream merge rarely conflicts:

1. Copilot files live only in `copilot/` and `.github/workflows/copilot-*.yml`. The one upstream file the fork edits is `README.md`, with a section appended at its end.
2. Pure upstream modules (`.mjs`/`.js` that need no `$`) and every prompt are **reused by path**: `lib/upstream.mjs` `importUpstream('<path under plugin/>')` and `lib/prompts.mjs` `upstreamText('<prompt>')`. Never copy them.
3. Each upstream path the port reads is listed in `lib/upstream.mjs` `REQUIRED`, `lib/prompts.mjs` `USED` or `lib/server.mjs` `UPSTREAM_FILES`. `test/upstream.test.mjs` fails, naming the path, when upstream renames or removes one.

Status: **reused** = imported or read from upstream at run time, unchanged. **ported** = reimplemented in `copilot/` with the same behavior. **partial** = reimplemented with less. **not ported** = left out, with the reason.

## When upstream changes (for the agent fixing an `upstream-sync` issue)

1. Read the issue: the upstream commit range and the conflict list or failing test output.
2. `git log -p <range> -- plugin/` and find each changed upstream file in the tables below.
3. **reused** file renamed or moved: update its path in `REQUIRED`/`USED`/`UPSTREAM_FILES` and in the `importUpstream(...)` call. Changed exports: update the caller named in the table.
4. **ported** or **partial** file changed: apply the same behavior change to the Copilot counterpart named in the table. Keep the Copilot version's structure; do not import TypeScript.
5. New upstream feature: add a row here, and port it if it can run in Copilot (tools, hooks, canvas), else mark it not ported with the reason.
6. Upstream added a new prompt slot with a terminal-only wording: add a Copilot wording in `lib/prompts.mjs` `COPILOT_SLOTS` if the text names Claude Code's keys or panes.
7. `cd copilot && node --test test/` must pass. A merge conflict can only be in `README.md` (keep both, the Copilot section last).

## Prompts (`plugin/prompts/`)

| upstream | status | used by |
|---|---|---|
| registry.mjs, slots.json | reused | `lib/prompts.mjs` composes every upstream text with upstream's own registry (`compose`, `fill`, `fileOf`); `COPILOT_SLOTS` overrides the `terminal` slot values that name Claude Code's UI |
| main.md (includes thimble.md, communicating.md, citing.md, guidance-cards.md, labels.md …) | reused | `lib/guidance.mjs` → session start and prompt hooks, plus `prompts/tools.md` (the port's tools) |
| guidance.md, guidance-labels.md, labels-off.md | reused via main.md's includes | `lib/guidance.mjs` drops the `## ` section of each feature that is off, as upstream `guidance.ts` does |
| checker.md | reused | `lib/citations.mjs` `checkerPrompt`, plus `prompts/checker-copilot.md` (read files with view/grep, the JSON reply) |
| observer.md, observer-turn.md, lens-explain.md, lens-heads.md, lens-claims.md, explainer.md, heads-up.md | reused | `lib/observer.mjs` through upstream `observer/compose.mjs` and `observer/lenses.mjs` |
| squeeze.md | reused | `lib/side.mjs` simplify and catch-up |
| explain-expand.md | reused | `lib/side.mjs` explain |
| thread.md | reused | `lib/side.mjs` side threads |
| card-tool.md | reused | `lib/tools.mjs` `thimble_card` description |
| designer.md | reused | `lib/tools.mjs` `thimble_visualize` |
| fixer.md, fix-request.md | reused | `lib/fixes.mjs`, with `prompts/fix.md` for what differs in Copilot (clone, `--plugin-dir`, `gh pr create`) |
| card-check.md, card-criteria.md, artifact.md, notices.md, reapply.md | not ported | the card check fork, artifacts and repairs need `$.model` forks of the conversation and the srt card runner |
| prompts.ts, node.mjs | not ported | loaders for Claude Code / the kernel; `lib/prompts.mjs` is the Copilot loader |

## Modules

| upstream | status | Copilot counterpart / reason |
|---|---|---|
| `.claude-plugin/plugin.json` userConfig | ported | `plugin.json` (Copilot manifest); options from `settings/features.mjs`, stored in `~/.thimble-copilot/settings.json` (`lib/settings.mjs`) |
| `hooks/register.ts`, `hooks/path.ts`, `hooks/turnover.ts`, `hooks/conversation.ts` | ported | `lib/main.mjs` `hooksFor` + session events; one store per Copilot session id (`lib/store.mjs`) |
| `hooks/hooks.json`, `hooks/temp-allow.sh`, `hooks/temp_allow.py` | ported | `lib/main.mjs` `onPreToolUse` allows view/grep/glob/create/edit on paths inside the OS temp folder |
| `hooks/watch.ts`, engine `coverage.py`, `shellcmd.py` | partial | `lib/coverage.mjs` counts lines read by view, files searched by grep/glob, and shell commands (counted, not parsed) |
| `hooks/keys.ts`, `core/selection.ts` | ported | workbench keys v s c e a t b r l w and the selection bar (`ui/workbench.js`); slash commands (`skills/thimble-*`) in the terminal |
| `hooks/handoff.ts`, engine `handoff.py` | not ported | Copilot has no Bash sandbox that blocks thimble's home |
| `guidance/guidance.ts` | ported | `lib/guidance.mjs` |
| `settings/features.mjs` | reused | `lib/settings.mjs` (switches, choices, modes, `featuresOf`) |
| `settings/term.ts`, `panes/settings.tsx` | ported | `thimble_settings` tool, `/thimble-settings` skill, Settings tab |
| `core/models.js` | reused | `lib/settings.mjs` model choices; `checkerModel` `same` = the session's model |
| `core/text.js` | reused | served to the workbench (`UPSTREAM_FILES`) |
| `core/answers.mjs`, `core/answers.ts`, `answerview.ts`, `rowhook.ts`, `turn.ts`, `env.ts`, `home.ts`, `layout.mjs`, `feed.ts` | ported | `lib/store.mjs`, `lib/transcript.mjs`, `lib/main.mjs` (turn count, answers, `~/.thimble-copilot/sessions/<id>.json`) |
| `core/forks.ts`, `core/why.js` | ported | `lib/model.mjs`: a child `copilot -p` with read-only tools stands in for `$.model` forks of the conversation; the transcript is passed in the prompt |
| `core/host.ts`, `core/theme.ts` | ported | the canvas always draws; the workbench follows the browser's light/dark scheme |
| `core/pane.ts`, `core/trail.mjs` | ported | workbench tabs (`ui/workbench.js`) |
| `core/tell.ts`, `marks/notices.mjs` | partial | `lib/main.mjs` `verdictNews`: verifier results are told to the agent with the next prompt; no repair requests |
| `core/engaged.*`, `core/askcell.js` | not ported | depend on Claude Code's on-screen rows |
| `bar/*` (bar.tsx, counts.ts, busy.ts, hints.ts, intro.ts, notice.ts, register.ts) | partial | `statusline.mjs` (opt-in `statusLine` command), counts in the workbench header, failures via `session.log` |
| `marks/message.js` | reused | `lib/citations.mjs` (`marksIn`, `sentenceOf`) and the workbench (`marksIn`, `cardRef`) |
| `marks/register.ts`, `marks/store.ts`, `marks/cite.ts` | ported | `lib/citations.mjs` `recordMarks`/`recordAsked`, `thimble_cite`, `/thimble-cite`, Citations tab |
| `marks/checker.ts`, engine `validate.py`, `evidence.py` | partial | `lib/citations.mjs` `verify`: the verifier model reads the files and returns verdicts with evidence; the deterministic Python re-check of evidence is not run |
| `marks/evidence.tsx`, `marks/view.ts`, `marks/table.mjs` | ported | Citations and Answer tabs |
| `marks/stale.ts` | not ported | needs the validator's source fingerprints |
| `observer/compose.mjs`, `lenses.mjs`, `messages.mjs`, `reply.mjs` | reused | `lib/observer.mjs` |
| `observer/observer.ts` | ported | `lib/observer.mjs` `observe`, run on `session.idle` (`lib/main.mjs` `afterAnswer`) |
| `explain/lens.mjs`, `explain/place.mjs`, `claims/lens.mjs` | reused through `observer/lenses.mjs` | |
| `explain/seam.ts`, `explain/expand.ts` | ported | heads-ups and explainers in the Notes tab; `thimble_explain`, `thimble_headsup`, `/thimble-explain` |
| `claims/store.js`, `claims/graph.js` | partial | `lib/observer.mjs` `mergeClaims`, Claims tab (clusters, not the graph drawing) |
| `claims/pane.tsx`, `seam.ts`, `term.ts` | ported | Claims tab, `thimble_claim` |
| `squeeze/chips.mjs` | reused | `lib/side.mjs` (levels, `readReply`, `catchUpText`) |
| `squeeze/seam.ts`, `term.ts`, `ui.ts`, `cards.ts`, `settings.json` | partial | `thimble_simplify`, `thimble_catchup`, Answer tab; one level per request, no chip row |
| `threads/threads.mjs` | ported | `lib/side.mjs` `askThread`, Threads tab |
| `threads/thread.ts`, `pane.tsx`, `seam.ts` | ported | `thimble_ask`, `/thimble-ask`, `/thimble-threads` |
| `cards/tool.ts`, `cards/store.ts`, `cards/register.ts`, `cards/copy.*` | ported | `lib/cards.mjs`, `thimble_card`, Cards tab |
| `cards/runner.mjs`, `layout.js`, `space.js`, `drawn.js`, `client.tsx`, `draw.ts`, `fit.ts`, `head.ts` | ported | `ui/frame.html` runs the same view API (Box/Text/Button, palettes, state, keys, `TAIL`) in the DOM inside `<iframe sandbox="allow-scripts">` with `default-src 'none'` |
| `cards/argv.mjs`, `cards/ask.ts`, `sandbox/*` | not ported | Anthropic's sandbox runtime; the browser iframe sandbox replaces it |
| `designer/v.ts` | partial | `thimble_visualize` asks the main agent to draw a card (upstream's designer.md), not a background fork |
| `labels/ledger.mjs`, `labels/pane.tsx` | partial | Labels tab lists the labels and their counts |
| `labels/*.ts`, `labelreads.mjs`, `use.*`, engine `labels.py`, `regextext.py`, `estimate.py` | partial | `thimble_label` records labels the agent's own code computed; the kernel's regex/prompt label runs are not ported |
| `panes/coverage-view.mjs` | reused | workbench Coverage tab (`pct`) |
| `panes/coverage.tsx` | ported | Coverage tab, `/thimble-coverage` |
| `tray/*` | ported | the workbench's selection bar and the Citations/Notes tabs |
| `fix/*`, engine `fixes.py`, `share.py`, `privacy.py` | partial | `lib/fixes.mjs`, `thimble_fix`, `/thimble-fix`: clone, branch, fixer prompt, `gh pr create`; no privacy scan, zip or `thimble file issue` |
| `tour/tour.ts`, `skills/tour/SKILL.md`, `tour/sample/*`, engine `tour.py` | ported | `thimble_tour`, `/thimble-tour`, reading upstream's SKILL.md and sample by path |
| `skills/fix-thimble` | ported | `skills/thimble-fix` |
| `bin/thimble`, engine `cli.py`, `install.py`, `releases.py`, `doctor.py` | ported | `scripts/update.(ps1\|sh)` (Copilot CLI and plugin updates), `scripts/doctor.(mjs\|ps1\|sh)` |
| engine `sources.py`, `refs.py`, `store.py`, `codebox.py` | not ported | the kernel's record refs; Copilot citations cite file lines |
| `telemetry/*` | not ported | no telemetry in the port |
| `types/index.d.ts`, `tsconfig.json`, `tests/*`, `test-home.mjs`, `conftest.py` | not ported | upstream's own types and tests; the port's tests are `copilot/test/` |

## Browser workbench (`browser/`)

not ported. Its FastAPI backend runs Claude through `claude_agent_sdk` (`browser/backend/app/model.py`), Claude Code sign-in or an Anthropic API key (`claude_access.py`, `llm.py`) and Claude Code's settings and plugin folders (`cc_settings.py`, `cc_plugin.py`). An adapter would replace the agent SDK with Copilot's, which is a second port. The Copilot canvas (`ui/`) is the port's workbench.
