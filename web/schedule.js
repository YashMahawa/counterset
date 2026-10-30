// A shared timetable. Everything comes from the link, so it is treated as untrusted text.
const $ = (s) => document.querySelector(s);
const tm = (n) => `${String(Math.floor(n / 60) % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const LABEL = 96;
const AXIS = 24;
const ROW = 66;

function read() {
  const b64 = location.hash.slice(1).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const d = JSON.parse(new TextDecoder().decode(bytes));
  if (d.f !== 1 || !Array.isArray(d.s) || !Array.isArray(d.a)) throw Error("Unknown link");
  const sets = d.a
    .map(([name, stage, start, length, flag]) => ({ name: String(name), stage: +stage, start: +start, length: +length, flag: +flag }))
    .filter((x) => Number.isFinite(x.start) && x.length > 0 && d.s[x.stage] !== undefined);
  return { ...d, stages: d.s.map(String), sets, out: (d.o || []).map(String) };
}
function add(parent, cls, text, css) {
  const el = document.createElement("div");
  el.className = cls;
  el.textContent = text;
  Object.assign(el.style, css);
  parent.appendChild(el);
  return el;
}
function draw(d) {
  const board = $("#board");
  board.innerHTML = "";
  const from = Math.floor(Math.min(...d.sets.map((x) => x.start)) / 60) * 60;
  const to = Math.ceil(Math.max(...d.sets.map((x) => x.start + x.length)) / 60) * 60;
  const room = board.parentElement.clientWidth - LABEL - 16;
  const ppm = Math.max(innerWidth < 860 ? 2 : 1.2, room / (to - from));
  board.style.width = LABEL + (to - from) * ppm + 16 + "px";
  board.style.height = AXIS + d.stages.length * ROW + "px";
  for (let t = from; t <= to; t += 60) add(board, "tick", tm(t), { left: LABEL + (t - from) * ppm + "px", top: "0px" });
  d.stages.forEach((s, i) => {
    add(board, "lane", s, { left: "0px", top: AXIS + i * ROW + 14 + "px", width: LABEL - 8 + "px" });
    add(board, "rule", "", { left: "0px", right: "0px", top: AXIS + i * ROW + ROW - 2 + "px" });
  });
  for (const x of d.sets) {
    const el = add(board, `tile ${x.flag & 1 ? "changed" : ""} ${x.flag & 2 ? "short" : ""}`, x.name, {
      left: LABEL + (x.start - from) * ppm + "px",
      top: AXIS + x.stage * ROW + "px",
      width: x.length * ppm - 2 + "px",
      height: ROW - 6 + "px",
    });
    const when = document.createElement("small");
    when.textContent = `${tm(x.start)}–${tm(x.start + x.length)}`;
    el.appendChild(when);
  }
}
function start() {
  $("#print").onclick = () => print();
  let d;
  try {
    d = read();
    if (!d.sets.length) throw Error("Empty");
  } catch {
    $("#name").textContent = "This link is incomplete";
    $("#meta").textContent = "Ask whoever sent it to copy the link again.";
    document.querySelectorAll(".sheet, .actions").forEach((n) => (n.hidden = true));
    document.querySelectorAll(".sheet").forEach((n) => (n.style.display = "none"));
    return;
  }
  document.title = `${d.n} — Counterset`;
  $("#name").textContent = String(d.n);
  const changed = d.sets.filter((x) => x.flag).length;
  const when = Number.isFinite(+d.t) ? new Date(+d.t * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
  $("#meta").textContent = `Version ${+d.r || 1}${when ? `, approved ${when}` : ""}. ${d.sets.length} sets play${changed ? `, ${changed} changed` : ""}.`;
  $("#key").hidden = !changed;
  $("#board").setAttribute("aria-label", `${d.n}: ${d.sets.length} sets on ${d.stages.length} stages. The same sets are listed below.`);
  const rows = $("#rows");
  for (const x of [...d.sets].sort((a, b) => a.start - b.start)) {
    const tr = rows.insertRow();
    const change = [x.flag & 1 ? "Moved" : "", x.flag & 2 ? "Shorter" : ""].filter(Boolean).join(", ");
    for (const v of [`${tm(x.start)}–${tm(x.start + x.length)}`, x.name, d.stages[x.stage], change]) tr.insertCell().textContent = v;
  }
  if (d.out.length) {
    $("#out-box").hidden = false;
    $("#out").textContent = d.out.join(", ");
  }
  draw(d);
  let timer;
  addEventListener("resize", () => {
    clearTimeout(timer);
    timer = setTimeout(() => draw(d), 150);
  });
}
start();
