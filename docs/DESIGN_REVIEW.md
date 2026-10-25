# Design direction and review

Both screens were redesigned with the taste skill after the previous dark "board" design was judged too crowded: every step, the timetable, the inspector and the narration competed on one screen, in saturated lime and orange at large sizes.

## Studio (app screen)

Dealt with `draw.mjs --app` (seed 444071102): **framed-sheet**, light. Chosen over `pastel-consumer` and `achromatic-ledger` because the timetable is a working canvas used in long sessions, the case this style was distilled from.

- **One shell redraw, with its reason:** the style's sidebar was dropped. Seven stages across ten hours need the full width, and six steps fit as underline tabs in the sheet. The tinted frame, 48px top bar and white inset sheet are kept.
- **One step at a time.** Each step is its own view: an h1 naming the step, one sentence stating that step's finding (computed from the data), a one-line explanation in guided mode only, and one primary action. Below the timetable, a single card holds the step's work on the left and the evidence for the current selection on the right.
- **Colour on data only.** Red marks a clash, teal a moved set, amber a stage hold, a dashed outline an unresolved act. The primary button is near-black. Threads are drawn only for clashes and the selection; "Show all pairs" is opt-in.
- **Its face:** IBM Plex Sans, self-hosted (the CSP forbids Google Fonts at runtime), with tabular figures in every table.
- **Phone:** short step labels, the timetable scrolls sideways inside its card with stage names pinned, and the panels stack.
- **Motion is feedback only:** sets slide between the draft, an option and its without-Qloo version; old slots show as dashed outlines; holds drop into their lane. Reduced motion keeps every state and drops the travel.

`inspect.mjs --app` at 1440, 768 and 390: **0 FAIL, 0 WARN**. The real-click walkthrough passes at 1440, at 390 and with reduced motion.

## Public page

Dealt with `draw.mjs --keep palette,type` (seed 130292774): **quiet-instrument**, chosen over `type-only-statement` and `borrowed-category` because restraint answers the "too packed" complaint directly.

Idea: *on this page, the real 45-minute overlap of TV Girl and Eyedress, each other's #1 of 31 on the Lollapalooza Saturday bill, becomes the one exact instrument.* The live element is the hero fragment: a working slice of the real timetable that switches between Published, Option A and Without Qloo. Its readout is computed from the placements on screen (45 and 15 minutes; apart and apart; apart and 30 minutes).

Sections follow the dealt blueprints:

- **Hero:** two tones, with the text anchored bottom-left and the fragment on the right.
- **Showcase:** a dark row in which only the centred interface capture is lit, with a caption that changes as panels arrive.
- **How a day is repaired:** a pinned card that changes state as three statements scroll past.
- **What was checked:** plain names in columns, including what is not claimed.
- **Questions:** an index with one answer pane.
- **Close:** a short sentence, one action and the repaired grid.

Every picture is a capture of Counterset; the moving picture is a real screen recording.

Motion, as requested: on load, the headline lines rise from their baselines, then the supporting text fades up and the fragment's sets settle into their slots one after another. While scrolling, each section's parts rise 24px in sequence once, the pinned card crossfades between states, and the shelf lights the centred panel. Nothing loops except the recording, and only while its panel is lit. Reduced motion shows everything at once without travel. A browser check confirmed every revealed element ends visible.

`inspect.mjs` at 1440, 768 and 390: **0 FAIL, 3 WARN**, each defended:

- `side-scroll` and `empty-middle` are the showcase shelf, a deliberate scroll-snap carousel with arrow buttons and a dark field.
- `off-centre` (40px against 70px) measures the padding inside the white fragment and the closing picture's field; both fields themselves reach the 40px margin.

## Look rounds (screenshots in `.taste-skill/`, not committed)

1. **Studio:**
   - The budget label stacked badly and the Back link was centred.
   - The hold block sat under the sets.
   - The status line went stale between steps.
   - Lanes were tall enough to push the work card below the fold.

   All fixed.
2. **Studio phone:** stage names scrolled away, so they are now pinned; tab labels clipped at the edge, so phones get short labels.
3. **Landing:**
   - Fragment names truncated, so the fragment is wider and phones show stage names above their lanes.
   - The ending was two empty screens, so it now closes with a picture.
   - The pinned card covered the next heading on tablets, so that section now has its own ground.
