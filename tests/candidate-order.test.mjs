import test from "node:test";
import assert from "node:assert/strict";
import { randomizeCandidateLists } from "../candidate-order.js";

function candidateList(names, explanationId) {
  return {
    children: names.map((name) => ({ name })),
    getAttribute(name) {
      return name === "aria-describedby" ? explanationId : null;
    },
    append(...orderedCandidates) {
      this.children = orderedCandidates;
    },
  };
}

test("Candidate lists randomize independently and explain their displayed order", () => {
  const mayorList = candidateList(["Alpha", "Bravo", "Charlie"], "mayor-order");
  const councilList = candidateList(["Delta", "Echo", "Foxtrot"], "council-order");
  const explanations = new Map([
    ["mayor-order", { textContent: "Candidates are shown alphabetically by family name." }],
    ["council-order", { textContent: "Candidates are shown alphabetically by family name." }],
  ]);
  const root = {
    querySelectorAll: () => [mayorList, councilList],
    getElementById: (id) => explanations.get(id),
  };
  const randomValues = [0, 0, 0.8, 0];

  randomizeCandidateLists(root, () => randomValues.shift());

  assert.deepEqual(mayorList.children.map(({ name }) => name), ["Bravo", "Charlie", "Alpha"]);
  assert.deepEqual(councilList.children.map(({ name }) => name), ["Echo", "Delta", "Foxtrot"]);
  for (const explanation of explanations.values()) {
    assert.equal(explanation.textContent, "Candidates are shown in a randomized order.");
  }
});
