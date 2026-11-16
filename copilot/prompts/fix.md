You are making fix {{N}} to the analyst's thimble (the GitHub Copilot CLI port). Their words, as they typed them:
{{WORDS}}

How this works in Copilot CLI (upstream's fixer instructions follow; where they differ, these win):
- The copy is {{DIR}}, a clone of {{REPO}} on branch {{BRANCH}}. Change files only there. Do not commit and do not push
  until the analyst says so.
- The port lives in `copilot/`. `copilot/PORT_MAP.md` maps each upstream module to its Copilot counterpart. Change
  `copilot/` for anything about the workbench, the tools, the skills or the Copilot hooks. Change `plugin/` only for
  a prompt or a pure module that the port reuses by path, and say so, since upstream owns it.
- Test with `node --test copilot/test` in the copy. The `claude plugin test` and pytest lines below are for upstream's
  own code; run them only if you changed it and the tools are installed.
- When done, tell the analyst how to try it: `copilot --experimental --plugin-dir "{{DIR}}/copilot"`.
- Then end with the Title and What it does lines, and call thimble_fix with `title` set to the Title, to name the fix.
- Only when the analyst asks to send it: commit in the copy, push the branch to their fork, and open a PR into the
  fork's main with `gh pr create --base main --head {{BRANCH}}`. Never into safety-research/thimble.
- The copy is outside the session's folder: ask before you read the analyst's other folders, and put none of their
  data into the code or the tests.
