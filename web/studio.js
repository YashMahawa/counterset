// Counterset studio. Every chapter reads and changes the real workspace state on
// the server; nothing in the walkthrough is scripted or pre-rendered.

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const tm = (n) => `${String(Math.floor(n / 60) % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const mins = (s) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};
const token = () => {
  try {
    return sessionStorage.getItem("counterset-token");
  } catch {
    return null;
  }
};

const S = {
  config: null,
  project: null,
  proposal: null,
  view: "draft",
  selected: null,
  chapter: 0,
  open: new Set([0]),
  drawThreads: false,
  allCues: false,
  benchmark: null,
};

// The CSP forbids inline style attributes, so geometry travels in data-css and is
// applied through the CSSOM after each render.
function applyCss(root = document) {
  for (const el of root.querySelectorAll("[data-css]")) {
    el.style.cssText += ";" + el.dataset.css;
    el.removeAttribute("data-css");
  }
}

// ---------- API ----------
async function api(path, method = "GET", body) {
  const headers = { "Content-Type": "application/json", "X-Counterset": "workspace" };
  if (token()) headers.Authorization = `Bearer ${token()}`;
  const r = await fetch("/api" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) {
    let e;
    try {
      e = await r.json();
    } catch {
      throw Error(`${r.status} ${r.statusText}`);
    }
    throw Error(typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail || e));
  }
  return r.json();
}
async function job(path, body, label) {
  const busy = $("#busy");
  busy.hidden = false;
  $("#busy-label").textContent = label;
  $("#progress").value = 0;
  try {
    const r = await api(path, "POST", body);
    for (let n = 0; n < 1200; n++) {
      await new Promise((res) => setTimeout(res, 500));
      const j = await api(`/jobs/${r.job_id}`);
      $("#progress").value = j.progress || 0;
      $("#busy-label").textContent = j.detail || label;
      if (j.status === "FAILED") throw Error(j.error);
      if (j.status === "COMPLETED") return j.result;
    }
    throw Error("Still running. Reload later; results are saved when they finish.");
  } finally {
    busy.hidden = true;
  }
}
function say(text, error = false) {
  const s = $("#status");
  s.textContent = text;
  s.className = error ? "status error" : "status";
}
async function guarded(fn) {
  try {
    await fn();
  } catch (e) {
    say(e.message, true);
  }
}

// ---------- State helpers ----------
const day = () => S.project.day;
const act = (id) => day().acts.find((a) => a.id === id);
const stage = (id) => day().stages.find((s) => s.id === id);
const ev = () => S.project.evidence || {};
const hasEvidence = () => !!ev().id;
const confirmed = () => day().acts.filter((a) => a.qloo_id).length;
const current = () => S.proposal && S.proposal.input_version === S.project.version;
const options = () => (current() ? S.proposal.options.filter((o) => o.placements?.length) : []);
const option = (i) => (current() ? S.proposal.options[i] : null);
function placementsFor(view) {
  if (view.startsWith("opt")) return option(+view.slice(3))?.placements;
  if (view.startsWith("blind")) return option(+view.slice(5))?.without_qloo?.placements;
  return day().draft;
}
function auditFor(view) {
  if (view.startsWith("opt")) return option(+view.slice(3))?.audit;
  if (view.startsWith("blind")) return option(+view.slice(5))?.without_qloo?.audit;
  return S.project.audit;
}
const cueKey = (a, b) => [a, b].sort().join("|");
function cuesOf(id) {
  return (ev().edges || []).filter((e) => e.a === id || e.b === id);
}
function rankLine(a, b) {
  const r = ev().ranks?.[a]?.[b];
  const n = ev().sizes?.[a]?.[kindType(act(b).kind)];
  return r ? `#${r} of ${n}` : "unknown";
}
const kindType = (k) => ({ artist: "urn:entity:artist", podcast: "urn:entity:podcast" })[k] || "urn:entity:person";
const kindLabel = { artist: "music", comedian: "comedy", speaker: "talk", podcast: "podcast" };

// ---------- Chapters ----------
const CHAPTERS = [
  {
    title: "The bill",
    state: () => `${confirmed()}/${day().acts.length} confirmed`,
    done: () => confirmed() >= 2,
    body: () => {
      const acts = day().acts;
      const kinds = {};
      acts.forEach((a) => (kinds[a.kind] = (kinds[a.kind] || 0) + 1));
      const open = acts.filter((a) => !a.qloo_id);
      return `<p class="narration">Counterset never changes who plays, only when and where. First it needs to know exactly who each act is, so that Qloo compares the right entities. Matches are confirmed by a person, never assumed.</p>
      <div class="figure"><div><strong>${acts.length}</strong><span>acts</span></div><div><strong>${day().stages.length}</strong><span>stages</span></div><div class="${open.length ? "hot" : ""}"><strong>${open.length}</strong><span>unresolved</span></div></div>
      <p class="fine">${Object.entries(kinds)
        .map(([k, n]) => `${n} ${kindLabel[k]}`)
        .join(" · ")}</p>
      ${open.length ? `<div class="list">${open.map((a) => `<button data-action="resolve" data-act="${esc(a.id)}">${esc(a.name)}<small>Not confirmed. Its pairs stay unknown, never zero.</small></button>`).join("")}</div>` : ""}
      <div class="row"><button data-action="identities">Review identities</button></div>`;
    },
  },
  {
    title: "Shared crowds",
    state: () => (hasEvidence() ? `${ev().edges.length} cues · ${ev().status.toLowerCase()}` : "not loaded"),
    done: hasEvidence,
    body: () => {
      const e = ev();
      const est = estimate();
      if (!e.id)
        return `<p class="narration">Each act asks Qloo to rank every other act on this bill, inside one response per kind of act. When two acts sit near the top of each other's lists, they probably share a crowd. Scores from different responses are never compared.</p>
        <p class="fine">Querying this bill takes ${est} Qloo requests, spaced 13 s apart. Rows already fetched are reused from the private cache.</p>
        <div class="row"><button class="primary" data-action="evidence" data-source="cache">Load cached rows</button><button data-action="evidence" data-source="live" ${S.config.qloo_configured ? "" : "disabled"}>Query Qloo live</button></div>`;
      const st = S.project.evidence_state;
      const cross = e.edges.filter((x) => x.cross).length;
      const top = [...e.edges].sort((x, y) => x.ranks[0] + x.ranks[1] - (y.ranks[0] + y.ranks[1])).slice(0, 8);
      return `<p class="narration">Each line on the timetable is a reciprocal cue: both acts rank each other in their top ${e.k} (never more than a quarter of the acts of that kind). Select any line or act to see both ranks.</p>
      <div class="figure"><div><strong>${e.edges.length}</strong><span>cues</span></div><div><strong>${e.complete_rows}/${e.total_rows}</strong><span>complete rows</span></div><div><strong>${e.unknown.length}</strong><span>unknown pairs</span></div></div>
      ${cross ? `<p class="fine">${plural(cross, "cue")} cross kinds of act, for example music and comedy.</p>` : ""}
      <p class="fine">Status ${esc(e.status)} · order check ${e.order_control?.passed ? "passed" : e.order_control?.passed === false ? "failed: cues disabled" : "not run"} · fetched ${esc(dateOf(e.fetched_at))}${st.stale ? ` · <span class="badge hot">stale</span>` : ""}</p>
      <div class="list">${top.map((x) => `<button data-action="pair" data-a="${esc(x.a)}" data-b="${esc(x.b)}">${esc(act(x.a).name)} ↔ ${esc(act(x.b).name)}<small>${esc(rankLine(x.a, x.b))} · ${esc(rankLine(x.b, x.a))}</small></button>`).join("")}</div>
      <div class="row"><button class="ghost" data-action="evidence" data-source="live" ${S.config.qloo_configured ? "" : "disabled"}>Refresh from Qloo</button></div>`;
    },
  },
  {
    title: "Audit the grid",
    state: () => (hasEvidence() ? plural(S.project.audit.counts.qloo, "cue clash", "cue clashes") : "needs evidence"),
    done: () => hasEvidence() && S.chapter > 2,
    body: () => {
      if (!hasEvidence()) return `<p class="narration">Load the evidence first.</p>`;
      const a = S.project.audit;
      const f = S.project.random_fill;
      const clashes = a.conflicts.filter((c) => c.source === "qloo" || c.source === "must_see");
      const invalid = a.errors;
      return `<p class="narration">A clash is a cued pair playing at the same time on different stages for more than ${day().threshold} minutes. Fans of one usually like the other, so they have to choose.</p>
      <div class="figure"><div class="${a.counts.qloo ? "hot" : ""}"><strong>${a.counts.qloo}</strong><span>cue clashes</span></div><div><strong>${a.counts.must_see}</strong><span>attendee clashes</span></div><div class="${invalid.length ? "hot" : ""}"><strong>${invalid.length}</strong><span>rule breaks</span></div></div>
      ${f && f.samples ? histogram(f) : ""}
      ${clashes.length ? `<div class="list">${clashes.map((c) => `<button class="hot" data-action="pair" data-a="${esc(c.a)}" data-b="${esc(c.b)}">${esc(act(c.a).name)} × ${esc(act(c.b).name)}<small>${c.minutes} min overlap · ${c.source === "must_see" ? `${c.weight} attendee selections` : esc(rankLine(c.a, c.b) + " · " + rankLine(c.b, c.a))}</small></button>`).join("")}</div>` : `<p>No cued pair clashes in this grid.</p>`}
      ${invalid.length ? `<div class="list">${invalid.map((x) => `<div class="item hot">${esc(x)}</div>`).join("")}</div>` : ""}
      <p class="fine">Mark a clash as intentional from its detail panel if you want it.</p>`;
    },
  },
  {
    title: "Something changes",
    state: () => {
      const holds = day().outages.length;
      return holds ? plural(holds, "hold") : "no disruption";
    },
    done: () => day().outages.length > 0 || S.project.notes.some((n) => n.items?.some((i) => i.status === "APPROVED")),
    body: () => {
      const note = S.project.notes[0];
      const sample = sampleMessage();
      return `<p class="narration">Paste the message production sends you. A model reads it and proposes constraints, each with the exact words it came from. Nothing changes until you approve it.</p>
      <label>Production message<textarea id="message" rows="4">${esc(sample)}</textarea></label>
      <p class="fine">${S.project.context?.kind === "retrospective" ? "This sample message is hypothetical. The festival did not send it." : "Sample message for rehearsal."}</p>
      <div class="row"><select id="message-model" aria-label="Model"><option value="gemma-4-31b-it">Gemma 4 31B · high thinking</option><option value="gemini-3.5-flash-lite">Gemini 3.5 Flash Lite · high thinking</option></select></div>
      <div class="row"><button class="primary" data-action="message" ${S.config.model_configured ? "" : "disabled"}>Read the message</button><button data-action="hold">Add a stage hold</button></div>
      ${note ? reviewList(note) : ""}
      ${day().outages.length ? `<div class="list">${day().outages.map((o) => `<div class="item">${esc(stage(o.stage_id).name)} on hold ${tm(o.start)}–${tm(o.end)}<small>${esc(o.reason)}</small></div>`).join("")}</div>` : ""}`;
    },
  },
  {
    title: "Choose a repair",
    state: () => (options().length ? `${options().length} option${options().length > 1 ? "s" : ""}` : S.proposal?.status === "INFEASIBLE" && current() ? "infeasible" : "not run"),
    done: () => options().length > 0,
    body: () => {
      if (!hasEvidence()) return `<p class="narration">Load the evidence first.</p>`;
      const budget = store.get("counterset-budget") || 4;
      let out = `<p class="narration">The solver keeps every production rule, puts attendee must-sees first, then Qloo cues, then your preference: change the fewest acts, or keep start times closest. It also solves once more without Qloo, so you can see exactly what the evidence changed.</p>
      <label>Most acts that may change <output id="budget-out">${budget}</output><input id="budget" type="range" min="0" max="${Math.min(12, day().acts.length)}" value="${budget}" /></label>
      <div class="row"><button class="primary" data-action="repair">Find repairs</button></div>`;
      if (!current()) return out;
      const p = S.proposal;
      if (!options().length)
        return (
          out +
          `<div class="protected"><strong>${esc(p.status)}</strong>. ${esc(p.core_scope || "")}</div>${p.core?.length ? `<div class="list">${p.core.map((c) => `<div class="item hot">${esc(c)}</div>`).join("")}</div><p class="fine">Remove or edit one of these constraints, then repair again. Locks and curfews are never relaxed for you.</p>` : ""}`
        );
      out += `<div class="options">${p.options
        .map((o, i) => {
          if (!o.placements?.length) return "";
          if (o.same_as !== undefined) return `<p class="fine">“${prefName(o.priority)}” gives the same schedule as option A.</p>`;
          const prot = o.without_qloo?.protected || [];
          return `<button class="option" data-action="view" data-view="opt${i}" aria-pressed="${S.view === "opt" + i}">
            <h3>${"AB"[i]} · ${prefName(o.priority)} <span class="badge ${o.status === "OPTIMAL" ? "go" : ""}">${esc(o.status)}</span></h3>
            <dl><div><dt>acts changed</dt><dd>${o.audit.moves}</dd></div><div><dt>minutes shifted</dt><dd>${o.audit.displacement}</dd></div><div><dt>cue clashes</dt><dd>${o.audit.counts.qloo}</dd></div></dl>
            ${o.status !== "OPTIMAL" ? `<span class="fine">Best found in the time limit. Not proven minimal.</span>` : ""}
            ${prot.length ? `<span class="protected">Without Qloo this repair would also split ${prot.map((x) => `${esc(act(x.a).name)} × ${esc(act(x.b).name)}`).join(", ")}.</span>` : `<span class="fine">${o.without_qloo?.identical ? "Qloo did not change this repair." : "Without Qloo the repair differs but creates no extra cue clash."}</span>`}
          </button>`;
        })
        .join("")}</div>
      <div class="row">${p.options
        .map((o, i) => (o.without_qloo?.placements && o.same_as === undefined && !o.without_qloo.identical ? `<button class="ghost" data-action="view" data-view="blind${i}">Show ${"AB"[i]} without Qloo</button>` : ""))
        .join("")}</div>
      ${p.briefing ? `<div class="protected">${esc(p.briefing.text)}<br><small class="fine">${p.briefing.source === "model" ? "Model briefing; numbers checked against the computed options." : `Computed summary${p.briefing.rejected ? ` (model briefing rejected: ${esc(p.briefing.rejected)})` : ""}.`}</small></div>` : `<div class="row"><button class="ghost" data-action="brief" ${S.config.model_configured ? "" : "disabled"}>Ask the agent to brief me</button></div>`}`;
      return out;
    },
  },
  {
    title: "Approve",
    state: () => (S.project.versions.length ? `v${S.project.versions.at(-1).number} published` : "nothing published"),
    done: () => S.project.status === "PUBLISHED",
    body: () => {
      const vs = S.project.versions;
      const sel = S.view.startsWith("opt") ? +S.view.slice(3) : options().length ? 0 : null;
      let out = `<p class="narration">Approving re-runs the independent validator, freezes the schedule as a numbered version and makes it the new draft. Any later edit makes older proposals stale.</p>`;
      if (sel !== null && option(sel)?.audit) {
        const o = option(sel);
        out += `<p>Option ${"AB"[sel]} changes ${plural(o.audit.moves, "act")}.</p>${diffList(o.placements)}
        <div class="row"><button class="primary" data-action="publish" data-option="${sel}">Approve option ${"AB"[sel]} as v${vs.length + 1}</button></div>`;
      } else out += `<p class="fine">Find a repair first.</p>`;
      if (vs.length)
        out += `<div class="list">${vs
          .slice()
          .reverse()
          .map((v) => `<div class="item ok">v${v.number} · ${esc(dateOf(v.published_at))}<small>${plural(v.audit.moves, "act")} changed · ${v.audit.counts.qloo} cue clashes · <a href="#" data-action="export" data-id="${esc(v.id)}" data-format="csv">CSV</a> · <a href="#" data-action="export" data-id="${esc(v.id)}" data-format="json">JSON</a></small></div>`)
          .join("")}</div>`;
      return out;
    },
  },
];
const prefName = (p) => (p === "least_time_shift" ? "Closest start times" : "Fewest changed acts");
const dateOf = (t) => (t ? new Date(t * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");
function estimate() {
  const types = new Set(day().acts.filter((a) => a.qloo_id).map((a) => kindType(a.kind)));
  const seeds = confirmed();
  let n = 0;
  for (const a of day().acts.filter((a) => a.qloo_id))
    for (const t of types) if (day().acts.some((b) => b.qloo_id && b.id !== a.id && kindType(b.kind) === t)) n++;
  return n + (seeds ? 1 : 0);
}
function histogram(f) {
  const max = Math.max(...f.histogram.map((x) => x[1]));
  const share = Math.round(f.share_at_or_below * 100);
  return `<p>Shuffle these same acts into these same slots ${f.samples.toLocaleString()} times: ${share}% of the shuffles clash as little as this grid or less (average ${f.mean}).</p>
  <div class="hist" aria-hidden="true">${f.histogram.map(([k, n]) => `<div class="${k === f.observed ? "here" : ""}" data-css="height:${Math.max(3, (n / max) * 100)}%"></div>`).join("")}</div>
  <div class="hist-axis" aria-hidden="true">${f.histogram.map(([k]) => `<span>${k}</span>`).join("")}</div>
  <p class="fine">${share <= 10 ? "This grid keeps cued pairs apart far more carefully than chance." : share >= 50 ? "The slot pattern alone explains this grid's clash count." : "Somewhat more careful than chance."} The green bar is this grid.</p>`;
}
function reviewList(note) {
  const live = note.input_version === S.project.version;
  const pending = note.items.some((it) => it.status === "PENDING_REVIEW");
  return `<div class="list">${note.items
    .map(
      (it, i) => `<div class="item ${it.status === "REJECTED" ? "hot" : it.status === "APPROVED" ? "ok" : ""}">
      ${it.status === "PENDING_REVIEW" && live ? `<label class="check"><input type="checkbox" data-review-index="${i}" ${it.action === "unsupported" ? "disabled" : "checked"} /><strong>${esc(describe(it))}</strong></label>` : `<strong>${esc(describe(it))}</strong>`}
      <small>“${esc(it.quote)}”${it.reason ? ` · ${esc(it.reason)}` : ""} · ${esc(it.status.replaceAll("_", " ").toLowerCase())}</small>
    </div>`,
    )
    .join("")}</div>
    ${pending && live ? `<div class="row"><button class="primary" data-action="review" data-note="${esc(note.id)}">Apply ticked changes</button></div>` : pending ? `<p class="fine">The day changed after this message was read. Read it again to review.</p>` : ""}
    <p class="fine">Read by ${esc(note.model || note.telemetry?.model || "model")}. The controller checked every item: exact quote, known act or stage, valid time.</p>`;
}
function describe(it) {
  if (it.action === "stage_hold") return `${stage(it.stage_id).name} on hold ${tm(it.start)}–${tm(it.end)}`;
  if (it.action === "not_before") return `${act(it.act_id).name} starts no earlier than ${tm(it.value)}`;
  if (it.action === "finish_by") return `${act(it.act_id).name} finishes by ${tm(it.value)}`;
  if (it.action === "lock") return `Keep ${act(it.act_id).name} where it is`;
  if (it.action === "unsupported") return "Needs a person: not a schedule constraint";
  return "Rejected by the controller";
}
function sampleMessage() {
  const ctx = S.project.context || {};
  if (ctx.sample_message) return ctx.sample_message;
  const st = day().stages[1] || day().stages[0];
  const late = day().draft.filter((p) => p.stage_id === st.id).sort((a, b) => a.start - b.start);
  const mid = late[Math.floor(late.length / 2)] || late[0];
  return `Weather cell: ${st.name} is closed ${tm(mid.start)}–${tm(mid.start + 45)} while rigging is checked.`;
}
function diffList(places, keep = true) {
  const rows = places
    .map((p) => {
      const d = day().draft.find((x) => x.act_id === p.act_id);
      if (d.stage_id === p.stage_id && d.start === p.start) return "";
      const shift = p.start - d.start;
      return `<div class="diff-row"><strong>${esc(act(p.act_id).name)}</strong><span>${esc(stage(d.stage_id).name)} ${tm(d.start)} → ${esc(stage(p.stage_id).name)} ${tm(p.start)} <span class="fine">(${shift > 0 ? "+" : ""}${shift} min)</span></span>${keep ? `<button data-action="keep" data-act="${esc(p.act_id)}">Keep original</button>` : "<span></span>"}</div>`;
    })
    .join("");
  return `<div class="diff">${rows || "<p>No changes.</p>"}</div>`;
}

function renderChapters() {
  $("#chapters").innerHTML = CHAPTERS.map((c, i) => {
    const active = i === S.chapter;
    const open = document.body.dataset.mode === "desk" ? S.open.has(i) : active;
    return `<li class="chapter ${active ? "active" : ""} ${open ? "open" : ""} ${c.done() ? "done" : ""}">
      <button class="chapter-head" data-action="chapter" data-index="${i}" aria-expanded="${open}" aria-current="${active ? "step" : "false"}">
        <span class="chapter-title">${c.title}</span><span class="chapter-state">${esc(c.state())}</span>
      </button>
      ${open ? `<div class="chapter-body">${c.body()}${i < CHAPTERS.length - 1 ? `<button class="walk-next" data-action="next">Next: ${CHAPTERS[i + 1].title}</button>` : ""}<div class="chapter-nav"><button class="ghost" data-action="prev" ${i === 0 ? "disabled" : ""}>Back</button><button data-action="next" ${i === CHAPTERS.length - 1 ? "disabled" : ""}>Next</button></div></div>` : ""}
    </li>`;
  }).join("");
  applyCss($("#chapters"));
  const b = $("#budget");
  if (b)
    b.oninput = () => {
      $("#budget-out").value = b.value;
      store.set("counterset-budget", b.value);
    };
}

// ---------- Timetable ----------
const LANE = 66,
  AXIS = 38,
  LABEL = 112;
const nodes = new Map();
let lastFocusView = null;
let geometry = null;
function layout() {
  const d = day();
  const origin = Math.floor(Math.min(...d.stages.map((s) => s.opens), ...d.draft.map((p) => p.start)) / 60) * 60;
  const end = Math.ceil(Math.max(...d.stages.map((s) => s.closes)) / 60) * 60;
  const wrap = $("#grid-wrap").clientWidth || 900;
  const ppm = Math.max(innerWidth < 760 ? 1.7 : 1.15, (wrap - LABEL - 16) / (end - origin));
  return { origin, end, ppm, width: LABEL + (end - origin) * ppm + 20, height: AXIS + d.stages.length * LANE + 8 };
}
const xOf = (g, t) => LABEL + (t - g.origin) * g.ppm;
const yOf = (sid) => AXIS + day().stages.findIndex((s) => s.id === sid) * LANE + 3;

function renderGrid() {
  const grid = $("#grid");
  const g = layout();
  const rebuild = !geometry || geometry.width !== g.width || geometry.project !== S.project.id || geometry.stages !== day().stages.length;
  geometry = { ...g, project: S.project.id, stages: day().stages.length };
  if (rebuild) {
    grid.innerHTML = "";
    nodes.clear();
  }
  grid.style.width = g.width + "px";
  grid.style.height = g.height + "px";
  // Static frame.
  $$(".frame", grid).forEach((n) => n.remove());
  let frame = "";
  for (let t = g.origin; t <= g.end; t += 60) frame += `<span class="frame tick" data-css="left:${xOf(g, t) - 18}px">${tm(t)}</span>`;
  day().stages.forEach((s, i) => {
    frame += `<div class="frame lane ${i % 2 ? "alt" : ""}" data-css="top:${AXIS + i * LANE}px;height:${LANE - 4}px"><div class="lane-name">${esc(s.name)}</div></div>`;
  });
  for (const o of day().outages)
    frame += `<div class="frame hold" data-css="left:${xOf(g, o.start)}px;top:${yOf(o.stage_id) - 4}px;width:${(o.end - o.start) * g.ppm}px">Hold ${tm(o.start)}–${tm(o.end)}</div>`;
  grid.insertAdjacentHTML("afterbegin", frame);
  applyCss(grid);

  const places = placementsFor(S.view) || day().draft;
  const audit = auditFor(S.view) || S.project.audit;
  const clashIds = new Set();
  audit.conflicts.forEach((c) => {
    if (c.source === "qloo" || c.source === "must_see") {
      clashIds.add(c.a);
      clashIds.add(c.b);
    }
  });
  const invalid = new Set(audit.invalid || []);
  const draft = Object.fromEntries(day().draft.map((p) => [p.act_id, p]));
  const focus = S.selected?.act ? new Set([S.selected.act, ...cuesOf(S.selected.act).map((e) => (e.a === S.selected.act ? e.b : e.a))]) : S.selected?.pair ? new Set(S.selected.pair) : null;

  $$(".ghost-set", grid).forEach((n) => n.remove());
  for (const p of places) {
    const a = act(p.act_id);
    let el = nodes.get(a.id);
    if (!el) {
      el = document.createElement("button");
      el.className = "set";
      el.dataset.action = "act";
      el.dataset.act = a.id;
      grid.appendChild(el);
      nodes.set(a.id, el);
    }
    const moved = S.view !== "draft" && (draft[a.id].start !== p.start || draft[a.id].stage_id !== p.stage_id);
    el.className = `set kind-${a.kind} ${a.locked ? "locked" : ""} ${a.qloo_id ? "" : "unresolved"} ${clashIds.has(a.id) ? "clash" : ""} ${moved ? "moved" : ""} ${invalid.has(a.id) ? "invalid" : ""} ${S.selected?.act === a.id ? "selected" : ""} ${focus && !focus.has(a.id) ? "dim" : ""}`;
    const w = Math.max(18, a.duration * g.ppm - 3);
    el.style.width = w + "px";
    el.classList.toggle("narrow", w < 96);
    el.title = `${a.name} · ${stage(p.stage_id).name} ${tm(p.start)}–${tm(p.start + a.duration)}`;
    el.style.transform = `translate(${xOf(g, p.start)}px, ${yOf(p.stage_id)}px)`;
    el.innerHTML = `<strong>${esc(a.name)}</strong><span>${tm(p.start)}–${tm(p.start + a.duration)}${a.kind !== "artist" ? " · " + kindLabel[a.kind] : ""}</span>`;
    el.setAttribute(
      "aria-label",
      `${a.name}, ${stage(p.stage_id).name} ${tm(p.start)} to ${tm(p.start + a.duration)}${a.locked ? ", locked" : ""}${moved ? `, moved from ${stage(draft[a.id].stage_id).name} ${tm(draft[a.id].start)}` : ""}${clashIds.has(a.id) ? ", in a clash" : ""}${a.qloo_id ? "" : ", identity unresolved"}`,
    );
    if (moved) {
      const gh = document.createElement("div");
      gh.className = "ghost-set";
      gh.style.width = el.style.width;
      gh.style.transform = `translate(${xOf(g, draft[a.id].start)}px, ${yOf(draft[a.id].stage_id)}px)`;
      grid.appendChild(gh);
    }
  }
  for (const [id, el] of nodes) if (!places.some((p) => p.act_id === id)) (el.remove(), nodes.delete(id));
  renderThreads(g, places, audit, focus);
  if (lastFocusView !== S.view + (S.selected ? JSON.stringify(S.selected) : "")) {
    lastFocusView = S.view + (S.selected ? JSON.stringify(S.selected) : "");
    const target = $(".set.selected", grid) || $(".set.moved", grid) || $(".set.clash", grid) || $(".set.invalid", grid);
    const wrap = $("#grid-wrap");
    if (target && wrap.scrollWidth > wrap.clientWidth + 4) {
      const x = parseFloat((target.style.transform.match(/translate\(([\d.]+)px/) || [0, 0])[1]);
      wrap.scrollTo({ left: Math.max(0, x - 140), behavior: reduced() ? "auto" : "smooth" });
    }
  }
  renderViews();
  renderLegend();
}

let threadTimer;
function renderThreads(g, places, audit, focus) {
  const grid = $("#grid");
  clearTimeout(threadTimer);
  const old = $("svg.threads", grid);
  if (old) old.style.opacity = 0;
  const draw = () => {
    $$("svg.threads", grid).forEach((n) => n.remove());
    if (!hasEvidence()) return;
    const pos = Object.fromEntries(places.map((p) => [p.act_id, p]));
    const clash = new Set(audit.conflicts.filter((c) => c.source === "qloo").map((c) => cueKey(c.a, c.b)));
    const svgns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgns, "svg");
    svg.setAttribute("class", "threads" + (focus ? " quiet" : ""));
    svg.setAttribute("width", g.width);
    svg.setAttribute("height", g.height);
    svg.setAttribute("aria-hidden", "true");
    ev().edges.forEach((e, i) => {
      const pa = pos[e.a],
        pb = pos[e.b];
      if (!pa || !pb) return;
      const A = act(e.a),
        B = act(e.b);
      let x1 = xOf(g, pa.start) + (A.duration * g.ppm) / 2,
        y1 = yOf(pa.stage_id),
        x2 = xOf(g, pb.start) + (B.duration * g.ppm) / 2,
        y2 = yOf(pb.stage_id);
      let d;
      if (y1 === y2) d = `M${x1},${y1} C${x1},${y1 - 24} ${x2},${y2 - 24} ${x2},${y2}`;
      else {
        if (y1 > y2) [x1, y1, x2, y2] = [x2, y2, x1, y1];
        y1 += 56;
        const m = (y1 + y2) / 2;
        d = `M${x1},${y1} C${x1},${m} ${x2},${m} ${x2},${y2}`;
      }
      const path = document.createElementNS(svgns, "path");
      path.setAttribute("d", d);
      const isFocus = focus && focus.has(e.a) && focus.has(e.b) && (!S.selected?.act || e.a === S.selected.act || e.b === S.selected.act);
      if (!S.allCues && !isFocus && !clash.has(cueKey(e.a, e.b))) return;
      path.setAttribute("class", `${clash.has(cueKey(e.a, e.b)) ? "clash" : ""} ${isFocus ? "focus" : ""}`);
      svg.appendChild(path);
      if (S.drawThreads && !reduced()) {
        path.style.setProperty("--delay", `${Math.min(i * 22, 900)}ms`);
        path.style.setProperty("--len", 2000);
        path.classList.add("drawing");
      }
    });
    grid.appendChild(svg);
    S.drawThreads = false;
  };
  if (old && !reduced()) threadTimer = setTimeout(draw, 700);
  else draw();
}

function renderViews() {
  const views = [["draft", S.project.status === "PUBLISHED" ? `Published v${S.project.versions.at(-1)?.number}` : "Current draft"]];
  if (current())
    S.proposal.options.forEach((o, i) => {
      if (!o.placements?.length || o.same_as !== undefined) return;
      views.push([`opt${i}`, `Option ${"AB"[i]}`]);
      if (o.without_qloo?.placements && !o.without_qloo.identical) views.push([`blind${i}`, `${"AB"[i]} without Qloo`]);
    });
  if (!views.some(([v]) => v === S.view)) S.view = "draft";
  $("#views").innerHTML = views
    .map(([v, label]) => `<button role="tab" class="${v.startsWith("blind") ? "blind" : ""}" data-action="view" data-view="${v}" aria-selected="${v === S.view}">${label}</button>`)
    .join("");
}
function renderLegend() {
  $("#legend").innerHTML = hasEvidence()
    ? `<span><i data-css="background:var(--clash)"></i>clash</span><span><i data-css="background:var(--accent)"></i>moved</span>${day().acts.some((a) => a.kind === "comedian") ? `<span><i data-css="background:var(--comedy)"></i>comedy</span>` : ""}${day().acts.some((a) => a.kind === "podcast") ? `<span><i data-css="background:var(--podcast)"></i>podcast</span>` : ""}<button data-action="cues" aria-pressed="${S.allCues}">All ${ev().edges.length} cues</button>`
    : `<span>Load evidence to see which acts share a crowd.</span>`;
  applyCss($("#legend"));
}
// ---------- Inspector ----------
function renderInspector() {
  renderInspectorInner();
  applyCss($("#inspector"));
}
function renderInspectorInner() {
  const box = $("#inspector");
  const sel = S.selected;
  if (sel?.act) return (box.innerHTML = actPanel(sel.act));
  if (sel?.pair) return (box.innerHTML = pairPanel(...sel.pair));
  if (S.view !== "draft" && placementsFor(S.view)) {
    const blind = S.view.startsWith("blind");
    const i = +S.view.replace(/\D/g, "");
    const o = option(i);
    const prot = o.without_qloo?.protected || [];
    box.innerHTML = blind
      ? `<div class="tile hot"><h2>Option ${"AB"[i]} without Qloo</h2><p>Same facts, budget and preference, with every Qloo cue removed.</p><p>${prot.length ? `It leaves ${prot.map((x) => `<strong>${esc(act(x.a).name)} × ${esc(act(x.b).name)}</strong> (${x.minutes} min)`).join(", ")} playing at the same time. The evidence-aware option keeps ${prot.length === 1 ? "that pair" : "those pairs"} apart.` : "It creates no extra clash."}</p></div><div class="tile">${diffList(placementsFor(S.view), false)}</div>`
      : `<div class="tile go"><h2>Option ${"AB"[i]}</h2><p>${prefName(o.priority)} · ${plural(o.audit.moves, "act")} changed · ${o.audit.displacement} minutes shifted · ${plural(o.audit.counts.qloo, "cue clash", "cue clashes")} left</p><p class="fine">${o.status === "OPTIMAL" ? "Proven best for this preference within the move limit." : "Best found within the time limit; not proven."} Independently re-checked against every production rule.</p></div><div class="tile">${diffList(placementsFor(S.view))}</div>`;
    return;
  }
  const c = S.project.context || {};
  box.innerHTML = `<div class="tile wide"><h2>${esc(day().name)}</h2><p>${esc(c.summary || c.note || "")}</p>${c.source ? `<p class="fine">Source: <a href="${esc(c.source)}" target="_blank" rel="noreferrer">published timetable</a>${c.corroboration ? ` · <a href="${esc(c.corroboration)}" target="_blank" rel="noreferrer">corroboration</a>` : ""}</p>` : ""}<p class="fine">Select a set or a clash to see its evidence.</p></div>`;
}
function actPanel(id) {
  const a = act(id);
  const places = placementsFor(S.view) || day().draft;
  const p = places.find((x) => x.act_id === id);
  const d = day().draft.find((x) => x.act_id === id);
  const cues = cuesOf(id);
  const unknown = (ev().unknown || []).filter((u) => u.a === id || u.b === id).length;
  const prov = ev().provenance?.[id] || [];
  const cov = ev().coverage?.[id];
  return `<div class="tile"><h2>${esc(a.name)}</h2>
    <p>${esc(stage(p.stage_id).name)} ${tm(p.start)}–${tm(p.start + a.duration)} · ${kindLabel[a.kind]}${a.locked ? " · locked" : ""}</p>
    ${p.start !== d.start || p.stage_id !== d.stage_id ? `<p>Draft slot: ${esc(stage(d.stage_id).name)} ${tm(d.start)}</p>` : ""}
    <p class="fine">Available ${tm(a.earliest)}–${tm(a.latest)} · changeover ${a.changeover} min · may play ${a.allowed_stages.map((s) => esc(stage(s).name)).join(", ")}</p>
    <p class="fine">${a.qloo_id ? `Qloo entity ${esc(a.qloo_id.slice(0, 8))}…, confirmed by a person.` : "Identity unresolved: every pair with this act is unknown, never zero."}</p>
    <div class="row"><button data-action="edit" data-act="${esc(id)}">Edit act</button>${a.qloo_id ? "" : `<button data-action="resolve" data-act="${esc(id)}">Find in Qloo</button>`}</div></div>
  <div class="tile">${
    hasEvidence()
      ? `<p><strong>${plural(cues.length, "cued partner")}</strong>${unknown ? ` · ${unknown} unknown pairs` : ""}</p>${cues
          .map((e) => {
            const o = e.a === id ? e.b : e.a;
            return `<button class="partner" data-action="pair" data-a="${esc(id)}" data-b="${esc(o)}">${esc(act(o).name)}<small>${esc(rankLine(id, o))} in ${esc(a.name)}'s row · ${esc(rankLine(o, id))} in theirs</small></button>`;
          })
          .join("")}
      ${prov.length ? `<p class="fine">${prov.map((r) => `${esc(r.type.split(":").at(-1))} row: ${esc(r.source.replaceAll("_", " "))}, ${esc(dateOf(r.at))}${r.complete ? "" : " (incomplete)"}`).join("<br>")}</p>` : ""}
      ${cov && !cov.complete ? `<p class="fine">${esc(cov.errors.join("; "))}</p>` : ""}`
      : `<p class="fine">No evidence loaded.</p>`
  }</div>`;
}
function pairPanel(a, b) {
  const A = act(a),
    B = act(b);
  const e = (ev().edges || []).find((x) => cueKey(x.a, x.b) === cueKey(a, b));
  const places = placementsFor(S.view) || day().draft;
  const pa = places.find((x) => x.act_id === a),
    pb = places.find((x) => x.act_id === b);
  const overlap = pa.stage_id === pb.stage_id ? 0 : Math.max(0, Math.min(pa.start + A.duration, pb.start + B.duration) - Math.max(pa.start, pb.start));
  const clash = overlap > day().threshold;
  const intentional = day().intentional.some((p) => cueKey(p.a, p.b) === cueKey(a, b));
  const bar = (x, y) => {
    const r = ev().ranks?.[x]?.[y];
    const n = ev().sizes?.[x]?.[kindType(act(y).kind)];
    if (!r) return `<div class="rankbar"><span>${esc(act(x).name)} → ${esc(act(y).name)}: unknown</span></div>`;
    return `<div class="rankbar ${r <= 3 ? "top" : ""}"><span>In <strong>${esc(act(x).name)}</strong>'s Qloo row, ${esc(act(y).name)} is <strong>#${r}</strong> of ${n}</span><div class="track"><div class="fill" data-css="width:${Math.max(4, 100 * (1 - (r - 1) / n))}%"></div></div></div>`;
  };
  return `<div class="tile"><h2>${esc(A.name)} × ${esc(B.name)}</h2>${bar(a, b)}${bar(b, a)}<p class="fine">${e ? `A reciprocal cue: each is in the other's top ${Math.min(ev().k, Math.ceil(e.of[0] / 4))}. The two ranks come from two separate Qloo responses and are never compared as scores.` : "Not a cue under the current rule."}</p></div>
  <div class="tile ${clash && !intentional ? "hot" : ""}"><p><strong>${clash ? `${overlap} minutes at the same time` : overlap ? `${overlap} minutes of overlap, inside the ${day().threshold}-minute tolerance` : "Not at the same time"}</strong> in this view.</p>${lensLines(a, b)}
  <div class="row"><button data-action="intentional" data-a="${esc(a)}" data-b="${esc(b)}">${intentional ? "Count this pair again" : "This clash is intentional"}</button></div>
  <p class="fine">Intentional pairs are left out of optimisation and counts. The choice is versioned.</p></div>`;
}
function lensLines(a, b) {
  const lenses = Object.values(S.project.context?.lenses || {});
  if (!lenses.length) return "";
  return `<p class="fine">Independent open data: ${lenses
    .map((l) => {
      const linked = l.edges.some((e) => cueKey(e.a, e.b) === cueKey(a, b));
      const covered = l.ids?.includes(a) && l.ids?.includes(b);
      return `${esc(l.label)} ${linked ? "<strong>also pairs them</strong>" : covered ? "does not pair them" : "cannot rank both"}`;
    })
    .join(" · ")}.</p>`;
}

// ---------- Render all ----------
function render() {
  const p = S.project;
  $("#day-name").textContent = day().name;
  $("#day-meta").textContent = `${day().acts.length} acts · ${day().stages.length} stages · v${p.version} ${p.status.toLowerCase()} · Qloo ${S.config.budget.qloo_successes}/${S.config.budget.qloo_limit}`;
  const c = p.context || {};
  $("#context").innerHTML = c.assumptions
    ? `${esc(c.note)} <details><summary>Hypothetical production rules (${c.assumptions.length})</summary><ul>${c.assumptions.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>`
    : esc(c.note || "");
  renderChapters();
  renderGrid();
  renderInspector();
}
async function reload() {
  [S.project, S.config] = await Promise.all([api(`/projects/${S.project.id}`), api("/config")]);
  const latest = S.project.proposals.find((x) => x.input_version === S.project.version);
  S.proposal = latest ? { ...latest, proposal_id: latest.id } : current() ? S.proposal : null;
  render();
}
async function openProject(id) {
  S.project = await api(`/projects/${id}`);
  store.set("counterset-project", id);
  S.selected = null;
  S.view = "draft";
  geometry = null;
  const latest = S.project.proposals.find((x) => x.input_version === S.project.version);
  S.proposal = latest ? { ...latest, proposal_id: latest.id } : null;
  const saved = store.get("counterset-chapter-" + id);
  S.chapter = saved !== null ? +saved : 0;
  render();
}
async function load() {
  S.config = await api("/config");
  setMode(store.get("counterset-mode") || "walk", false);
  const id = new URLSearchParams(location.search).get("project") || store.get("counterset-project");
  if (id) {
    try {
      await openProject(id);
      if (new URLSearchParams(location.search).has("project")) history.replaceState(null, "", "/studio");
      return;
    } catch (e) {
      if (!/not found/i.test(e.message)) throw e;
    }
  }
  const first = S.config.examples[0];
  const p = first ? await api(`/examples/${first.id}`, "POST") : await api("/projects", "POST");
  await openProject(p.id);
}
function setMode(mode, rerender = true) {
  document.body.dataset.mode = mode;
  $("#mode-walk").setAttribute("aria-pressed", mode === "walk");
  $("#mode-desk").setAttribute("aria-pressed", mode === "desk");
  store.set("counterset-mode", mode);
  if (mode === "desk") S.open = new Set([S.chapter]);
  if (rerender && S.project) renderChapters();
}
function go(i) {
  S.chapter = Math.max(0, Math.min(CHAPTERS.length - 1, i));
  store.set("counterset-chapter-" + S.project.id, S.chapter);
  S.open.add(S.chapter);
  S.allCues = S.chapter === 1 && hasEvidence();
  S.drawThreads = S.allCues;
  render();
  $(".chapter.active")?.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
}

// ---------- Dialogs ----------
function dialog(title, html, onSubmit) {
  $("#dialog-title").textContent = title;
  $("#dialog-body").innerHTML = html;
  applyCss($("#dialog-body"));
  const d = $("#dialog");
  d.returnValue = "";
  $("#dialog-form").onsubmit = (e) => {
    if (e.submitter?.value === "cancel") return;
    e.preventDefault();
    guarded(async () => {
      if (onSubmit) await onSubmit();
      d.close();
    });
  };
  d.showModal();
}
function identitiesDialog() {
  dialog(
    "Identities",
    `<p class="fine">Confirm each act against a Qloo search result. Unresolved acts stay unknown in the evidence.</p><div class="table-wrap"><table><thead><tr><th>Act</th><th>Kind</th><th>Status</th><th></th></tr></thead><tbody>${day()
      .acts.map((a) => `<tr><td>${esc(a.name)}</td><td>${kindLabel[a.kind]}</td><td>${a.qloo_id ? "confirmed" : "<strong>unresolved</strong>"}</td><td><button type="button" data-action="resolve" data-act="${esc(a.id)}">${a.qloo_id ? "Change" : "Find"}</button></td></tr>`)
      .join("")}</tbody></table></div>`,
  );
}
function resolveDialog(id) {
  const a = act(id);
  dialog(
    `Find ${a.name}`,
    `<div class="fields"><label>Search Qloo<input id="q" value="${esc(a.name)}" /></label><label>Kind<select id="q-kind">${Object.keys(kindLabel)
      .map((k) => `<option value="${k}" ${k === a.kind ? "selected" : ""}>${kindLabel[k]}</option>`)
      .join("")}</select></label></div><div class="row"><button type="button" id="q-go" ${S.config.qloo_configured ? "" : "disabled"}>Search (1 request)</button>${a.qloo_id ? `<button type="button" id="q-clear" class="ghost">Mark unresolved</button>` : ""}</div><div id="q-out" class="list"></div>`,
  );
  $("#q-go").onclick = () =>
    guarded(async () => {
      const r = await api("/resolve", "POST", { query: $("#q").value, kind: $("#q-kind").value });
      $("#q-out").innerHTML =
        r.candidates.map((c) => `<button type="button" data-confirm="${esc(c.id)}">${esc(c.name)}<small>${esc(c.disambiguation || "")} · ${esc((c.types || []).join(", "))}</small></button>`).join("") || "<p>No candidates. Leave the act unresolved.</p>";
      $$("[data-confirm]", $("#q-out")).forEach(
        (b) =>
          (b.onclick = () =>
            guarded(async () => {
              await api(`/projects/${S.project.id}/identity`, "POST", { version: S.project.version, act_id: id, qloo_id: b.dataset.confirm, kind: $("#q-kind").value });
              $("#dialog").close();
              await reload();
              say(`${a.name} confirmed. Evidence was cleared because the bill's identities changed.`);
            })),
      );
    });
  const clear = $("#q-clear");
  if (clear)
    clear.onclick = () =>
      guarded(async () => {
        await api(`/projects/${S.project.id}/identity`, "POST", { version: S.project.version, act_id: id, qloo_id: null });
        $("#dialog").close();
        await reload();
      });
}
function editDialog(id) {
  const a = act(id),
    p = day().draft.find((x) => x.act_id === id);
  dialog(
    a.name,
    `<div class="fields"><label>Stage<select id="f-stage">${day()
      .stages.map((s) => `<option value="${esc(s.id)}" ${s.id === p.stage_id ? "selected" : ""}>${esc(s.name)}</option>`)
      .join("")}</select></label><label>Draft start<input id="f-start" type="time" value="${tm(p.start)}" required /></label><label>Earliest start<input id="f-earliest" type="time" value="${tm(a.earliest)}" required /></label><label>Latest finish<input id="f-latest" type="time" value="${tm(a.latest)}" required /></label><label>Set length (min)<input id="f-duration" type="number" min="5" max="240" value="${a.duration}" /></label><label>Changeover (min)<input id="f-change" type="number" min="0" max="120" value="${a.changeover}" /></label></div>
    <label class="check"><input id="f-lock" type="checkbox" ${a.locked ? "checked" : ""} />Lock to the draft placement</label>
    <p class="fine">Editing facts creates a new version and makes open proposals stale.</p><button class="primary">Save act</button>`,
    async () => {
      const d = structuredClone(day());
      const x = d.acts.find((y) => y.id === id),
        q = d.draft.find((y) => y.act_id === id);
      const fix = (v) => (mins(v) < Math.min(...d.stages.map((s) => s.opens)) - 120 ? mins(v) + 1440 : mins(v));
      Object.assign(x, { earliest: fix($("#f-earliest").value), latest: fix($("#f-latest").value), locked: $("#f-lock").checked, duration: +$("#f-duration").value, changeover: +$("#f-change").value });
      Object.assign(q, { stage_id: $("#f-stage").value, start: fix($("#f-start").value) });
      await saveDay(d, `${a.name} updated`);
    },
  );
}
function holdDialog() {
  dialog(
    "Stage hold",
    `<div class="fields"><label>Stage<select id="h-stage">${day()
      .stages.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`)
      .join("")}</select></label><label>From<input id="h-start" type="time" value="${tm(day().draft[Math.floor(day().draft.length / 2)].start)}" required /></label><label>Until<input id="h-end" type="time" value="${tm(day().draft[Math.floor(day().draft.length / 2)].start + 45)}" required /></label><label>Reason<input id="h-reason" value="Weather hold" maxlength="200" /></label></div>
    <p class="fine">Sets that start before the hold are locked, because they have already begun. Curfews and set lengths stay fixed; the solver may report that no schedule fits.</p><button class="primary">Add hold</button>`,
    async () => {
      await api(`/projects/${S.project.id}/hold`, "POST", { version: S.project.version, stage_id: $("#h-stage").value, start: mins($("#h-start").value), end: mins($("#h-end").value), reason: $("#h-reason").value || "Stage hold" });
      S.view = "draft";
      await reload();
      say("Hold added. Sets that now break a rule are striped.");
    },
  );
}
function jsonDialog() {
  dialog("Production facts", `<textarea id="f-json" rows="20" aria-label="Day JSON">${esc(JSON.stringify(day(), null, 2))}</textarea><button class="primary">Save facts</button>`, async () => {
    await saveDay(JSON.parse($("#f-json").value), "Facts edited");
  });
}
async function openDayDialog() {
  const list = await api("/projects");
  dialog(
    "Open a day",
    `<h3>Worked examples</h3><div class="list">${S.config.examples.map((e) => `<button type="button" data-example="${esc(e.id)}">${esc(e.title)}<small>${esc(e.summary)} · ${e.acts} acts · ${e.stages} stages</small></button>`).join("") || "<p class='fine'>No private examples on this installation.</p>"}<button type="button" data-example="">Blank rehearsal day<small>Real artist names, illustrative grid, no evidence yet</small></button></div>
    <h3>Your workspaces</h3><div class="list">${list
      .slice(0, 12)
      .map((p) => `<button type="button" data-open="${esc(p.id)}">${esc(p.name)}<small>v${p.version} · ${esc(p.kind || "")}</small></button>`)
      .join("")}</div>`,
  );
  $$("[data-example]", $("#dialog")).forEach(
    (b) =>
      (b.onclick = () =>
        guarded(async () => {
          const p = b.dataset.example ? await api(`/examples/${b.dataset.example}`, "POST") : await api("/projects", "POST");
          $("#dialog").close();
          await openProject(p.id);
          say("Opened a fresh copy. Your earlier workspaces are kept.");
        })),
  );
  $$("[data-open]", $("#dialog")).forEach(
    (b) =>
      (b.onclick = () =>
        guarded(async () => {
          $("#dialog").close();
          await openProject(b.dataset.open);
        })),
  );
}
async function compareDialog() {
  dialog(
    "Compare evidence",
    `<p>Repair the same grid with the same rules and budget using different evidence, then score every result under every source. A solver always scores best on the source it optimised, so read across the rows.</p>
    <label class="check"><input id="c-llm" type="checkbox" ${S.config.model_configured ? "" : "disabled"} />Include an LLM-only schedule (Gemini 3.5 Flash Lite, no Qloo, no solver)</label>
    <div class="row"><button type="button" id="c-go" class="primary">Run comparison</button></div><div id="c-out">${S.benchmark ? benchTable(S.benchmark) : ""}</div>`,
  );
  $("#c-go").onclick = () =>
    guarded(async () => {
      S.benchmark = await job(
        `/projects/${S.project.id}/benchmark`,
        { version: S.project.version, move_budget: +(store.get("counterset-budget") || 4), seconds: 8, model: $("#c-llm").checked ? "gemini-3.5-flash-lite" : null },
        "Comparing evidence sources…",
      );
      $("#c-out").innerHTML = benchTable(S.benchmark);
    });
}
function benchTable(b) {
  const ms = Object.keys(b.measures);
  return `<div class="table-wrap"><table><thead><tr><th>Schedule</th><th>Rules</th><th>Moves</th><th>Shift</th>${ms.map((m) => `<th>${esc(m)} clashes (of ${b.measures[m]})</th>`).join("")}</tr></thead><tbody>${b.table
    .map((r) => `<tr><td>${esc(r.arm)}</td><td>${r.valid === undefined ? esc(r.status) : r.valid ? "valid" : `<strong>invalid</strong><br><span class="fine">${esc((r.errors || []).slice(0, 2).join("; "))}</span>`}${r.error ? `<br><span class="fine">${esc(r.error)}</span>` : ""}</td><td>${r.moves ?? "—"}</td><td>${r.shift ?? "—"}</td>${ms.map((m) => `<td>${r.clashes?.[m] ?? "—"}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div><p class="fine">${esc(b.scope)}</p>`;
}
function shortcutsDialog() {
  dialog(
    "Keyboard",
    `<table><tbody>${[
      ["1 – 6", "Go to a chapter"],
      ["[ and ]", "Previous or next chapter"],
      ["v", "Cycle the timetable views"],
      ["w", "Switch walkthrough and desk"],
      ["Esc", "Clear the selection"],
      ["Tab", "Move between sets; Enter inspects"],
    ]
      .map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`)
      .join("")}</tbody></table>`,
  );
}
async function saveDay(d, reason) {
  await api(`/projects/${S.project.id}`, "PUT", { version: S.project.version, day: d });
  S.view = "draft";
  await reload();
  say(`${reason}. Open proposals are now stale; repair again.`);
}

// ---------- Actions ----------
const actions = {
  cues: () => {
    S.allCues = !S.allCues;
    S.drawThreads = S.allCues;
    renderGrid();
  },
  chapter: (t) => {
    const i = +t.dataset.index;
    if (document.body.dataset.mode === "desk") {
      if (S.open.has(i) && S.chapter === i) S.open.delete(i);
      else S.open.add(i);
    }
    go(i);
  },
  next: () => go(S.chapter + 1),
  prev: () => go(S.chapter - 1),
  identities: identitiesDialog,
  resolve: (t) => resolveDialog(t.dataset.act),
  edit: (t) => editDialog(t.dataset.act),
  hold: holdDialog,
  act: (t) => {
    S.selected = S.selected?.act === t.dataset.act ? null : { act: t.dataset.act };
    renderGrid();
    renderInspector();
  },
  pair: (t) => {
    S.selected = { pair: [t.dataset.a, t.dataset.b] };
    renderGrid();
    renderInspector();
    nodes.get(t.dataset.a)?.scrollIntoView({ block: "nearest", inline: "center", behavior: reduced() ? "auto" : "smooth" });
    $("#inspector").scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
  },
  view: (t) => {
    S.view = t.dataset.view;
    S.selected = null;
    if (S.view.startsWith("opt") || S.view.startsWith("blind")) S.chapter = Math.max(S.chapter, 4);
    render();
    if (S.view.startsWith("blind")) $$(".set.clash").forEach((n) => n.classList.add("pulse"));
  },
  evidence: async (t) => {
    const live = t.dataset.source === "live";
    if (live && !confirm(`Query Qloo for this bill? Up to ${estimate()} requests; cached rows are not re-requested unless refreshing.`)) return;
    const r = await job(`/projects/${S.project.id}/evidence`, { version: S.project.version, source: live ? "live" : "cache", refresh: live && hasEvidence() }, "Reading the exact-bill Qloo rows…");
    S.proposal = null;
    S.drawThreads = S.allCues = true;
    S.chapter = 1;
    await reload();
    say(`Evidence ${r.status.toLowerCase()}. Lines connect acts that rank each other near the top.`);
  },
  message: async () => {
    const note = await job(`/projects/${S.project.id}/messages`, { version: S.project.version, text: $("#message").value, model: $("#message-model").value }, "Reading the message. Nothing is applied.");
    await reload();
    say("Review each proposed constraint. Only approved items change the day.");
  },
  review: async (t) => {
    const boxes = $$("[data-review-index]");
    const decisions = boxes.filter((b) => !b.disabled).map((b) => ({ index: +b.dataset.reviewIndex, approve: b.checked }));
    if (!decisions.length) return say("Nothing to apply.");
    await api(`/projects/${S.project.id}/messages/review`, "POST", { version: S.project.version, note_id: t.dataset.note, decisions });
    S.view = "draft";
    await reload();
    say(decisions.some((d) => d.approve) ? "Applied as a new version. Sets that now break a rule are striped." : "Declined. Nothing changed.");
  },
  repair: async () => {
    const r = await job(`/projects/${S.project.id}/repair`, { version: S.project.version, move_budget: +($("#budget")?.value || 4), seconds: 8 }, "Solving under your rules…");
    S.proposal = r;
    S.selected = null;
    await reload();
    if (options().length) {
      S.view = "opt0";
      render();
      say("Repairs ready. Moved sets slide to their new slots; outlines show where they were.");
    } else say(r.status === "INFEASIBLE" ? "No schedule satisfies every rule. See the conflicting constraints." : r.core_scope, true);
  },
  brief: async () => {
    const out = await job(`/proposals/${S.proposal.proposal_id || S.proposal.id}/briefing`, { model: "gemini-3.5-flash-lite" }, "The agent is briefing from the computed options…");
    S.proposal.briefing = out;
    renderChapters();
  },
  keep: async (t) => {
    await api(`/projects/${S.project.id}/pin`, "POST", { version: S.project.version, act_id: t.dataset.act });
    S.view = "draft";
    await reload();
    say(`${act(t.dataset.act).name} is locked to its draft slot. Re-solving…`);
    await actions.repair();
  },
  publish: async (t) => {
    const pid = S.proposal.proposal_id || S.proposal.id;
    const r = await api(`/projects/${S.project.id}/publish`, "POST", { version: S.project.version, proposal_id: pid, option: +t.dataset.option });
    S.view = "draft";
    S.proposal = null;
    await reload();
    $("#grid").classList.add("stamp");
    setTimeout(() => $("#grid").classList.remove("stamp"), 800);
    say(`Published v${r.number}. It is now the draft; exports are below.`);
  },
  export: async (t) => {
    const r = await fetch(`/api/published/${t.dataset.id}/export?format=${t.dataset.format}`, { headers: token() ? { Authorization: `Bearer ${token()}` } : {} });
    if (!r.ok) throw Error("Export failed");
    const u = URL.createObjectURL(await r.blob());
    const a = document.createElement("a");
    a.href = u;
    a.download = `counterset-${t.dataset.format === "csv" ? "timetable.csv" : "version.json"}`;
    a.click();
    URL.revokeObjectURL(u);
  },
  intentional: async (t) => {
    const d = structuredClone(day());
    const key = cueKey(t.dataset.a, t.dataset.b);
    const had = d.intentional.some((p) => cueKey(p.a, p.b) === key);
    d.intentional = had ? d.intentional.filter((p) => cueKey(p.a, p.b) !== key) : [...d.intentional, { a: t.dataset.a, b: t.dataset.b, weight: 1 }];
    await saveDay(d, had ? "Pair counts again" : "Pair marked intentional");
  },
};
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-action]");
  if (t && actions[t.dataset.action]) {
    if (t.tagName === "A") e.preventDefault();
    guarded(() => actions[t.dataset.action](t));
  }
  if (!e.target.closest("#tools, #tools-menu")) closeMenu();
});
const closeMenu = () => {
  $("#tools-menu").hidden = true;
  $("#tools").setAttribute("aria-expanded", "false");
};
$("#tools").onclick = () => {
  const m = $("#tools-menu");
  m.hidden = !m.hidden;
  $("#tools").setAttribute("aria-expanded", String(!m.hidden));
  if (!m.hidden) $("button", m).focus();
};
$("#mode-walk").onclick = () => setMode("walk");
$("#mode-desk").onclick = () => setMode("desk");
$("#open-day").onclick = () => guarded(openDayDialog);
$("#edit-json").onclick = () => (closeMenu(), jsonDialog());
$("#compare").onclick = () => (closeMenu(), guarded(compareDialog));
$("#shortcuts").onclick = () => (closeMenu(), shortcutsDialog());
$("#auth").onclick = () => {
  closeMenu();
  const t = prompt("Workspace access token (only for a protected deployment)");
  if (t !== null) {
    try {
      sessionStorage.setItem("counterset-token", t);
    } catch {}
    guarded(load);
  }
};
$("#import").onchange = (e) =>
  guarded(async () => {
    closeMenu();
    const d = JSON.parse(await e.target.files[0].text());
    const p = await api("/projects", "POST", d);
    await openProject(p.id);
    say("Imported. Confirm identities, then load evidence.");
  });
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea, select, dialog") || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key >= "1" && e.key <= "6") go(+e.key - 1);
  else if (e.key === "]") go(S.chapter + 1);
  else if (e.key === "[") go(S.chapter - 1);
  else if (e.key === "w") setMode(document.body.dataset.mode === "walk" ? "desk" : "walk");
  else if (e.key === "v") {
    const vs = $$("#views button");
    const i = vs.findIndex((b) => b.getAttribute("aria-selected") === "true");
    vs[(i + 1) % vs.length]?.click();
  } else if (e.key === "Escape") {
    S.selected = null;
    renderGrid();
    renderInspector();
  }
});
let resizeTimer;
addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => S.project && renderGrid(), 150);
});
guarded(load);
