// The opening plays on every load. Moving between pages covers the screen with the same mark,
// and the next page settles it and lifts it away, so the switch reads as one movement. The page never waits on it.
(() => {
  const root = document.documentElement;
  try {
    if (sessionStorage.getItem("counterset-moving")) root.classList.add("loader-arrive");
    sessionStorage.removeItem("counterset-moving");
  } catch {}

  const COVER = 480;
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  // A running animation only restarts on a new element.
  const replay = (add) => {
    const old = document.querySelector(".loader");
    if (!old) return;
    const fresh = old.cloneNode(true);
    fresh.classList.remove("leaving");
    if (add) fresh.classList.add(add);
    old.replaceWith(fresh);
  };

  document.addEventListener("click", (e) => {
    const a = e.target.closest?.("a[href]");
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.target || a.hasAttribute("download") || a.dataset.action || still()) return;
    const to = new URL(a.href, location.href);
    if (to.origin !== location.origin || !/^\/(studio|schedule)?$/.test(to.pathname)) return;
    // A jump within the page is a scroll, not a switch.
    if (to.pathname === location.pathname && to.search === location.search) return;
    e.preventDefault();
    try {
      sessionStorage.setItem("counterset-moving", "1");
    } catch {}
    root.classList.remove("loader-arrive");
    replay("leaving");
    setTimeout(() => location.assign(to.href), COVER);
  });

  // Coming back through the browser's history restores the page as it was left, cover included.
  addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    try {
      sessionStorage.removeItem("counterset-moving");
    } catch {}
    root.classList.add("loader-arrive");
    replay();
  });
})();
