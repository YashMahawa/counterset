// Public page: one live control over the real replay, one step-through of the agent, and small motion.
// Everything the page says about the replay is read from the solver's table, never typed in here.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const tm = (n) => `${String(Math.floor(n / 60) % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

// ---------- The live replay ----------
const live = $("#live");
const state = { curfew: 1440, shortest: 75, real: false };
let table = null;
const ROW = 54;
const AXIS = 24;
const LABEL = 54;

function geometry() {
  const width = Math.max(960, $(".board-wrap").clientWidth);
  const from = 12 * 60;
  const to = Math.max(...table.curfews) + 30;
  return { width, from, to, ppm: (width - LABEL) / (to - from) };
}
function drawBase() {
  const g = geometry();
  const board = $("#board");
  board.style.width = g.width + "px";
  board.style.height = AXIS + (table.stages.length + 1) * ROW + "px";
  board.querySelectorAll(".tick,.row-name,.band").forEach((n) => n.remove());
  const add = (cls, text, css) => {
    const el = document.createElement("div");
    el.className = cls;
    el.textContent = text;
    Object.assign(el.style, css);
    board.appendChild(el);
  };
  for (let t = g.from; t <= g.to; t += 60) add("tick", tm(t), { left: LABEL + (t - g.from) * g.ppm + "px", top: "0px" });
  table.stages.forEach((s, i) => {
    add("row-name", s.name, { left: "0px", top: AXIS + i * ROW + 12 + "px" });
    add("band", i === 0 ? "Site closed" : "", {
      left: LABEL + (table.storm.start - g.from) * g.ppm + "px",
      top: AXIS + i * ROW + "px",
      width: (table.storm.end - table.storm.start) * g.ppm - 2 + "px",
      height: ROW - 4 + "px",
    });
  });
  add("row-name", "Out", { left: "0px", top: AXIS + table.stages.length * ROW + 12 + "px" });
}
const tiles = new Map();
function current() {
  return table.rows.find((r) => r.curfew === state.curfew && r.shortest === state.shortest);
}
function draw() {
  const g = geometry();
  const board = $("#board");
  const row = current();
  const places = state.real ? table.as_run.placements : row.placements;
  const acts = Object.fromEntries(table.acts.map((a) => [a.id, a]));
  const stageIndex = Object.fromEntries(table.stages.map((s, i) => [s.id, i]));
  const cancelled = new Set(table.as_run.placements.filter((p) => p.cut).map((p) => p.act_id));
  let out = 0;
  for (const p of places) {
    const a = acts[p.act_id];
    let el = tiles.get(a.id);
    if (!el) {
      el = document.createElement("div");
      el.className = "tile";
      el.textContent = a.name;
      board.appendChild(el);
      tiles.set(a.id, el);
    }
    const length = p.length ?? a.duration;
    const x = p.cut ? LABEL + out++ * 84 : LABEL + (p.start - g.from) * g.ppm;
    const y = AXIS + (p.cut ? table.stages.length : stageIndex[p.stage_id]) * ROW;
    el.style.height = ROW - 4 + "px";
    el.style.width = (p.cut ? 80 : length * g.ppm - 2) + "px";
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.classList.toggle("out", !!p.cut);
    el.classList.toggle("back", !p.cut && cancelled.has(a.id));
    el.classList.toggle("short", !p.cut && length !== a.duration);
    el.classList.toggle("tiny", !p.cut && length * g.ppm < 66);
    el.title = p.cut ? `${a.name}: not playing` : `${a.name}, ${tm(p.start)}–${tm(p.start + length)}${length !== a.duration ? `, ${length} of ${a.duration} minutes` : ""}`;
  }
  const big = $(".big");
  big.classList.toggle("real", state.real);
  if (state.real) {
    $("#saved").textContent = table.acts.length - table.as_run.cancelled.length;
    $("#saved-of").textContent = `of ${table.acts.length} sets played on the day, and ${table.as_run.cancelled.length} were cancelled`;
    const c = table.as_run.clashes.length;
    $("#costs").textContent = `Most other sets moved back an hour, and the day finished at midnight. Acts that share a crowd left playing at once: ${c}. Rebuilt from press reports.`;
  } else {
    $("#saved").textContent = row.played;
    $("#saved-of").textContent = `of ${row.total} sets could play. ${row.total - table.as_run.cancelled.length} did on the day.`;
    const drop = row.dropped.length ? `Not playing: ${row.dropped.join(", ")}.` : "Every set plays.";
    const cost = row.minutes_shortened ? `It costs ${row.minutes_shortened} minutes of music across ${plural(row.sets_shortened, "set")}, and ${plural(row.moved, "set")} move.` : `Every set stays full length, and ${plural(row.moved, "set")} move.`;
    $("#costs").textContent = `${row.saved} of the ${table.as_run.cancelled.length} cancelled sets come back. ${cost} ${drop} Acts that share a crowd left playing at once: ${row.clashes.length}.`;
  }
  document.querySelectorAll("#curfew button,#shortest button").forEach((b) => {
    const on = !state.real && +b.dataset.value === (b.parentElement.id === "curfew" ? state.curfew : state.shortest);
    b.setAttribute("aria-pressed", String(on));
  });
  $("#asrun").setAttribute("aria-pressed", String(state.real));
  $("#yours").setAttribute("aria-pressed", String(!state.real));
  $("#choices").classList.toggle("off", state.real);
}
function controls() {
  $("#curfew").innerHTML = table.curfews.map((c) => `<button type="button" data-value="${c}">${tm(c)}</button>`).join("");
  $("#shortest").innerHTML = table.shortest.map((v) => `<button type="button" data-value="${v}">${v === 100 ? "Full length" : v + "% of its time"}</button>`).join("");
  $("#curfew").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state.curfew = +b.dataset.value;
    state.real = false;
    draw();
  };
  $("#shortest").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state.shortest = +b.dataset.value;
    state.real = false;
    draw();
  };
  $("#asrun").onclick = () => {
    state.real = true;
    draw();
  };
  $("#yours").onclick = () => {
    state.real = false;
    draw();
  };
}
async function startLive() {
  try {
    const r = await fetch("/api/rescue-table");
    if (!r.ok) throw Error("No table");
    table = await r.json();
    const names = table.as_run.cancelled;
    controls();
    drawBase();
    draw();
    // On a phone the timetable scrolls sideways: start where the day restarts.
    const wrap = $(".board-wrap");
    if (innerWidth < 860) wrap.scrollLeft = LABEL + (table.storm.end - geometry().from) * geometry().ppm - 70;
    let timer;
    addEventListener("resize", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        drawBase();
        draw();
      }, 150);
    });
    return names;
  } catch {
    live.classList.add("no-live");
    return null;
  }
}

// ---------- The names ----------
function names(list) {
  const fall = ["Nat Myers", "Little Stranger", "Buffalo Traffic Jam", "Girl Tones", "MOTIFV", "Aly & AJ", "Spacey Jane", "Hemlocke Springs", "Blondshell", "A Hundred Drums", "Trombone Shorty"];
  const use = list || fall;
  const line = use.map((n) => `<span>${esc(n)}</span>`).join("");
  $("#track").innerHTML = line + line;
}

// ---------- The agent, step by step (each line is from a recorded run, see web/agent-run.json) ----------
const STAGES = [
  {
    name: "Reads",
    clause: "First it reads the message",
    say: "A programmer pastes what production said. The agent records each closure and limit, and every one must quote the message word for word.",
    frag: () => `<h3>Message from production</h3>
      <p class="msg">13:00. Lightning in the area. <mark>Centeroo is being evacuated and every stage is closed.</mark> Site ops expect to reopen at 17:15. Noah Kahan, Kesha and Modest Mouse must play in full. <mark>Hard stop is midnight.</mark> What can we save?</p>
      <p class="line"><strong>Closed the site.</strong> All 5 stages closed 13:00–17:15.</p>
      <p class="line"><strong>Checked the grid.</strong> The closure breaks 16 of 28 published sets.</p>`,
  },
  {
    name: "Tries",
    clause: "Then it tries the gentlest fix",
    say: "It starts with full-length sets and no drops. When the solver proves that cannot work, it relaxes one term and tries again.",
    frag: () => `<h3>Rescues it tried</h3>
      <p class="line no"><strong>Full length, no drops.</strong> No schedule fits.</p>
      <p class="line no"><strong>Shrink to 75%, no drops.</strong> No schedule fits.</p>
      <p class="line"><strong>Full length, drops allowed.</strong> 24 of 28 sets play.</p>
      <p class="line"><strong>Shrink to 85%, drops allowed.</strong> 25 of 28 sets play.</p>
      <p class="line yes"><strong>Shrink to 75%, drops allowed.</strong> 27 of 28 sets play.</p>
      <p class="line"><strong>Shrink to 60%, drops allowed.</strong> Still 27, so it stops.</p>`,
  },
  {
    name: "Checks",
    clause: "It checks itself against the day",
    say: "It solves the same rescue with all Qloo evidence removed, then scores what the festival really did. A separate validator recounts everything.",
    frag: () => `<h3>Same day, three ways</h3>
      <p class="line"><strong>What really happened.</strong> 11 sets cancelled, 1 shared-crowd clash.</p>
      <p class="line"><strong>Without Qloo.</strong> 1 more shared-crowd pair clashes, and it drops Japanese Breakfast in place of Little Stranger.</p>
      <p class="line yes"><strong>With Qloo.</strong> 1 dropped, 0 shared-crowd clashes.</p>
      <p class="note">The figures here come from a recorded run. Each run in the studio solves them again.</p>`,
  },
  {
    name: "Hands over",
    clause: "Then a person decides",
    say: "It writes a short recommendation and drafts a message to every affected act. It cannot approve or send anything.",
    frag: () => `<h3>Waiting for you</h3>
      <p class="line"><strong>The recommendation.</strong> 27 of 28 sets play. Little Stranger is dropped. 145 minutes are shortened across 12 sets.</p>
      <p class="line"><strong>Drafted for each act.</strong> “New slot, set runs shorter. Please confirm you can do this.”</p>
      <span class="approve">Approve as v1</span>
      <p class="note">Approving rechecks every rule and saves a numbered version you can export.</p>`,
  },
];
function stage(i) {
  const s = STAGES[i];
  const frag = $("#stage-frag");
  frag.classList.add("swap");
  setTimeout(() => {
    $("#stage-clause").textContent = s.clause;
    $("#stage-say").textContent = s.say;
    frag.innerHTML = s.frag();
    frag.classList.remove("swap");
  }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200);
  document.querySelectorAll("#stage-names button").forEach((b, n) => b.setAttribute("aria-current", n === i ? "step" : "false"));
}
function startStages() {
  $("#stage-names").innerHTML = STAGES.map((s, i) => `<li><button type="button" data-i="${i}">${esc(s.name)}</button></li>`).join("");
  $("#stage-names").onclick = (e) => {
    const b = e.target.closest("button");
    if (b) stage(+b.dataset.i);
  };
  stage(0);
}

// ---------- Motion ----------
function startMotion() {
  // The bar takes the ink of the chapter under it.
  const bar = $("#bar");
  const chapters = [...document.querySelectorAll("[data-ink]")];
  const ink = () => {
    const at = chapters.find((c) => {
      const r = c.getBoundingClientRect();
      return r.top <= 28 && r.bottom > 28;
    });
    bar.classList.toggle("light", at?.dataset.ink === "light");
    // The bar takes the flat colour of the chapter too, so words never sit on words.
    const bg = at ? getComputedStyle(at).backgroundColor : "";
    bar.style.setProperty("--bar-bg", !bg || bg === "rgba(0, 0, 0, 0)" ? "#fff" : bg);
  };
  addEventListener("scroll", ink, { passive: true });
  ink();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // Each section's parts rise in turn, once. Content is only hidden once script is running.
  const parts = document.querySelectorAll(
    "section h2:not(.visually-hidden), .film p, .film video, .replay-top p, .replay, .assume, .plain, blockquote, .lede, .jobs article, .fine, .tile, .mosaic figure, .faq details, .end, .stage-ui, #stage-say, .stage-rail, .places, .foot-notes",
  );
  const seen = new IntersectionObserver(
    (entries) => {
      for (const e of entries)
        if (e.isIntersecting) {
          e.target.classList.add("in");
          seen.unobserve(e.target);
        }
    },
    { rootMargin: "0px 0px -8% 0px" },
  );
  const groups = new Map();
  parts.forEach((el) => {
    const sec = el.closest("section,footer");
    const n = groups.get(sec) || 0;
    groups.set(sec, n + 1);
    el.style.setProperty("--d", `${Math.min(n, 6) * 70}ms`);
    el.classList.add("rise");
    seen.observe(el);
  });
}

startMotion();
startStages();
names(null);
startLive().then((list) => list && names(list));
