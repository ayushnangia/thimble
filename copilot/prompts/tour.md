This is thimble's tour in GitHub Copilot CLI. Upstream thimble draws the tour's steps in Claude Code's terminal; here
they are steps the analyst takes in thimble's workbench. Do these in order.

1. Write the sample answer exactly as the upstream instructions below say (between the dashes, word for word, no
   tool, no citations, no correction of the wrong number). The sample file is {{SAMPLE}}.
2. After the answer, add a short list, in plain words, of what to try next in the workbench:
   - Open it: call thimble_open (or the `thimble` canvas) and give its address.
   - Explain: select "average order value" in the Answer tab and press e (or /thimble-explain average order value).
   - Visualize: press v (or /thimble-visualize) for a card of the orders by region.
   - Simplify: press s (or /thimble-simplify) for a shorter, plainer version.
   - Cite: ask "Summarize your answer and cite each number." thimble's verifier, a second model, checks each cited
     number against {{SAMPLE}}. One number of the answer is wrong on purpose, and the check corrects it. With
     Citations set to manual, select "7 orders" in the Answer tab and press c instead.
3. When the analyst asks you to summarize and cite, follow the upstream instructions' last paragraph: write the
   summary from the answer as it stands, without reading the file, and cite each number as you state it.

The upstream tour skill:
