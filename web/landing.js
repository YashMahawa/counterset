// Departure board of real pairs from the Lollapalooza 2024 Saturday bill. Ranks are
// within-bill Qloo ranks (31 confirmed acts each); slots are from the published timetable.
const PAIRS = [
  { a: "Cannons", b: "Leisure", r: "#1 · #1", slots: "Tito's 18:00 · T-Mobile 15:00", status: "Apart", lb: true },
  { a: "Yoasobi", b: "Ive", r: "#1 · #1", slots: "Bacardi 21:00 · T-Mobile 17:00", status: "Apart" },
  { a: "Romy", b: "Ethel Cain", r: "#1 · #1", slots: "Bacardi 18:30 · IHG 17:45", status: "15 min clash", hot: true },
  {
    a: "TV Girl",
    b: "Eyedress",
    r: "#1 · #1",
    slots: "Bud Light 17:00 · Bacardi 17:15",
    status: "45 min clash",
    hot: true,
    lb: true,
    detail:
      "Each is the other's first choice among the 31 confirmed acts on the bill, and ListenBrainz co-listening links them too. The published grid overlaps them for 45 minutes. In the hypothetical lightning-hold rehearsal, the repair moves Eyedress to 18:15, after TV Girl ends.",
  },
  { a: "Infinity Song", b: "Friko", r: "#3 · #2", slots: "Bud Light 13:15 · Bacardi 12:50", status: "15 min clash", hot: true },
  { a: "Deftones", b: "The Killers", r: "#1 · #1", slots: "T-Mobile 18:45 · T-Mobile 20:45", status: "Apart" },
  { a: "Briston Maroney", b: "Hippo Campus", r: "#1 · #1", slots: "IHG 16:00 · IHG 19:45", status: "Apart", lb: true },
  { a: "2hollis", b: "Dylan Brady", r: "#1 · #1", slots: "Sonny's 14:15 · Sonny's 14:55", status: "Apart" },
];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const describe = (p) =>
  p.detail ||
  `Qloo ranks them ${p.r.replace(" · ", " and ")} in each other's rows on this bill.${p.lb ? " ListenBrainz co-listening also links them." : ""} ${p.hot ? "The published grid puts them on at the same time, so their shared crowd has to choose." : "The published grid already keeps them apart."}`;
const rows = document.getElementById("rows");
if (rows) {
  rows.innerHTML = PAIRS.map(
    (p, i) => `<button class="pair-row ${i === 3 ? "open" : ""}" role="listitem" aria-expanded="${i === 3}">
      <span>${esc(p.a)} × ${esc(p.b)}</span><span class="muted">${esc(p.r)}</span><span class="muted">${esc(p.slots)}</span><span class="status ${p.hot ? "hot" : ""}">${esc(p.status)}</span>
      <span class="detail">${esc(describe(p))}</span></button>`,
  ).join("");
  rows.addEventListener("click", (e) => {
    const row = e.target.closest(".pair-row");
    if (!row || row.classList.contains("open")) return;
    rows.querySelectorAll(".pair-row").forEach((r) => {
      r.classList.toggle("open", r === row);
      r.setAttribute("aria-expanded", String(r === row));
    });
  });
}
// Entrances: parts of each section rise in sequence, once. Content stays visible without script.
const parts = document.querySelectorAll(".pair-row, .field > *, .mark, .faq h2, details, .cta > *, .flank, .board-note");
if ("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  parts.forEach((el, i) => {
    el.classList.add("reveal");
    el.style.transitionDelay = `${(i % 4) * 75}ms`;
  });
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((en) => {
        if (en.isIntersecting) {
          en.target.classList.add("in");
          io.unobserve(en.target);
        }
      }),
    { rootMargin: "0px 0px -8% 0px" },
  );
  parts.forEach((el) => io.observe(el));
}
