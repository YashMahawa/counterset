// Loaded in the head so the motion class is set before first paint; everything else waits for the DOM.
document.documentElement.classList.add("js");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- The hero fragment ----------
// Placements are the real ones: the published Lollapalooza 2024 Saturday grid, option A after the
// rehearsal hold (Bacardi 17:15–18:15, Ethel Cain no earlier than 18:00), and the same repair solved
// with every Qloo pair removed.
const STAGES = ["Bud Light", "Bacardi", "IHG", "BMI"];
const ACTS = {
  "TV Girl": 60,
  Eyedress: 45,
  Romy: 45,
  "Ethel Cain": 60,
  "Tate McRae": 60,
  "Killer Mike": 45,
  "Hippo Campus": 60,
  "Tommy Newport": 40,
};
const at = (h, m = 0) => h * 60 + m;
const DRAFT = {
  "TV Girl": ["Bud Light", at(17)],
  "Tate McRae": ["Bud Light", at(19)],
  Eyedress: ["Bacardi", at(17, 15)],
  Romy: ["Bacardi", at(18, 30)],
  "Killer Mike": ["Bacardi", at(19, 45)],
  "Ethel Cain": ["IHG", at(17, 45)],
  "Hippo Campus": ["IHG", at(19, 45)],
  "Tommy Newport": ["BMI", at(17, 40)],
};
const STATES = {
  published: { places: DRAFT, hold: false, note: "The published grid. Both pairs are each other's #1 of 31 in Qloo." },
  repair: {
    places: { ...DRAFT, Eyedress: ["Bacardi", at(18, 15)], Romy: ["BMI", at(20)], "Ethel Cain": ["IHG", at(18)] },
    hold: true,
    note: "Bacardi holds 17:15–18:15 and Ethel Cain cannot start before 18:00. Option A moves three acts.",
  },
  blind: {
    places: { ...DRAFT, Eyedress: ["BMI", at(20)], "Ethel Cain": ["IHG", at(18)] },
    hold: true,
    note: "The same rules and move limit with every Qloo pair removed: fewer moves, one pair left clashing.",
  },
};
const PAIRS = [
  ["TV Girl", "Eyedress"],
  ["Romy", "Ethel Cain"],
];
// Narrow screens start at 17:00 so a 45-minute set still has room for its name.
const narrowView = () => innerWidth < 600;
let T0 = at(16, 30),
  T1 = at(21),
  LABEL = 76;
const tm = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const overlap = (places, a, b) => {
  const [sa, ta] = places[a],
    [sb, tb] = places[b];
  if (sa === sb) return 0;
  return Math.max(0, Math.min(ta + ACTS[a], tb + ACTS[b]) - Math.max(ta, tb));
};

function buildFragment() {
  const tt = document.getElementById("tt");
  if (!tt) return;
  const w = () => tt.clientWidth - LABEL;
  const x = (t) => LABEL + ((t - T0) / (T1 - T0)) * w();
  tt.innerHTML =
    `<div class="hours">${[17, 18, 19, 20, 21].map((h) => `<div class="hour" data-h="${h}"><span>${h}:00</span></div>`).join("")}</div>` +
    STAGES.map((s, i) => `<div class="lane" data-i="${i}"><b>${s}</b></div>`).join("") +
    `<div class="hold">Hold 17:15–18:15</div>` +
    Object.keys(ACTS)
      .map((a, i) => `<div class="set enter" data-act="${a}" data-i="${i}"><strong>${a}</strong><small></small></div>`)
      .join("");
  let state = "published";
  const place = () => {
    // On a phone the stage names sit above their lanes, so sets get the full width.
    const nv = narrowView();
    T0 = nv ? at(17) : at(16, 30);
    LABEL = nv ? 0 : 76;
    const PITCH = nv ? 62 : 50,
      DY = nv ? 18 : 4;
    tt.style.height = 22 + STAGES.length * PITCH + "px";
    tt.classList.toggle("stacked", nv);
    tt.querySelector(".hours").style.left = LABEL + "px";
    const width = w();
    tt.querySelectorAll(".hour").forEach((h) => (h.style.left = ((at(+h.dataset.h) - T0) / (T1 - T0)) * width + "px"));
    tt.querySelectorAll(".lane").forEach((l) => {
      l.style.top = 22 + +l.dataset.i * PITCH + "px";
      l.style.height = PITCH + "px";
    });
    const hold = tt.querySelector(".hold");
    hold.style.left = x(at(17, 15)) + "px";
    hold.style.top = 22 + PITCH + DY + "px";
    hold.style.width = (60 / (T1 - T0)) * width + "px";
    hold.style.opacity = STATES[state].hold ? 1 : 0;
    const places = STATES[state].places;
    const clash = new Set();
    PAIRS.forEach(([a, b]) => overlap(places, a, b) > 10 && (clash.add(a), clash.add(b)));
    tt.querySelectorAll(".set").forEach((el) => {
      const a = el.dataset.act;
      const [stage, start] = places[a];
      const moved = state !== "published" && (DRAFT[a][0] !== stage || DRAFT[a][1] !== start);
      const px = (ACTS[a] / (T1 - T0)) * width - 3;
      el.style.width = px + "px";
      el.style.transform = `translate(${x(start)}px, ${22 + STAGES.indexOf(stage) * PITCH + DY}px)`;
      el.className = `set ${el.classList.contains("enter") ? "enter" : ""} ${clash.has(a) ? "clash" : ""} ${moved ? "moved" : ""} ${px < 92 ? "narrow" : ""}`;
      el.querySelector("small").textContent = `${tm(start)}–${tm(start + ACTS[a])}`;
    });
    // The readout is computed from the placements on screen, never typed in.
    document.getElementById("readout").innerHTML = PAIRS.map(([a, b]) => {
      const o = overlap(places, a, b);
      return `<dt>${a} × ${b}</dt><dd>${o > 10 ? `<span class="pill bad">${o} min at once</span>` : `<span class="pill good">Apart</span>`}</dd>`;
    }).join("");
    document.getElementById("frag-note").textContent = STATES[state].note;
  };
  place();
  if (!reduced)
    tt.querySelectorAll(".set").forEach((el) => {
      el.style.animationDelay = 420 + +el.dataset.i * 60 + "ms";
      el.addEventListener("animationend", () => el.classList.remove("enter"), { once: true });
    });
  else tt.querySelectorAll(".set").forEach((el) => el.classList.remove("enter"));
  const tabs = [...document.querySelectorAll(".seg button")];
  const choose = (b) => {
    state = b.dataset.state;
    tabs.forEach((t) => t.setAttribute("aria-selected", String(t === b)));
    place();
  };
  tabs.forEach((b, i) => {
    b.addEventListener("click", () => choose(b));
    b.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (d) {
        const n = tabs[(i + d + tabs.length) % tabs.length];
        n.focus();
        choose(n);
      }
    });
  });
  addEventListener("resize", place);
}

// ---------- The lit shelf ----------
function buildShelf() {
  const shelf = document.getElementById("shelf");
  if (!shelf) return;
  const panels = [...shelf.querySelectorAll(".panel")];
  const caption = document.querySelector(".caption");
  let lit = -1;
  const light = (i) => {
    if (i === lit) return;
    lit = i;
    panels.forEach((p, j) => {
      p.classList.toggle("lit", j === i);
      const v = p.querySelector("video");
      if (v) j === i && !reduced ? v.play().catch(() => {}) : v.pause();
    });
    const p = panels[i];
    const [l1, l2] = p.dataset.lines.split("|");
    caption.classList.add("swap");
    setTimeout(() => {
      document.getElementById("cap-name").textContent = p.dataset.name;
      document.getElementById("cap-1").textContent = l1;
      document.getElementById("cap-2").textContent = l2;
      caption.classList.remove("swap");
    }, reduced ? 0 : 200);
  };
  const centred = () => {
    const mid = shelf.getBoundingClientRect().left + shelf.clientWidth / 2;
    let best = 0,
      d = Infinity;
    panels.forEach((p, i) => {
      const r = p.getBoundingClientRect();
      const dd = Math.abs(r.left + r.width / 2 - mid);
      if (dd < d) (d = dd), (best = i);
    });
    return best;
  };
  let raf;
  shelf.addEventListener("scroll", () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => light(centred()));
  });
  const go = (d) => panels[Math.max(0, Math.min(panels.length - 1, lit + d))].scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest", inline: "center" });
  document.getElementById("prev").onclick = () => go(-1);
  document.getElementById("next").onclick = () => go(1);
  panels.forEach((p, i) => p.addEventListener("click", () => i !== lit && go(i - lit)));
  // Drag with a mouse; touch scrolls natively.
  let down = null;
  shelf.addEventListener("pointerdown", (e) => e.pointerType === "mouse" && (down = { x: e.clientX, s: shelf.scrollLeft }));
  addEventListener("pointermove", (e) => down && (shelf.scrollLeft = down.s - (e.clientX - down.x)));
  addEventListener("pointerup", () => (down = null));
  light(0);
}

// ---------- The pinned card ----------
function buildHow() {
  const stmts = [...document.querySelectorAll(".stmt")];
  const states = [...document.querySelectorAll(".card .state")];
  const show = (name) => {
    stmts.forEach((s) => s.classList.toggle("active", s.dataset.state === name));
    states.forEach((s) => s.classList.toggle("on", s.dataset.state === name));
  };
  show("read");
  if (!("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && show(e.target.dataset.state)), { rootMargin: "-45% 0px -45% 0px" });
  stmts.forEach((s) => io.observe(s));
}

// ---------- Questions ----------
const FAQ = [
  ["Why Qloo, not genre tags or co-listening data?", "Qloo ranks every act you send it inside one response, small acts and comedians included. On the Lollapalooza bill that covered 496 pairs both ways; ListenBrainz linked 11, and three of its four pairs agree with Qloo."],
  ["Does it change who plays?", "No. The bill is fixed. Only start times and stages move, inside each act's availability, changeovers, stage hours, curfews and locks."],
  ["What does the model actually do?", "Gemma reads production messages into constraints, each quoted word for word, and you tick what applies. Models cannot call Qloo, solve, approve or publish."],
  ["What if an act is not in Qloo?", "It stays unresolved, and every pair with it is reported as unknown, never as zero. Ten of 42 Lollapalooza acts stayed that way rather than being guessed."],
  ["What happens when nothing fits?", "The solver says so and lists the rules that cannot all hold. It never shortens a set, relaxes a curfew or breaks a lock to make a schedule appear."],
  ["Is it proven to help a festival?", "Not yet. The software is tested and every pair is inspectable, but no festival has used it and attendance effects are unmeasured."],
];
function buildFaq() {
  const qs = document.querySelector(".qs");
  const pane = document.getElementById("answer");
  if (!qs) return;
  qs.insertAdjacentHTML(
    "beforeend",
    FAQ.map(([q, a], i) => `<button class="q" role="tab" id="q${i}" aria-selected="${i === 0}" aria-controls="answer">${q}</button><p class="inline-answer ${i === 0 ? "open" : ""}">${a}</p>`).join(""),
  );
  const buttons = [...qs.querySelectorAll(".q")];
  let cur = 0;
  const pick = (i) => {
    if (i === cur && pane.textContent) return;
    cur = i;
    buttons.forEach((b, j) => {
      b.setAttribute("aria-selected", String(j === i));
      b.nextElementSibling.classList.toggle("open", j === i);
    });
    pane.classList.add("fade");
    setTimeout(() => {
      pane.textContent = FAQ[i][1];
      pane.classList.remove("fade");
    }, reduced ? 0 : 150);
  };
  buttons.forEach((b, i) => {
    b.addEventListener("click", () => pick(i));
    b.addEventListener("focus", () => pick(i));
    b.addEventListener("mouseenter", () => matchMedia("(min-width: 861px)").matches && pick(i));
  });
  pane.textContent = FAQ[0][1];
}

// ---------- Entrances: parts of each section rise once as they arrive ----------
function buildReveals() {
  if (reduced || !("IntersectionObserver" in window)) return;
  const groups = [".caption > *", ".steps-col h2", ".pin", ".proof h2", ".names p", ".qs > :not(.inline-answer)", ".answer", ".close-text > *", ".close figure", ".foot"];
  const io = new IntersectionObserver(
    (es) =>
      es.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      }),
    { rootMargin: "0px 0px -10% 0px" },
  );
  groups.forEach((sel) =>
    document.querySelectorAll(sel).forEach((el, i) => {
      el.classList.add("reveal");
      el.style.transitionDelay = `${Math.min(i, 6) * 70}ms`;
      io.observe(el);
    }),
  );
}

document.addEventListener("DOMContentLoaded", () => {
  buildFragment();
  buildShelf();
  buildHow();
  buildFaq();
  buildReveals();
});
