export function randomizeCandidateLists(root, random = Math.random) {
  for (const list of root.querySelectorAll("[data-candidate-list]")) {
    const candidates = Array.from(list.children);
    for (let index = candidates.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [candidates[index], candidates[swapIndex]] = [candidates[swapIndex], candidates[index]];
    }
    list.append(...candidates);

    const explanationId = list.getAttribute("aria-describedby");
    const explanation = explanationId ? root.getElementById(explanationId) : null;
    if (explanation) {
      explanation.querySelector("[data-order-message]").textContent = "Candidates are shown in a randomized order.";
    }
  }
}

if (typeof document !== "undefined") {
  randomizeCandidateLists(document);
}
