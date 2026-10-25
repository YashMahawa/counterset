// Counterset studio. Every step reads and changes the real workspace state on the
// server; nothing in the guided mode is scripted or pre-rendered.

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
  step: 0,
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
const pairName = (a, b) => `${esc(act(a).name)} × ${esc(act(b).name)}`;
const prefName = (p) => (p === "least_time_shift" ? "Closest start times" : "Fewest changed acts");
const dateOf = (t) => (t ? new Date(t * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");
const letter = (i) => "AB"[i];
const selectedOption = () => (S.view.startsWith("opt") ? +S.view.slice(3) : options().length ? S.proposal.options.findIndex((o) => o.placements?.length && o.same_as === undefined) : null);
function overlapIn(places, a, b) {
  const pa = places.find((x) => x.act_id === a),
    pb = places.find((x) => x.act_id === b);
  if (!pa || !pb || pa.stage_id === pb.stage_id) return 0;
  return Math.max(0, Math.min(pa.start + act(a).duration, pb.start + act(b).duration) - Math.max(pa.start, pb.start));
}
function estimate() {
  const types = new Set(day().acts.filter((a) => a.qloo_id).map((a) => kindType(a.kind)));
  let n = 0;
  for (const a of day().acts.filter((a) => a.qloo_id))
    for (const t of types) if (day().acts.some((b) => b.qloo_id && b.id !== a.id && kindType(b.kind) === t)) n++;
  return n + (confirmed() ? 1 : 0);
}
const nextButton = (done) => (S.step < STEPS.length - 1 ? `<button class="${done ? "primary" : ""}" data-action="next">Next: ${STEPS[S.step + 1].tab}</button>` : "");

// ---------- Steps ----------
// Each step answers one question: the finding says the answer in a sentence, the panel holds
// the work for that step, and the side column shows the evidence for whatever is selected.
const STEPS = [
  {
    tab: "The bill",
    short: "Bill",
    title: "The bill",
    state: () => `${confirmed()}/${day().acts.length}`,
    done: () => confirmed() >= 2,
    lead: "Counterset never changes who plays, only when and where. A person matches each act to a Qloo entity before any evidence is read.",
    finding: () => {
      const open = day().acts.length - confirmed();
      return `${day().acts.length} sets on ${day().stages.length} stages. ${confirmed()} acts are confirmed in Qloo${open ? `; ${open} stay unresolved, so their pairs count as unknown, never as zero` : ""}.`;
    },
    actions: (done) => `<button data-action="identities">Review identities</button>${nextButton(done)}`,
    panel: () => {
      const open = day().acts.filter((a) => !a.qloo_id);
      const kinds = {};
      day().acts.forEach((a) => (kinds[a.kind] = (kinds[a.kind] || 0) + 1));
      const shown = open.slice(0, 6);
      return `<div class="section-head"><h2>Unresolved acts</h2><small>${open.length} of ${day().acts.length}</small></div>
      ${
        open.length
          ? `<table class="stack"><thead><tr><th>Act</th><th>Kind</th><th>Slot</th><th></th></tr></thead><tbody>${shown
              .map((a) => {
                const p = day().draft.find((x) => x.act_id === a.id);
                return `<tr><td>${esc(a.name)}</td><td class="extra">${kindLabel[a.kind]}</td><td class="extra num">${esc(stage(p.stage_id).name)} ${tm(p.start)}</td><td class="num"><button class="link" data-action="resolve" data-act="${esc(a.id)}">Find in Qloo</button></td></tr>`;
              })
              .join("")}</tbody></table>${open.length > shown.length ? `<button class="link" data-action="identities">View all ${open.length} unresolved acts</button>` : ""}`
          : `<p class="empty">Every act on this bill is confirmed.</p>`
      }
      <p class="fine">On the bill: ${Object.entries(kinds)
        .map(([k, n]) => `${n} ${kindLabel[k]}`)
        .join(" · ")}.</p>`;
    },
    aside: () => {
      const c = S.project.context || {};
      return `<h2>About this day</h2><p>${esc(c.summary || c.note || "A rehearsal day.")}</p>
      ${c.source ? `<p class="fine"><a href="${esc(c.source)}" target="_blank" rel="noreferrer">Published timetable</a>${c.corroboration ? ` · <a href="${esc(c.corroboration)}" target="_blank" rel="noreferrer">second source</a>` : ""}</p>` : ""}
      ${c.assumptions ? `<details><summary>Hypothetical production rules (${c.assumptions.length})</summary><ul>${c.assumptions.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>` : ""}`;
    },
  },
  {
    tab: "Shared crowds",
    short: "Crowds",
    title: "Shared crowds",
    state: () => (hasEvidence() ? `${ev().edges.length}` : "—"),
    done: hasEvidence,
    lead: "Each act asks Qloo to rank every other act on this bill, one response per kind of act. When two acts rank each other near the top, they probably share a crowd.",
    finding: () => {
      if (!hasEvidence()) return `No evidence yet. Reading this bill takes ${estimate()} Qloo requests; rows already fetched come from the private cache.`;
      const cross = ev().edges.filter((x) => x.cross).length;
      return `${ev().edges.length} pairs share a crowd${cross ? `, ${cross} of them across kinds of act` : ""}. ${plural(S.project.audit.counts.qloo, "pair plays", "pairs play")} at the same time in this grid.`;
    },
    actions: (done) =>
      hasEvidence()
        ? `<button data-action="evidence" data-source="live" ${S.config.qloo_configured ? "" : "disabled"}>Refresh from Qloo</button>${nextButton(done)}`
        : `<button data-action="evidence" data-source="live" ${S.config.qloo_configured ? "" : "disabled"}>Query Qloo live</button><button class="primary" data-action="evidence" data-source="cache">Load cached rows</button>`,
    panel: () => {
      const e = ev();
      if (!e.id) return `<h2>Strongest pairs</h2><p class="empty">Load the evidence to see which acts on this bill share a crowd.</p>`;
      const places = placementsFor(S.view) || day().draft;
      const top = [...e.edges].sort((x, y) => x.ranks[0] + x.ranks[1] - (y.ranks[0] + y.ranks[1])).slice(0, 6);
      const order = e.order_control?.passed ? "passed" : e.order_control?.passed === false ? "failed" : "not run";
      return `<div class="kpis"><div><span>Pairs that share a crowd</span><strong>${e.edges.length}</strong></div><div><span>Complete Qloo rows</span><strong>${e.complete_rows} <small class="fine">/ ${e.total_rows}</small></strong></div><div><span>Unknown pairs</span><strong>${e.unknown.length}</strong></div><div class="${order === "failed" ? "bad" : ""}"><span>Order check</span><strong>${order}</strong></div></div>
      <div class="section-head"><h2>Strongest pairs</h2><button class="link" data-action="cues" aria-pressed="${S.allCues}">${S.allCues ? "Hide" : "Show"} all ${e.edges.length} on the timetable</button></div>
      <table class="stack"><thead><tr><th>Pair</th><th class="num">Rank each way</th><th class="num">In this grid</th></tr></thead><tbody>${top
        .map((x) => {
          const o = overlapIn(places, x.a, x.b);
          const on = S.selected?.pair && cueKey(...S.selected.pair) === cueKey(x.a, x.b);
          return `<tr class="pick ${on ? "on" : ""}" data-action="pair" data-a="${esc(x.a)}" data-b="${esc(x.b)}"><td><button class="link">${pairName(x.a, x.b)}</button></td><td class="num extra">${esc(rankLine(x.a, x.b))} · ${esc(rankLine(x.b, x.a))}</td><td class="num">${o > day().threshold ? `<span class="pill bad">Clash ${o} min</span>` : `<span class="pill">Apart</span>`}</td></tr>`;
        })
        .join("")}</tbody></table>`;
    },
    aside: () => {
      const e = ev();
      if (!e.id) return `<h2>How a pair is read</h2><p>Every act gets one Qloo request per kind of act on the bill, asking it to rank exactly the other acts. Ranks are read only inside one response.</p>`;
      return `<h2>How a pair is read</h2><p>A pair counts when each act ranks the other in its top ${e.k}, never more than a quarter of the acts of that kind. Scores from different responses are never compared.</p>
      <p class="fine">Status ${esc(e.status.toLowerCase())} · fetched ${esc(dateOf(e.fetched_at))}${S.project.evidence_state?.stale ? ` · <span class="pill warn">stale</span>` : ""}</p><p class="fine">Select a pair or a set to see both ranks.</p>`;
    },
  },
  {
    tab: "Audit",
    short: "Audit",
    title: "Audit the grid",
    state: () => (hasEvidence() ? `${S.project.audit.counts.qloo}` : "—"),
    done: () => hasEvidence() && S.step > 2,
    lead: () => `A clash is a pair that shares a crowd, playing on different stages for more than ${day().threshold} minutes at once. Its fans have to choose.`,
    finding: () => {
      if (!hasEvidence()) return "Load the evidence in Shared crowds first.";
      const a = S.project.audit;
      const f = S.project.random_fill;
      const share = f?.samples ? ` ${Math.round(f.share_at_or_below * 100)}% of random fills of the same slots clash as little.` : "";
      return `${plural(a.counts.qloo, "pair that shares a crowd clashes", "pairs that share a crowd clash")} in this grid.${share}${a.errors.length ? ` ${plural(a.errors.length, "rule is", "rules are")} broken.` : ""}`;
    },
    actions: (done) => nextButton(hasEvidence()),
    panel: () => {
      if (!hasEvidence()) return `<h2>Clashes</h2><p class="empty">No evidence loaded.</p>`;
      const a = S.project.audit;
      const clashes = a.conflicts.filter((c) => c.source === "qloo" || c.source === "must_see");
      return `<div class="section-head"><h2>Clashes in this grid</h2><small>${clashes.length}</small></div>
      ${
        clashes.length
          ? `<table class="stack"><thead><tr><th>Pair</th><th class="num">Rank each way</th><th class="num">Overlap</th></tr></thead><tbody>${clashes
              .map((c) => {
                const on = S.selected?.pair && cueKey(...S.selected.pair) === cueKey(c.a, c.b);
                return `<tr class="pick ${on ? "on" : ""}" data-action="pair" data-a="${esc(c.a)}" data-b="${esc(c.b)}"><td><button class="link">${pairName(c.a, c.b)}</button></td><td class="num extra">${c.source === "must_see" ? `${c.weight} attendee picks` : esc(rankLine(c.a, c.b) + " · " + rankLine(c.b, c.a))}</td><td class="num">${c.minutes} min</td></tr>`;
              })
              .join("")}</tbody></table>`
          : `<p class="empty">No pair that shares a crowd clashes in this grid.</p>`
      }
      ${a.errors.length ? `<div class="section-head"><h2>Rules broken</h2><small>${a.errors.length}</small></div>${a.errors.map((x) => `<p class="note bad">${esc(x)}</p>`).join("")}` : ""}
      <p class="fine">If a clash is on purpose, select it and mark it intentional.</p>`;
    },
    aside: () => {
      const f = S.project.random_fill;
      if (!hasEvidence() || !f?.samples) return `<h2>Against chance</h2><p class="fine">Available once evidence is loaded.</p>`;
      const max = Math.max(...f.histogram.map((x) => x[1]));
      const share = Math.round(f.share_at_or_below * 100);
      return `<h2>Against chance</h2>
      <p>The same acts shuffled into the same slots ${f.samples.toLocaleString()} times: ${share}% clash as little as this grid (average ${f.mean}).</p>
      <div><div class="hist" role="img" aria-label="Clashes per shuffle; this grid has ${f.observed}">${f.histogram.map(([k, n]) => `<div class="${k === f.observed ? "here" : ""}" data-css="height:${Math.max(2, (n / max) * 100)}%"></div>`).join("")}</div>
      <div class="hist-axis" aria-hidden="true">${f.histogram.map(([k]) => `<span>${k}</span>`).join("")}</div></div>
      <p class="fine">Clashes per shuffle; red is this grid. ${share <= 10 ? "This grid is far more careful than chance." : share >= 50 ? "The slot pattern alone explains this count." : "Somewhat more careful than chance."}</p>`;
    },
  },
  {
    tab: "Something changes",
    short: "Change",
    title: "Something changes",
    state: () => (day().outages.length ? `${day().outages.length}` : "—"),
    done: () => day().outages.length > 0 || S.project.notes.some((n) => n.items?.some((i) => i.status === "APPROVED")),
    lead: "Paste the message production sends you. A model proposes constraints, each quoted word for word from the message. Nothing changes until you tick it.",
    finding: () => {
      const holds = day().outages.length;
      const broken = (S.project.audit.invalid || []).length;
      if (!holds && !broken) return "Nothing has changed yet. Read a production message, or add a stage hold by hand.";
      return `${holds ? `${plural(holds, "stage hold")} in place` : "No stage hold"}. ${broken ? `${plural(broken, "set now breaks", "sets now break")} a rule and must move.` : "Every set still keeps the rules."}`;
    },
    actions: (done) => `<button data-action="hold">Add a stage hold</button>${nextButton(done)}`,
    panel: () => {
      const note = S.project.notes[0];
      return `<label>Production message<textarea id="message" rows="3">${esc(sampleMessage())}</textarea></label>
      <div class="row"><select id="message-model" aria-label="Model"><option value="gemma-4-31b-it">Gemma 4 31B · high thinking</option><option value="gemini-3.5-flash-lite">Gemini 3.5 Flash Lite · high thinking</option></select><button class="${note ? "" : "primary"}" data-action="message" ${S.config.model_configured ? "" : "disabled"}>Read the message</button></div>
      <p class="fine">${S.project.context?.kind === "retrospective" ? "This sample message is hypothetical. The festival did not send it." : "Sample message for rehearsal."}</p>
      ${note ? reviewList(note) : ""}`;
    },
    aside: () => {
      const holds = day().outages;
      const broken = S.project.audit.invalid || [];
      return `<h2>Holds</h2>${
        holds.length ? holds.map((o) => `<p class="note"><strong>${esc(stage(o.stage_id).name)}</strong> ${tm(o.start)}–${tm(o.end)}<br><span class="fine">${esc(o.reason)}</span></p>`).join("") : `<p class="empty">No stage is on hold.</p>`
      }${broken.length ? `<h2>Sets that must move</h2><p>${broken.map((id) => esc(act(id).name)).join(", ")}</p>` : ""}`;
    },
  },
  {
    tab: "Repair",
    short: "Repair",
    title: "Choose a repair",
    state: () => (options().length ? `${options().filter((o) => o.same_as === undefined).length}` : S.proposal?.status === "INFEASIBLE" && current() ? "none" : "—"),
    done: () => options().length > 0,
    lead: "The solver keeps every production rule, then puts attendee must-sees first, Qloo pairs second and your preference third. Each option is solved again without Qloo, so you see what the evidence changed.",
    finding: () => {
      if (!hasEvidence()) return "Load the evidence in Shared crowds first.";
      if (!current()) return "Find repairs that keep every production rule.";
      if (!options().length) return "No schedule satisfies every rule. The side column lists the rules that conflict.";
      const o = option(selectedOption());
      const prot = o.without_qloo?.protected || [];
      return `Option ${letter(selectedOption())} changes ${plural(o.audit.moves, "act")} by ${o.audit.displacement} minutes in total and leaves ${plural(o.audit.counts.qloo, "clash", "clashes")}.${prot.length ? ` Without Qloo it would also split ${prot.map((x) => pairName(x.a, x.b)).join(", ")}.` : ""}`;
    },
    actions: (done) => (hasEvidence() ? `<button class="${done ? "" : "primary"}" data-action="repair">${done ? "Find again" : "Find repairs"}</button>${done ? nextButton(true) : ""}` : ""),
    panel: () => {
      if (!hasEvidence()) return `<h2>Options</h2><p class="empty">No evidence loaded.</p>`;
      const budget = store.get("counterset-budget") || 4;
      let out = `<label class="budget">Up to <output id="budget-out">${budget}</output> acts may change<input id="budget" type="range" min="0" max="${Math.min(12, day().acts.length)}" value="${budget}" /></label>`;
      if (!current() || !options().length) return out;
      const p = S.proposal;
      const rows = p.options
        .map((o, i) => {
          if (!o.placements?.length || o.same_as !== undefined) return "";
          const prot = o.without_qloo?.protected || [];
          const on = S.view === `opt${i}` || (S.view === `blind${i}`);
          return `<tr class="pick option ${on ? "on" : ""}" data-action="view" data-view="opt${i}"><td><button class="link">Option ${letter(i)}</button><span class="sub">${prefName(o.priority)}${o.status === "OPTIMAL" ? "" : " · not proven best"}</span></td><td class="num">${o.audit.moves}</td><td class="num">${o.audit.displacement} min</td><td class="num">${o.audit.counts.qloo}</td><td class="num extra">${prot.length ? `<span class="pill bad">${prot.length} more clash${prot.length > 1 ? "es" : ""}</span>` : `<span class="pill">${o.without_qloo?.identical ? "No change" : "No extra clash"}</span>`}</td></tr>`;
        })
        .join("");
      const same = p.options.filter((o) => o.same_as !== undefined).map((o) => `<p class="fine">“${prefName(o.priority)}” gives the same schedule as option A.</p>`).join("");
      const i = selectedOption();
      return `${out}<table class="stack"><thead><tr><th>Option</th><th class="num">Acts changed</th><th class="num">Total shift</th><th class="num">Clashes left</th><th class="num">Without Qloo</th></tr></thead><tbody>${rows}</tbody></table>${same}
      <div class="section-head"><h2>Moves in option ${letter(i)}</h2><small>Keep a set where it is and the solver runs again</small></div>${diffList(option(i).placements)}`;
    },
    aside: () => {
      if (!current()) return `<h2>What the solver keeps</h2><p>Availability, changeovers, stage hours, holds, locks and the curfew are never relaxed. If nothing fits, it says which rules conflict.</p>`;
      const p = S.proposal;
      if (!options().length) return `<h2>Rules in conflict</h2><p class="fine">${esc(p.core_scope || p.status)}</p>${(p.core || []).map((c) => `<p class="note bad">${esc(c)}</p>`).join("")}<p class="fine">Remove or edit one of these, then repair again.</p>`;
      const i = selectedOption();
      const o = option(i);
      const prot = o.without_qloo?.protected || [];
      const blind = o.without_qloo?.placements && !o.without_qloo.identical;
      return `<h2>What Qloo changed</h2><p>${prot.length ? `Without Qloo, option ${letter(i)} would leave ${prot.map((x) => `<strong>${pairName(x.a, x.b)}</strong> (${x.minutes} min)`).join(", ")} playing at the same time.` : o.without_qloo?.identical ? "Nothing: the same repair comes out without Qloo." : "Without Qloo the repair differs but leaves no extra clash."}</p>
      ${blind ? `<div class="row"><button data-action="view" data-view="${S.view === `blind${i}` ? `opt${i}` : `blind${i}`}">${S.view === `blind${i}` ? `Back to option ${letter(i)}` : `Show ${letter(i)} without Qloo`}</button></div>` : ""}
      <h2>Briefing</h2>${p.briefing ? `<p>${esc(p.briefing.text)}</p><p class="fine">${p.briefing.source === "model" ? "Written by the model; every number checked against the options." : `Computed summary${p.briefing.rejected ? ` (model briefing rejected: ${esc(p.briefing.rejected)})` : ""}.`}</p>` : `<div class="row"><button data-action="brief" ${S.config.model_configured ? "" : "disabled"}>Ask the agent for a briefing</button></div>`}`;
    },
  },
  {
    tab: "Approve",
    short: "Approve",
    title: "Approve",
    state: () => (S.project.versions.length ? `v${S.project.versions.at(-1).number}` : "—"),
    done: () => S.project.status === "PUBLISHED",
    lead: "Approving re-runs the independent validator, freezes the schedule as a numbered version and makes it the new draft.",
    finding: () => {
      const i = selectedOption();
      const vs = S.project.versions;
      if (i !== null && i >= 0 && option(i)?.audit) return `Approving option ${letter(i)} publishes v${vs.length + 1}: ${plural(option(i).audit.moves, "act moves", "acts move")}, ${plural(option(i).audit.counts.qloo, "clash", "clashes")} left.`;
      if (vs.length) return `v${vs.at(-1).number} is published and is now the draft.`;
      return "Find a repair first.";
    },
    actions: () => {
      const i = selectedOption();
      return i !== null && i >= 0 && option(i)?.audit ? `<button class="primary" data-action="publish" data-option="${i}">Approve option ${letter(i)} as v${S.project.versions.length + 1}</button>` : "";
    },
    panel: () => {
      const i = selectedOption();
      if (i === null || i < 0 || !option(i)?.audit) return `<h2>Changes</h2><p class="empty">Nothing waiting for approval.</p>`;
      return `<div class="section-head"><h2>Changes in option ${letter(i)}</h2><small>${plural(option(i).audit.moves, "act")}</small></div>${diffList(option(i).placements, false)}`;
    },
    aside: () => {
      const vs = S.project.versions;
      return `<h2>Published versions</h2>${
        vs.length
          ? `<table><tbody>${vs
              .slice()
              .reverse()
              .map((v) => `<tr><td>v${v.number}<span class="sub">${esc(dateOf(v.published_at))} · ${plural(v.audit.moves, "act")} changed</span></td><td class="num"><button class="link" data-action="export" data-id="${esc(v.id)}" data-format="csv">CSV</button> · <button class="link" data-action="export" data-id="${esc(v.id)}" data-format="json">JSON</button></td></tr>`)
              .join("")}</tbody></table>`
          : `<p class="empty">Nothing published yet.</p>`
      }`;
    },
  },
];

function reviewList(note) {
  const live = note.input_version === S.project.version;
  const pending = note.items.some((it) => it.status === "PENDING_REVIEW");
  const pillOf = (s) => (s === "REJECTED" ? "bad" : s === "APPROVED" ? "good" : "");
  return `<div class="section-head"><h2>Proposed changes</h2><small>Read by ${esc(note.model || note.telemetry?.model || "model")}</small></div>
  <table class="stack"><tbody>${note.items
    .map(
      (it, i) => `<tr><td>${
        it.status === "PENDING_REVIEW" && live
          ? `<label class="check"><input type="checkbox" data-review-index="${i}" ${it.action === "unsupported" ? "disabled" : "checked"} /><span>${esc(describe(it))}<span class="sub">“${esc(it.quote)}”${it.reason ? ` · ${esc(it.reason)}` : ""}</span></span></label>`
          : `${esc(describe(it))}<span class="sub">“${esc(it.quote)}”${it.reason ? ` · ${esc(it.reason)}` : ""}</span>`
      }</td><td class="num"><span class="pill ${pillOf(it.status)}">${esc(it.status.replaceAll("_", " ").toLowerCase())}</span></td></tr>`,
    )
    .join("")}</tbody></table>
  ${pending && live ? `<div class="row"><button class="primary" data-action="review" data-note="${esc(note.id)}">Apply ticked changes</button></div>` : pending ? `<p class="fine">The day changed after this message was read. Read it again to review.</p>` : ""}
  <p class="fine">The controller checked every item: exact quote, known act or stage, valid time.</p>`;
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
      return `<tr><td>${esc(act(p.act_id).name)}</td><td class="extra num">${esc(stage(d.stage_id).name)} ${tm(d.start)} → ${esc(stage(p.stage_id).name)} ${tm(p.start)}</td><td class="num">${shift > 0 ? "+" : ""}${shift} min</td>${keep ? `<td class="num"><button class="link" data-action="keep" data-act="${esc(p.act_id)}">Keep original</button></td>` : ""}</tr>`;
    })
    .join("");
  return rows ? `<table class="stack"><thead><tr><th>Act</th><th class="num">From → to</th><th class="num">Shift</th>${keep ? "<th></th>" : ""}</tr></thead><tbody>${rows}</tbody></table>` : `<p class="empty">No set moves.</p>`;
}

function renderSteps() {
  $("#steps").innerHTML = STEPS.map(
    (s, i) => `<button class="step" data-action="step" data-index="${i}" aria-current="${i === S.step ? "step" : "false"}"><span class="long">${s.tab}</span><span class="short">${s.short}</span><small>${esc(s.state())}</small></button>`,
  ).join("");
}
function renderStep() {
  const s = STEPS[S.step];
  $("#step-title").textContent = s.title;
  $("#step-finding").innerHTML = s.finding();
  $("#step-lead").textContent = typeof s.lead === "function" ? s.lead() : s.lead;
  $("#step-actions").innerHTML = s.actions(s.done());
  $("#panel").innerHTML = s.panel();
  applyCss($("#panel"));
  const b = $("#budget");
  if (b)
    b.oninput = () => {
      $("#budget-out").value = b.value;
      store.set("counterset-budget", b.value);
    };
  renderSteps();
}

// ---------- Timetable ----------
const LANE = 48,
  AXIS = 32;
let LABEL = 124;
const nodes = new Map();
let lastFocusView = null;
let geometry = null;
function layout() {
  const d = day();
  LABEL = innerWidth < 760 ? 92 : 124;
  const origin = Math.floor(Math.min(...d.stages.map((s) => s.opens), ...d.draft.map((p) => p.start)) / 60) * 60;
  const end = Math.ceil(Math.max(...d.stages.map((s) => s.closes)) / 60) * 60;
  const wrap = $("#grid-wrap").clientWidth || 900;
  const ppm = Math.max(innerWidth < 760 ? 1.6 : 1.2, (wrap - LABEL - 24) / (end - origin));
  return { origin, end, ppm, width: LABEL + (end - origin) * ppm + 8, height: AXIS + d.stages.length * LANE + 4 };
}
const xOf = (g, t) => LABEL + (t - g.origin) * g.ppm;
const yOf = (sid) => AXIS + day().stages.findIndex((s) => s.id === sid) * LANE + 4;

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
  $$(".frame", grid).forEach((n) => n.remove());
  let frame = "";
  for (let t = g.origin; t <= g.end; t += 60) frame += `<span class="frame tick" data-css="left:${xOf(g, t) - 20}px">${tm(t)}</span><span class="frame hour" data-css="left:${xOf(g, t)}px"></span>`;
  day().stages.forEach((s, i) => {
    frame += `<div class="frame lane" data-css="top:${AXIS + i * LANE}px;height:${LANE}px"><div class="lane-name" title="${esc(s.name)}">${esc(s.name)}</div></div>`;
  });
  for (const o of day().outages)
    frame += `<div class="frame hold" data-css="left:${xOf(g, o.start)}px;top:${yOf(o.stage_id)}px;width:${(o.end - o.start) * g.ppm}px"><span>Hold ${tm(o.start)}–${tm(o.end)}</span></div>`;
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
    el.classList.toggle("narrow", w < 84);
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
      wrap.scrollTo({ left: Math.max(0, x - 160), behavior: reduced() ? "auto" : "smooth" });
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
    svg.setAttribute("class", "threads");
    svg.setAttribute("width", g.width);
    svg.setAttribute("height", g.height);
    svg.setAttribute("aria-hidden", "true");
    ev().edges.forEach((e, i) => {
      const pa = pos[e.a],
        pb = pos[e.b];
      if (!pa || !pb) return;
      const isFocus = focus && focus.has(e.a) && focus.has(e.b) && (!S.selected?.act || e.a === S.selected.act || e.b === S.selected.act);
      const isClash = clash.has(cueKey(e.a, e.b));
      // Only clashes and the selection are drawn by default; every pair only on request.
      if (!S.allCues && !isFocus && !isClash) return;
      if (focus && !isFocus && !S.allCues) return;
      const A = act(e.a),
        B = act(e.b);
      let x1 = xOf(g, pa.start) + (A.duration * g.ppm) / 2,
        y1 = yOf(pa.stage_id),
        x2 = xOf(g, pb.start) + (B.duration * g.ppm) / 2,
        y2 = yOf(pb.stage_id);
      let d;
      if (y1 === y2) d = `M${x1},${y1} C${x1},${y1 - 20} ${x2},${y2 - 20} ${x2},${y2}`;
      else {
        if (y1 > y2) [x1, y1, x2, y2] = [x2, y2, x1, y1];
        y1 += 40;
        const m = (y1 + y2) / 2;
        d = `M${x1},${y1} C${x1},${m} ${x2},${m} ${x2},${y2}`;
      }
      const path = document.createElementNS(svgns, "path");
      path.setAttribute("d", d);
      path.setAttribute("class", `${isClash ? "clash" : ""} ${isFocus ? "focus" : ""}`);
      svg.appendChild(path);
      if (S.drawThreads && !reduced()) {
        path.style.setProperty("--delay", `${Math.min(i * 18, 700)}ms`);
        path.style.setProperty("--len", 2000);
        path.classList.add("drawing");
      }
    });
    grid.appendChild(svg);
    S.drawThreads = false;
  };
  if (old && !reduced()) threadTimer = setTimeout(draw, 600);
  else draw();
}

function renderViews() {
  const views = [["draft", S.project.status === "PUBLISHED" ? `Published v${S.project.versions.at(-1)?.number}` : "Current draft"]];
  if (current())
    S.proposal.options.forEach((o, i) => {
      if (!o.placements?.length || o.same_as !== undefined) return;
      views.push([`opt${i}`, `Option ${letter(i)}`]);
      if (o.without_qloo?.placements && !o.without_qloo.identical) views.push([`blind${i}`, `${letter(i)} without Qloo`]);
    });
  if (!views.some(([v]) => v === S.view)) S.view = "draft";
  $("#views").innerHTML =
    views.length === 1
      ? `<span class="solo">${views[0][1]}</span>`
      : views.map(([v, label]) => `<button role="tab" class="${v.startsWith("blind") ? "blind" : ""}" data-action="view" data-view="${v}" aria-selected="${v === S.view}">${label}</button>`).join("");
}
function renderLegend() {
  const items = [];
  if (hasEvidence()) items.push(`<span><i class="clash"></i>Clash</span>`);
  if (S.view !== "draft") items.push(`<span><i class="moved"></i>Moved</span>`);
  if (day().acts.some((a) => !a.qloo_id)) items.push(`<span><i class="unknown"></i>Unresolved</span>`);
  if (day().outages.length) items.push(`<span><i class="hold"></i>Hold</span>`);
  $("#legend").innerHTML = items.join("") + (hasEvidence() ? `<button class="quiet" data-action="cues" aria-pressed="${S.allCues}">${S.allCues ? "Hide" : "Show"} all pairs</button>` : "");
}

// ---------- Inspector ----------
function renderInspector() {
  const box = $("#inspector");
  const sel = S.selected;
  box.innerHTML = sel?.act ? actPanel(sel.act) : sel?.pair ? pairPanel(...sel.pair) : STEPS[S.step].aside();
  applyCss(box);
}
const back = `<button class="link" data-action="deselect">← Back to ${"this step"}</button>`;
function actPanel(id) {
  const a = act(id);
  const places = placementsFor(S.view) || day().draft;
  const p = places.find((x) => x.act_id === id);
  const d = day().draft.find((x) => x.act_id === id);
  const cues = cuesOf(id);
  const unknown = (ev().unknown || []).filter((u) => u.a === id || u.b === id).length;
  const cov = ev().coverage?.[id];
  return `${back}<div><h2>${esc(a.name)}</h2><p class="fine">${esc(stage(p.stage_id).name)} ${tm(p.start)}–${tm(p.start + a.duration)} · ${kindLabel[a.kind]}${a.locked ? " · locked" : ""}${p.start !== d.start || p.stage_id !== d.stage_id ? ` · draft ${esc(stage(d.stage_id).name)} ${tm(d.start)}` : ""}</p></div>
    <p class="fine">Available ${tm(a.earliest)}–${tm(a.latest)} · changeover ${a.changeover} min · may play ${a.allowed_stages.map((s) => esc(stage(s).name)).join(", ")}.</p>
    <p class="fine">${a.qloo_id ? "Qloo identity confirmed by a person." : "Identity unresolved: every pair with this act is unknown, never zero."}</p>
    <div class="row"><button data-action="edit" data-act="${esc(id)}">Edit act</button>${a.qloo_id ? "" : `<button data-action="resolve" data-act="${esc(id)}">Find in Qloo</button>`}</div>
    ${
      hasEvidence()
        ? `<div class="section-head"><h2>Shares a crowd with</h2><small>${cues.length}${unknown ? ` · ${unknown} unknown` : ""}</small></div>${
            cues.length
              ? `<table><tbody>${cues
                  .map((e) => {
                    const o = e.a === id ? e.b : e.a;
                    return `<tr class="pick" data-action="pair" data-a="${esc(id)}" data-b="${esc(o)}"><td><button class="link">${esc(act(o).name)}</button></td><td class="num">${esc(rankLine(id, o))}<span class="sub">${esc(rankLine(o, id))} back</span></td></tr>`;
                  })
                  .join("")}</tbody></table>`
              : `<p class="empty">No pair for this act under the current rule.</p>`
          }${cov && !cov.complete ? `<p class="fine">${esc(cov.errors.join("; "))}</p>` : ""}`
        : ""
    }`;
}
function pairPanel(a, b) {
  const e = (ev().edges || []).find((x) => cueKey(x.a, x.b) === cueKey(a, b));
  const places = placementsFor(S.view) || day().draft;
  const overlap = overlapIn(places, a, b);
  const clash = overlap > day().threshold;
  const intentional = day().intentional.some((p) => cueKey(p.a, p.b) === cueKey(a, b));
  const bar = (x, y) => {
    const r = ev().ranks?.[x]?.[y];
    const n = ev().sizes?.[x]?.[kindType(act(y).kind)];
    if (!r) return `<div class="rank"><span>${esc(act(x).name)} → ${esc(act(y).name)}: unknown</span></div>`;
    return `<div class="rank"><span>In ${esc(act(x).name)}'s Qloo row, ${esc(act(y).name)} is <strong>#${r} of ${n}</strong></span><div class="track"><div class="fill" data-css="width:${Math.max(3, 100 * (1 - (r - 1) / n))}%"></div></div></div>`;
  };
  return `${back}<h2>${pairName(a, b)}</h2>${bar(a, b)}${bar(b, a)}
  <p class="fine">${e ? `Each is in the other's top ${Math.min(ev().k, Math.ceil(e.of[0] / 4))}. The two ranks come from two separate Qloo responses.` : "Not a pair under the current rule."}</p>
  <p class="note ${clash && !intentional ? "bad" : ""}">${clash ? `${overlap} minutes at the same time` : overlap ? `${overlap} minutes of overlap, inside the ${day().threshold}-minute tolerance` : "Not at the same time"} in this view.</p>
  ${lensLines(a, b)}
  <div class="row"><button data-action="intentional" data-a="${esc(a)}" data-b="${esc(b)}">${intentional ? "Count this pair again" : "This clash is intentional"}</button></div>`;
}
function lensLines(a, b) {
  const lenses = Object.values(S.project.context?.lenses || {});
  if (!lenses.length) return "";
  return `<p class="fine">Open data: ${lenses
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
  $("#day-meta").textContent = `${day().acts.length} acts · ${day().stages.length} stages · v${p.version} ${p.status.toLowerCase()}`;
  $("#budget-stamp").textContent = `Qloo ${S.config.budget.qloo_successes.toLocaleString()} of ${S.config.budget.qloo_limit.toLocaleString()} calls`;
  $("#context").textContent = p.context?.note || "";
  renderStep();
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
  const saved = store.get("counterset-step-" + id);
  S.step = saved !== null ? +saved : 0;
  render();
}
async function load() {
  S.config = await api("/config");
  setMode(store.get("counterset-mode") || "walk");
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
function setMode(mode) {
  document.body.dataset.mode = mode;
  $("#mode-walk").setAttribute("aria-pressed", mode === "walk");
  $("#mode-desk").setAttribute("aria-pressed", mode === "desk");
  store.set("counterset-mode", mode);
}
function go(i) {
  S.step = Math.max(0, Math.min(STEPS.length - 1, i));
  store.set("counterset-step-" + S.project.id, S.step);
  S.selected = null;
  S.allCues = false;
  say("");
  render();
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
      .join("")}</select></label></div><div class="row"><button type="button" id="q-go" ${S.config.qloo_configured ? "" : "disabled"}>Search (1 request)</button>${a.qloo_id ? `<button type="button" id="q-clear" class="ghost">Mark unresolved</button>` : ""}</div><div id="q-out" class="choices"></div>`,
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
    `<h3>Worked examples</h3><div class="choices">${S.config.examples.map((e) => `<button type="button" data-example="${esc(e.id)}">${esc(e.title)}<small>${esc(e.summary)} · ${e.acts} acts · ${e.stages} stages</small></button>`).join("") || "<p class='fine'>No private examples on this installation.</p>"}<button type="button" data-example="">Blank rehearsal day<small>Real artist names, illustrative grid, no evidence yet</small></button></div>
    <h3>Your workspaces</h3><div class="choices">${list
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
      ["1 – 6", "Go to a step"],
      ["[ and ]", "Previous or next step"],
      ["v", "Cycle the timetable views"],
      ["w", "Switch guided and desk"],
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

function select(sel) {
  S.selected = sel;
  renderGrid();
  renderInspector();
  const key = sel?.pair ? cueKey(...sel.pair) : null;
  $$("#panel tr.pick[data-a]").forEach((r) => r.classList.toggle("on", key === cueKey(r.dataset.a, r.dataset.b)));
}

// ---------- Actions ----------
const actions = {
  cues: () => {
    S.allCues = !S.allCues;
    S.drawThreads = S.allCues;
    renderGrid();
    if (S.step === 1) renderStep();
  },
  step: (t) => go(+t.dataset.index),
  deselect: () => select(null),
  next: () => go(S.step + 1),
  prev: () => go(S.step - 1),
  identities: identitiesDialog,
  resolve: (t) => resolveDialog(t.dataset.act),
  edit: (t) => editDialog(t.dataset.act),
  hold: holdDialog,
  act: (t) => select(S.selected?.act === t.dataset.act ? null : { act: t.dataset.act }),
  pair: (t) => {
    select({ pair: [t.dataset.a, t.dataset.b] });
    $("#inspector").scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
  },
  view: (t) => {
    S.view = t.dataset.view;
    S.selected = null;
    if (S.view.startsWith("opt") || S.view.startsWith("blind")) S.step = Math.max(S.step, 4);
    render();
    if (S.view.startsWith("blind")) $$(".set.clash").forEach((n) => n.classList.add("pulse"));
  },
  evidence: async (t) => {
    const live = t.dataset.source === "live";
    if (live && !confirm(`Query Qloo for this bill? Up to ${estimate()} requests; cached rows are not re-requested unless refreshing.`)) return;
    const r = await job(`/projects/${S.project.id}/evidence`, { version: S.project.version, source: live ? "live" : "cache", refresh: live && hasEvidence() }, "Reading the exact-bill Qloo rows…");
    S.proposal = null;
    S.drawThreads = true;
    S.step = 1;
    await reload();
    say(`Evidence ${r.status.toLowerCase()}. Red lines join pairs that share a crowd and play at the same time.`);
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
    renderInspector();
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
    say(`Published v${r.number}. It is now the draft; exports are in the side column.`);
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
$("#mode-toggle").onclick = () => (closeMenu(), setMode(document.body.dataset.mode === "walk" ? "desk" : "walk"));
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
  else if (e.key === "]") go(S.step + 1);
  else if (e.key === "[") go(S.step - 1);
  else if (e.key === "w") setMode(document.body.dataset.mode === "walk" ? "desk" : "walk");
  else if (e.key === "v") {
    const vs = $$("#views button");
    const i = vs.findIndex((b) => b.getAttribute("aria-selected") === "true");
    vs[(i + 1) % vs.length]?.click();
  } else if (e.key === "Escape") select(null);
});
// Stage names stay pinned while the timetable scrolls sideways.
$("#grid-wrap").addEventListener("scroll", (e) => $("#grid").style.setProperty("--sx", e.target.scrollLeft + "px"), { passive: true });
let resizeTimer;
addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => S.project && renderGrid(), 150);
});
guarded(load);
