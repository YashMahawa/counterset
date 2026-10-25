const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let project,
  config,
  proposal,
  proposed = false,
  mode = "act",
  editing,
  comparison;
const tm = (n) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const minutes = (s) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};
function message(text, error = false) {
  $("#notice").textContent = text;
  $("#notice").className = error ? "notice error" : "notice";
}
async function api(path, method = "GET", body) {
  const headers = {
    "Content-Type": "application/json",
    "X-Counterset": "workspace",
  };
  const token = sessionStorage.getItem("counterset-token");
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch("/api" + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    let e;
    try {
      e = await r.json();
    } catch {
      throw Error(`${r.status}: ${r.statusText}`);
    }
    throw Error(
      typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail || e),
    );
  }
  return r.json();
}
async function load() {
  config = await api("/config");
  let id =
    new URLSearchParams(location.search).get("project") ||
    localStorage.getItem("counterset-project");
  if (id) {
    try {
      project = await api(`/projects/${id}`);
    } catch (e) {
      if (!e.message.includes("not found")) throw e;
    }
  }
  if (!project) {
    project = await api("/projects", "POST");
    localStorage.setItem("counterset-project", project.id);
    project = await api(`/projects/${project.id}`);
  }
  localStorage.setItem("counterset-project", project.id);
  if (new URLSearchParams(location.search).has("project")) {
    history.replaceState(null, "", "/studio");
  }
  render();
}
async function reload() {
  project = await api(`/projects/${project.id}`);
  config = await api("/config");
  render();
}
async function save(day) {
  await api(`/projects/${project.id}`, "PUT", {
    version: project.version,
    day,
  });
  proposal = null;
  proposed = false;
  await reload();
}
async function job(path, body, label) {
  message(label);
  $("#busy").hidden = false;
  $("#busy-label").textContent = label;
  $("#progress").value = 0;
  document.body.classList.add("working");
  try {
    const r = await api(path, "POST", body);
    for (let n = 0; n < 700; n++) {
      await new Promise((r) => setTimeout(r, 700));
      const j = await api(`/jobs/${r.job_id}`);
      $("#progress").value = j.progress || 0;
      $("#busy-label").textContent = j.detail || label;
      if (j.status === "FAILED") throw Error(j.error);
      if (j.status === "COMPLETED") return j.result;
    }
    throw Error("Still running. Reload to inspect saved results.");
  } finally {
    $("#busy").hidden = true;
    document.body.classList.remove("working");
  }
}
const act = (id) => project.day.acts.find((a) => a.id === id),
  stage = (id) => project.day.stages.find((s) => s.id === id);
function render() {
  proposed = !!(proposed && proposal?.placements?.length);
  $("#day-name").textContent = project.day.name;
  $("#day-meta").textContent =
    `${project.day.acts.length} contracted acts · ${project.day.stages.length} stages · version ${project.version} · ${project.status.toLowerCase()}`;
  $("#repair-priority").value = project.day.repair_priority || "fewest_acts";
  $("#real-day").disabled = !config.real_day_available;
  $("#fixture-note").textContent =
    project.context?.note || "Production facts supplied by the programmer.";
  $("#context").innerHTML =
    project.context?.kind === "retrospective"
      ? `<p>${esc(project.context.note)} <a href="${esc(project.context.source)}" target="_blank" rel="noreferrer">Published source</a></p><details><summary>Hypothetical constraints</summary><ul>${project.context.assumptions.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></details>`
      : "";
  $("#move-budget").max = project.day.acts.length;
  const e = project.evidence;
  $("#coverage").textContent = e.id
    ? `${e.complete_rows}/${e.total_rows} complete rows. ${e.edges.length} reciprocal cues. ${e.unknown.length} unknown pairs. ${e.source}.`
    : "No graph loaded. Import recorded evidence or query the confirmed lineup.";
  $("#quota").textContent =
    `${config.budget.qloo_successes} / ${config.budget.qloo_limit} cumulative Qloo successes. ${config.budget.model_attempts} model attempts here.`;
  $("#recorded").disabled = !config.recorded_available;
  $("#live").disabled = !config.qloo_configured;
  $("#parse-note").disabled = !config.model_configured;
  $("#benchmark").disabled = !config.model_configured;
  $("#export").disabled = !project.published.length;
  if (proposal && proposal.input_version !== project.version) {
    proposal = null;
    proposed = false;
  }
  $("#show-proposal").disabled = !proposal?.placements?.length;
  $("#show-draft").classList.toggle("selected", !proposed);
  $("#show-proposal").classList.toggle("selected", proposed);
  const a = proposed && proposal?.audit ? proposal.audit : project.audit;
  $("#metrics").innerHTML = [
    ["Attendee conflicts", a.counts.must_see],
    ["Qloo cue overlaps", a.counts.qloo],
    ["Unknown overlaps", a.counts.unknown],
    ["Acts changed", a.moves],
  ]
    .map(
      ([label, n]) => `<div><strong>${n}</strong><span>${label}</span></div>`,
    )
    .join("");
  const places = proposed ? proposal.placements : project.day.draft;
  $("#timeline").innerHTML = project.day.stages
    .map(
      (s) =>
        `<section class="stage-column"><h2>${esc(s.name)}</h2><p class="small">${tm(s.opens)}–${tm(s.closes)}</p><div class="stage-lane">${places
          .filter((p) => p.stage_id === s.id)
          .sort((a, b) => a.start - b.start)
          .map((p) => {
            const x = act(p.act_id),
              hit = a.conflicts.some((e) => e.a === x.id || e.b === x.id),
              changed = proposal?.audit?.moved.includes(x.id) && proposed;
            return `<button class="set ${hit ? "has-clash" : ""} ${changed ? "moved" : ""}" data-act="${esc(x.id)}" data-start="${p.start}" data-duration="${x.duration}" title="${hit ? "Overlap to review" : changed ? "Changed placement" : "Production window retained"}"><span class="set-time">${tm(p.start)}–${tm(p.start + x.duration)}${x.locked ? " · locked" : ""}</span><strong>${esc(x.name)}</strong></button>`;
          })
          .join("")}${project.day.outages
          .filter((o) => o.stage_id === s.id)
          .map(
            (o) =>
              `<p class="hold" data-start="${o.start}" data-duration="${o.end - o.start}">Hold ${tm(o.start)}–${tm(o.end)}</p>`,
          )
          .join("")}</div></section>`,
    )
    .join("");
  const origin = Math.min(...project.day.stages.map((s) => s.opens)),
    end = Math.max(...project.day.stages.map((s) => s.closes)),
    scale = Math.max(
      2,
      80 / Math.min(...project.day.acts.map((a) => a.duration)),
    );
  document
    .querySelectorAll(".stage-lane")
    .forEach((l) => (l.style.height = (end - origin) * scale + "px"));
  document.querySelectorAll(".stage-lane [data-start]").forEach((el) => {
    el.style.top = (+el.dataset.start - origin) * scale + "px";
    el.style.height = +el.dataset.duration * scale + "px";
  });
  $("#changes").innerHTML = proposal?.audit
    ? `<h2>Proposed changes</h2>${
        proposal.audit.moved
          .map((id) => {
            const x = act(id),
              old = project.day.draft.find((p) => p.act_id === id),
              next = proposal.placements.find((p) => p.act_id === id);
            return `<div class="change-row"><strong>${esc(x.name)}</strong><span>${esc(stage(old.stage_id).name)} ${tm(old.start)} → ${esc(stage(next.stage_id).name)} ${tm(next.start)}</span><button class="quiet" data-pin="${esc(id)}">Keep original</button></div>`;
          })
          .join("") || "<p>No changes needed at this objective.</p>"
      }`
    : "";
  $("#proposal-summary").innerHTML = proposal
    ? `<p><strong>${esc(proposal.status)}</strong></p>${proposal.audit ? `<p>${proposal.audit.moves} acts move. ${proposal.audit.counts.qloo} cue overlaps remain.</p><p class="small">${esc(proposal.minimum_change_scope)}</p>` : `<p>${esc(proposal.core_scope || "No feasible proposal returned.")}</p><ul>${(proposal.core || []).map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`}`
    : "";
  $("#publish").hidden = !proposal?.audit?.passed;
  if (proposal?.trace)
    $("#trace").innerHTML = proposal.trace
      .map(
        (x) => `<li>${esc(x.node.replaceAll("_", " "))}: ${esc(x.status)}</li>`,
      )
      .join("");
  $("#evidence-content").innerHTML = e.id
    ? `<p><strong>${esc(e.status)}</strong> · snapshot ${esc(e.id.slice(0, 10))}</p><div class="table-wrap"><table><thead><tr><th>Artist pair</th><th>Reciprocal ranks</th><th>Evidence</th></tr></thead><tbody>${e.edges.map((x) => `<tr><td>${esc(act(x.a).name)} / ${esc(act(x.b).name)}</td><td>${esc(x.ranks.join(" / "))}</td><td>Qloo association cue</td></tr>`).join("")}</tbody></table></div><p>Order control: ${e.order_control?.passed ? "passed" : "not available"}. ${esc(e.order_control?.scope || "No stability claim.")}</p><h2>Coverage by act</h2>${Object.entries(
        e.coverage,
      )
        .map(
          ([id, c]) =>
            `<p>${esc(act(id).name)}: ${c.complete ? "complete" : esc(c.errors.join(", "))}</p>`,
        )
        .join("")}`
    : "<p>Load evidence to inspect the graph.</p>";
  for (const id of ["#survey-a", "#survey-b", "#resolve-act"])
    $(id).innerHTML = project.day.acts
      .map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`)
      .join("");
  $("#survey-b").selectedIndex = 1;
  $("#resolve-query").value = project.day.acts[0].name;
  $("#survey-list").innerHTML = project.day.must_see
    .map(
      (p) =>
        `<p>${esc(act(p.a).name)} / ${esc(act(p.b).name)} · ${p.weight} reported selections</p>`,
    )
    .join("");
  $("#notes").innerHTML = project.notes
    .map(
      (n) =>
        `<article class="note"><blockquote>${esc(n.quote)}</blockquote><p>${esc(n.action)} ${n.act_id ? esc(act(n.act_id)?.name) : ""} ${Number.isInteger(n.value) ? tm(n.value) : ""}</p><p class="small">${esc(n.reason)} · ${esc(n.status)}</p>${n.status === "PENDING_REVIEW" && n.action !== "unsupported" ? `<button class="quiet" data-approve="${esc(n.id)}" ${n.input_version !== project.version ? "disabled" : ""}>Approve constraint</button>` : ""}</article>`,
    )
    .join("");
}
async function guarded(fn) {
  try {
    await fn();
  } catch (e) {
    message(e.message, true);
  }
}
document.addEventListener("click", (event) =>
  guarded(async () => {
    const t = event.target.closest("button");
    if (!t) return;
    if (t.dataset.view) {
      document
        .querySelectorAll(".view")
        .forEach((v) => (v.hidden = v.id !== `${t.dataset.view}-view`));
      document
        .querySelectorAll(".tab")
        .forEach((b) => b.classList.toggle("active", b === t));
    }
    if (t.dataset.act) {
      mode = "act";
      editing = t.dataset.act;
      const a = act(editing),
        p = project.day.draft.find((p) => p.act_id === editing);
      $("#editor-title").textContent = a.name;
      $("#editor-fields").innerHTML =
        `<label>Stage<select id="f-stage">${project.day.stages.map((s) => `<option value="${esc(s.id)}" ${s.id === p.stage_id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label><label>Start<input id="f-start" type="time" value="${tm(p.start)}" required></label><label>Earliest start<input id="f-earliest" type="time" value="${tm(a.earliest)}" required></label><label>Latest end<input id="f-latest" type="time" value="${tm(a.latest)}" required></label><label class="checkbox"><input id="f-lock" type="checkbox" ${a.locked ? "checked" : ""}>Lock to this placement</label><label>Confirmed Qloo artist ID<input id="f-qloo" value="${esc(a.qloo_id || "")}" placeholder="Confirm a search result in Evidence"></label>`;
      $("#editor").showModal();
    }
    if (t.dataset.pin) {
      await api(`/projects/${project.id}/pin`, "POST", {
        version: project.version,
        act_id: t.dataset.pin,
      });
      proposal = null;
      await reload();
      message("Original placement pinned. Run a new repair.");
    }
    if (t.dataset.approve) {
      await api(`/projects/${project.id}/notes/approve`, "POST", {
        version: project.version,
        note_id: t.dataset.approve,
      });
      proposal = null;
      await reload();
      message("Constraint approved. Existing proposals are stale.");
    }
    if (t.dataset.confirmArtist) {
      const d = structuredClone(project.day);
      d.acts.find((a) => a.id === t.dataset.targetAct).qloo_id =
        t.dataset.confirmArtist;
      await save(d);
      $("#resolve-results").textContent =
        "Artist identity confirmed. Query the current lineup when all identities are ready.";
      message("Identity confirmed. Previous evidence was invalidated.");
    }
    if (t.id === "repair") {
      message("Preparing a repair…");
      const preference = $("#repair-priority").value;
      if (preference !== project.day.repair_priority) {
        const d = structuredClone(project.day);
        d.repair_priority = preference;
        await save(d);
      }
      const r = await job(
        `/projects/${project.id}/repair`,
        {
          version: project.version,
          move_budget: +$("#move-budget").value,
          seconds: 15,
        },
        "Solving and validating…",
      );
      proposal = r;
      proposed = !!r.audit;
      await reload();
      message(
        r.status === "INFEASIBLE"
          ? "These constraints cannot all hold. Review the conflicting set."
          : "Repair ready for your review.",
      );
    }
    if (t.id === "recorded" || t.id === "live") {
      await job(
        `/projects/${project.id}/evidence`,
        {
          version: project.version,
          source: t.id === "live" ? "live" : "recorded",
        },
        "Loading the exact-lineup evidence…",
      );
      proposal = null;
      await reload();
      message("Evidence loaded. Inspect the graph or find a repair.");
    }
    if (t.id === "show-draft") {
      proposed = false;
      render();
    }
    if (t.id === "show-proposal") {
      proposed = true;
      render();
    }
    if (t.id === "publish") {
      const r = await api(`/projects/${project.id}/publish`, "POST", {
        version: project.version,
        proposal_id: proposal.proposal_id,
      });
      proposal = null;
      proposed = false;
      await reload();
      message(`Published immutable schedule v${r.number}.`);
    }
    if (t.id === "real-day") {
      project = await api("/examples/pitchfork-2024-friday", "POST");
      localStorage.setItem("counterset-project", project.id);
      proposal = null;
      proposed = false;
      await reload();
      message(
        "Historical day loaded. Review the explicit hypothetical production rules before solving.",
      );
    }
    if (t.id === "new-day") {
      project = await api("/projects", "POST");
      localStorage.setItem("counterset-project", project.id);
      proposal = null;
      await reload();
    }
    if (t.id === "export") {
      const id = project.published.at(-1);
      const r = await fetch(`/api/published/${id}/export`, {
        headers: sessionStorage.getItem("counterset-token")
          ? {
              Authorization: `Bearer ${sessionStorage.getItem("counterset-token")}`,
            }
          : {},
      });
      if (!r.ok) throw Error("Export failed");
      const u = URL.createObjectURL(await r.blob()),
        a = document.createElement("a");
      a.href = u;
      a.download = "counterset-approved.json";
      a.click();
      URL.revokeObjectURL(u);
    }
    if (t.id === "parse-note") {
      await job(
        `/projects/${project.id}/notes`,
        {
          version: project.version,
          text: $("#note").value,
          model: $("#model").value,
        },
        "Interpreting the note; nothing is applied yet…",
      );
      await reload();
      message("Review the extracted constraint and source quote.");
    }
    if (t.id === "benchmark") {
      comparison = await job(
        `/projects/${project.id}/benchmark`,
        {
          version: project.version,
          move_budget: +$("#move-budget").value,
          seconds: 10,
          model: $("#comparison-model").value,
        },
        "Running the same-facts comparison…",
      );
      $("#comparison").innerHTML =
        `<div class="table-wrap"><table><thead><tr><th>Approach</th><th>Hard rules</th><th>Attendee conflicts</th><th>Qloo cues</th><th>Moves</th></tr></thead><tbody>${[
          ["Current grid", comparison.no_change],
          ["Genre + solver", comparison.genre_solver.common_audit],
          ["Qloo + solver", comparison.qloo_solver.audit],
          ["LLM only", comparison.llm_only.audit],
        ]
          .map(
            ([n, a]) =>
              `<tr><td>${n}</td><td>${a?.passed ? "Pass" : "Fail / no schedule"}</td><td>${a?.counts.must_see ?? "—"}</td><td>${a?.counts.qloo ?? "—"}</td><td>${a?.moves ?? "—"}</td></tr>`,
          )
          .join(
            "",
          )}</tbody></table></div>${comparison.llm_only.audit.errors.map((x) => `<p>${esc(x)}</p>`).join("")}<p>${esc(comparison.scope)}</p>`;
      await reload();
      message(
        "Comparison complete. Inspect constraints separately from cultural proxy scores.",
      );
    }
    if (t.id === "edit-json") {
      mode = "json";
      $("#editor-title").textContent = "Production facts";
      $("#editor-fields").innerHTML =
        `<textarea id="f-json" rows="18" aria-label="Festival day JSON">${esc(JSON.stringify(project.day, null, 2))}</textarea>`;
      $("#editor").showModal();
    }
    if (t.id === "hold") {
      mode = "hold";
      $("#editor-title").textContent = "Stage hold";
      $("#editor-fields").innerHTML =
        `<label>Stage<select id="f-stage">${project.day.stages.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}</select></label><label>From<input id="f-start" type="time" value="17:00" required></label><label>Until<input id="f-end" type="time" value="17:45" required></label><p>Started sets are pinned. Curfews and durations stay fixed; the solver may report infeasibility.</p>`;
      $("#editor").showModal();
    }
    if (t.id === "close-editor") $("#editor").close();
    if (t.id === "auth") {
      const token = prompt(
        "Workspace access token (only needed for a protected deployment)",
      );
      if (token !== null) {
        sessionStorage.setItem("counterset-token", token);
        await load();
      }
    }
  }),
);
$("#editor-form").addEventListener("submit", (e) => {
  e.preventDefault();
  guarded(async () => {
    if (mode === "hold") {
      await api(`/projects/${project.id}/hold`, "POST", {
        version: project.version,
        stage_id: $("#f-stage").value,
        start: minutes($("#f-start").value),
        end: minutes($("#f-end").value),
      });
      proposal = null;
      await reload();
    } else {
      let d = structuredClone(project.day);
      if (mode === "json") d = JSON.parse($("#f-json").value);
      else {
        const a = d.acts.find((a) => a.id === editing),
          p = d.draft.find((p) => p.act_id === editing);
        a.earliest = minutes($("#f-earliest").value);
        a.latest = minutes($("#f-latest").value);
        a.locked = $("#f-lock").checked;
        a.qloo_id = $("#f-qloo").value.trim() || null;
        p.start = minutes($("#f-start").value);
        p.stage_id = $("#f-stage").value;
      }
      await save(d);
    }
    $("#editor").close();
    message("Facts updated. Re-run the repair.");
  });
});
$("#survey-form").addEventListener("submit", (e) => {
  e.preventDefault();
  guarded(async () => {
    const d = structuredClone(project.day);
    d.must_see.push({
      a: $("#survey-a").value,
      b: $("#survey-b").value,
      weight: +$("#survey-weight").value,
    });
    await save(d);
    message("Attendee pair added with higher priority than Qloo cues.");
  });
});
$("#resolve-form").addEventListener("submit", (e) => {
  e.preventDefault();
  guarded(async () => {
    const target = $("#resolve-act").value;
    const r = await api("/resolve", "POST", {
      query: $("#resolve-query").value,
    });
    $("#resolve-results").innerHTML =
      r.candidates
        .map(
          (c) =>
            `<p><strong>${esc(c.name)}</strong> ${esc(c.disambiguation)} <button class="quiet" data-confirm-artist="${esc(c.id)}" data-target-act="${esc(target)}">Confirm this artist</button></p>`,
        )
        .join("") || "No candidates. Keep the act unresolved.";
  });
});
$("#resolve-act").addEventListener(
  "change",
  () => ($("#resolve-query").value = act($("#resolve-act").value).name),
);
$("#move-budget").addEventListener(
  "input",
  () => ($("#budget-value").value = $("#move-budget").value),
);
$("#import").addEventListener("change", (e) =>
  guarded(async () => {
    const d = JSON.parse(await e.target.files[0].text());
    project = await api("/projects", "POST", d);
    localStorage.setItem("counterset-project", project.id);
    proposal = null;
    await reload();
    message("Imported festival day. Confirm identities and load evidence.");
  }),
);
guarded(load);
