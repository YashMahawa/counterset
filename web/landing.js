// Public page: the days to try, one live control over the real replay, and small motion.
// Everything the page says about the replay is read from the solver's table, never typed in here.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const tm = (n) => `${String(Math.floor(n / 60) % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

// ---------- The live replay ----------
const live = $("#live");
const state = { curfew: 1440, shortest: 75, real: false, film: null };
let table = null;
const ROW = 54;
const AXIS = 24;
const LABEL = 54;

function geometry() {
  const width = innerWidth < 860 ? 1500 : Math.max(960, $(".board-wrap").clientWidth);
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
  const places = state.film || (state.real ? table.as_run.placements : row.placements);
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
  if (state.film) return;
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
    controls();
    drawBase();
    draw();
    // On a phone the timetable scrolls sideways: start where the day restarts.
    const wrap = $(".board-wrap");
    if (innerWidth < 860) wrap.scrollLeft = LABEL + (table.storm.end - geometry().from) * geometry().ppm - 90;
    // Stage names stay in view while the timetable scrolls sideways.
    const pin = () => document.querySelectorAll(".row-name").forEach((n) => (n.style.transform = `translateX(${wrap.scrollLeft}px)`));
    wrap.addEventListener("scroll", pin, { passive: true });
    pin();
    let timer;
    addEventListener("resize", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        drawBase();
        draw();
      }, 150);
    });
  } catch {
    live.classList.add("no-live");
  }
}

// ---------- Watching the saved run ----------
// Steps from one real run of the agent. Playing them calls no model and no solver.
const STEP_WORDS = {
  close_site: "Closed the site",
  close_stage: "Closed a stage",
  limit_act: "Set a limit on an act",
  audit: "Checked the day",
  try_rescue: "Tried a rescue",
  compare_without_qloo: "Solved it again without Qloo",
  compare_as_run: "Scored what really happened",
  why_they_share_a_crowd: "Asked why two acts share a crowd",
  finish: "Handed over a plan",
  report_conflict: "Reported that nothing fits",
};
const MODEL_WORDS = { "gemini-3.8-flash": "Gemini 3.8 Flash", "gemini-3.5-flash-lite": "Gemini 3.5 Flash Lite" };
let film = null;
function filmStep() {
  const step = film.run.steps[film.at];
  if (step.placements) state.film = step.placements;
  draw();
  $("#watch-count").textContent = `Step ${film.at + 1} of ${film.run.steps.length}: ${STEP_WORDS[step.tool] || "Tried a step"}`;
  $("#watch-thought").textContent = step.thought;
  $("#watch-line").textContent = step.line;
}
function filmEnd() {
  film.playing = false;
  state.film = film.run.final;
  draw();
  $("#watch-count").textContent = "The agent's plan. A person still has to approve it.";
  $("#watch-thought").textContent = film.run.summary;
  $("#watch-line").textContent = "";
  $("#watch-play").textContent = "Play it again";
}
function filmTick() {
  clearTimeout(film.timer);
  if (!film.playing) return;
  film.at += 1;
  if (film.at >= film.run.steps.length) return filmEnd();
  filmStep();
  film.timer = setTimeout(filmTick, 2200);
}
function filmLeave() {
  clearTimeout(film.timer);
  film.playing = false;
  film.at = -1;
  state.film = null;
  $("#live").classList.remove("filming");
  $("#watch-run").hidden = true;
  $("#watch-back").hidden = true;
  $("#watch-play").textContent = "Watch the agent work";
  draw();
}
async function startWatch() {
  try {
    const r = await fetch("/api/agent-replay");
    if (!r.ok) return;
    const run = await r.json();
    film = { run, at: -1, playing: false, timer: 0 };
    const when = new Date(run.at * 1000).toLocaleDateString([], { day: "numeric", month: "long" });
    $("#watch-tag").textContent = `A saved run of ${MODEL_WORDS[run.model] || run.model}, recorded ${when}. Playing it calls no model.`;
    $("#watch-message").textContent = run.message;
    $("#watch").hidden = false;
    $("#watch-back").onclick = filmLeave;
    $("#watch-play").onclick = () => {
      if (!table) return;
      if (film.playing) {
        film.playing = false;
        clearTimeout(film.timer);
        $("#watch-play").textContent = "Keep playing";
        return;
      }
      if (film.at >= film.run.steps.length) film.at = -1;
      film.playing = true;
      $("#live").classList.add("filming");
      $("#watch-run").hidden = false;
      $("#watch-back").hidden = false;
      $("#watch-play").textContent = "Pause";
      filmTick();
    };
  } catch {}
}

// ---------- Motion ----------
function startMotion() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // Each section's parts rise in turn, once. Content is only hidden once script is running.
  const parts = document.querySelectorAll(
    "section h2:not(.visually-hidden), .try-steps, .try-days, .replay-top p, .replay, .assume, .jobs article, .faq details, .end, .places, .foot-notes",
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

// ---------- The days to try ----------
async function startDays() {
  try {
    const r = await fetch("/api/templates");
    if (!r.ok) return;
    const days = await r.json();
    if (days.length) $("#try-days").innerHTML = days.map((d) => `<a href="/studio?template=${encodeURIComponent(d.id)}"><strong>${esc(d.title)}</strong><span>${esc(d.why)}</span></a>`).join("");
  } catch {}
}

startMotion();
startDays();
startLive();
startWatch();
