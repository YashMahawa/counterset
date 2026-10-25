# Design direction and review

## Direction

Dealt by the taste skill (`draw.mjs`, seed 1112188232): **dense-tiles, "the well-kept board"**, Soot and lime palette. Chosen over `type-only-statement` and `borrowed-category` because a festival timetable already is a board of tiles fitted edge to edge.

Idea: *on this page, the festival timetable's sets become the board's tiles.* The run sheet is a departure board whose open row turns lime; the timetable is filled tiles separated by gaps, never lines; the public page's hero is a sheet of Counterset's own interface frames with one text cell.

One substitution, with its reason: the dealt General Sans loads from Fontshare, which the strict same-origin CSP and self-hosting rule out. The bundled Public Sans (SIL OFL) plays the sheet's "one grotesk in two weights". The earlier concert-poster direction and its condensed display face were retired.

## Studio

The first redesign (dark, many hairlines, every cue drawn as a curve, 11px labels, lock icons) read as messy. The current studio applies the board rules: filled tiles on 8px gaps, no rules or outlines, one radius, type no smaller than 13px, five size steps, lime only for actions, moved sets and the open chapter, orange only for clashes. Threads are drawn only for clashes and the current selection; "All cues" shows the full graph and is switched on automatically in the evidence chapter, where the threads draw in.

Motion carries state, never decoration: sets slide between the draft, each option and its without-Qloo counterfactual (same elements, 720ms), outlines mark where moved sets were, holds drop into their lane, the evidence threads draw in once, the random-fill histogram grows, and approval stamps the grid. Reduced motion keeps every state and drops the travel. A real bug found in a recording (the hold block flew in diagonally because its animation overrode its position) was fixed by positioning holds with left/top.

## Public page

Sections follow the dealt blueprints: sheet with a text cell (hero), rows as a board (real Lollapalooza pairs; open any row: the page's live thing), one card in four fields (one set through read, change, repair, approve), large marks on tiles (measured numbers, including the unflattering 70%), an accordion of filled tiles, and the action tile. Every image is a capture of Counterset; the moving picture is a real screen recording of the studio toggling the draft, Option A and the same repair without Qloo.

## Gate results

`lint.mjs`: 0 FAIL, 0 WARN. `inspect.mjs` at 1440, 768 and 390px: 0 FAIL, 1 WARN. The remaining warning (`card-rows`) points at the hero's sheet of frames and the four copies of one card in "One set, four moments"; both are what the dealt blueprints call for.

Look rounds (screenshots in `.taste-skill/inspect/`, not committed):

1. Hero was a collage of tall chapter crops with small grids and an empty band; board slot text wrapped; the proof board left an orphan tile. Fixed by wide columns for grid captures, a smaller slot size, and a full two-row proof board.
2. Claim at 30px was read as a six-line headline; the panel button wrapped; phone proof tiles overflowed. Fixed: wordmark is the single headline, claim at the supporting size, tiles use `minmax(0, 1fr)`.
3. The first screen ended 120px short. Fixed by cropping wide frames to 4:3, which also makes the grids legible.

Self-assessed after round 3 (not an independent jury): design 7.5, usability 8, creativity 7.5, content 8. Remaining soft spots: narrow hero columns end above the fold line; set names in 30-minute sets are clipped on desktop (full names are in each set's title and the inspector); the multi-arts rehearsal grid is illustrative.
