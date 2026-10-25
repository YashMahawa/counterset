const observer = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add("reveal");
        observer.unobserve(e.target);
      }
    }
  },
  { threshold: 0.12 },
);
document.querySelectorAll(".motion").forEach((e, i) => {
  e.style.setProperty("--i", i % 3);
  observer.observe(e);
});
