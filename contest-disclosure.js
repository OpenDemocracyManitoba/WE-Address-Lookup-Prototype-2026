export function bindContestDisclosureScrolling(
  container,
  {
    requestAnimationFrameFn = (callback) => window.requestAnimationFrame(callback),
    viewportTopFn = () => window.visualViewport?.offsetTop ?? 0,
  } = {},
) {
  container.addEventListener(
    "toggle",
    (event) => {
      const contest = event.target;
      if (!contest.open || !contest.matches?.(".applicable-contest")) return;

      requestAnimationFrameFn(() => {
        if (!contest.open) return;
        if (contest.getBoundingClientRect().top < viewportTopFn()) {
          contest.scrollIntoView({ block: "start" });
        }
      });
    },
    true,
  );
}
