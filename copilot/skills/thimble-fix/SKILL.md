---
name: thimble-fix
description: "Ask for a fix to thimble itself, from the person's words: Copilot changes thimble's code in a copy of the repository, and the person tries it before anything is sent. Use when the person types /thimble-fix <what should work differently>, or /thimble-fix N <words> to change fix N, or /thimble-fix list."
---

The person's words: $ARGUMENTS

- `list`: call `thimble_fix` with `list: true` and show the fixes (number, title, folder).
- Words that start with a number N: they change fix N. Call `thimble_fix` with `fix` set to N and `words` set to the rest, as typed.
- Other words: call `thimble_fix` with `words` set to them as typed (a new fix, unless they are plainly about an earlier fix; if you cannot tell, ask in one short line first).
- No words: ask the person in one short line to say it with /thimble-fix <what should work differently>.

Then follow what `thimble_fix` returns: make the change in the copy it names, test it, and tell the person how to try it. Never commit, push or open a pull request unless the person asks, and then only into their own fork.
