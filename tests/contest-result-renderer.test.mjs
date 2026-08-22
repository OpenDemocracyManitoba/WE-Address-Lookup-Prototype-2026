import test from "node:test";
import assert from "node:assert/strict";

import { loadElectionPresentation } from "../election-presentation.js";
import { renderApplicableContests } from "../contest-result-renderer.js";

const { contests } = loadElectionPresentation();

function contestTemplates() {
  return new Map(
    contests.map((contest) => [
      contest.id,
      {
        content: {
          cloneNode() {
            return {
              contestId: contest.id,
              href: `/contests/${contest.id}/`,
              candidateListAvailability: contest.candidateList.availability,
              candidates: contest.candidates.map(
                ({ sourcePublishedName }) => sourcePublishedName,
              ),
            };
          },
        },
      },
    ]),
  );
}

function createRenderHarness() {
  const container = {
    children: [],
    replaceChildren(...children) {
      this.children = children;
    },
  };
  let randomizations = 0;
  const render = (address) =>
    renderApplicableContests({
      address,
      container,
      contests,
      templates: contestTemplates(),
      unresolvedContestNode: ({ office, message }) => ({ office, message }),
      randomize: () => {
        randomizations += 1;
      },
    });
  return {
    container,
    render,
    get randomizations() {
      return randomizations;
    },
  };
}

test("rendering selects three ordered Contest templates and replaces the prior result", () => {
  const harness = createRenderHarness();
  const { container, render } = harness;

  render({
    councilWard: "Fort Rouge - East Fort Garry",
    schoolDivision: "Winnipeg",
    schoolDivisionWard: "5",
  });
  assert.deepEqual(
    container.children.map(({ contestId, href, candidates }) => ({
      contestId,
      href,
      candidates,
    })),
    [
      {
        contestId: "mayor-winnipeg",
        href: "/contests/mayor-winnipeg/",
        candidates: [
          "Mazher Alam",
          "Johnny Calderón",
          "Christopher Clacio",
          "Scott Gillingham",
          "Brad Gross",
          "Umar Hayat",
          "Joshua Pagdato",
          "Noah Redden",
          "Zachary Uminski",
          "Michael Vogiatzakis",
          "Don Woodstock",
        ],
      },
      {
        contestId: "council-fort-rouge-east-fort-garry",
        href: "/contests/council-fort-rouge-east-fort-garry/",
        candidates: ["Jeff Palmer", "Kevin Stuart"],
      },
      {
        contestId: "school-winnipeg-ward-5",
        href: "/contests/school-winnipeg-ward-5/",
        candidates: ["Tim Bigelow"],
      },
    ],
  );

  render({
    councilWard: "St. James",
    schoolDivision: "St James-Assiniboia",
    schoolDivisionWard: "Centre Ward",
  });
  assert.deepEqual(
    container.children.map(({ contestId }) => contestId),
    [
      "mayor-winnipeg",
      "council-st-james",
      "school-st-james-assiniboia-centre",
    ],
  );
  assert.equal(
    container.children.some(
      ({ contestId }) => contestId === "council-fort-rouge-east-fort-garry",
    ),
    false,
  );
  assert.equal(harness.randomizations, 2);

  render(null);
  assert.deepEqual(container.children, []);
  assert.equal(harness.randomizations, 2);
});

test("rendering preserves resolved Contests around unsupported or unfamiliar assignments", () => {
  const { container, render } = createRenderHarness();

  render({
    councilWard: "St. Norbert - Seine River",
    schoolDivision: "Seine River",
    schoolDivisionWard: "1",
  });
  assert.deepEqual(
    container.children.map(
      ({ contestId, candidateListAvailability }) => [
        contestId,
        candidateListAvailability,
      ],
    ),
    [
      ["mayor-winnipeg", "Published"],
      ["council-st-norbert-seine-river", "Published"],
      ["school-seine-river-ward-1", "Unavailable"],
    ],
  );

  render({
    councilWard: "A Different Ward",
    schoolDivision: "Winnipeg",
    schoolDivisionWard: "99",
  });
  assert.equal(container.children[0].contestId, "mayor-winnipeg");
  assert.deepEqual(
    container.children.slice(1).map(({ office }) => office),
    ["Councillor", "School Trustee"],
  );
  for (const unresolved of container.children.slice(1)) {
    assert.match(unresolved.message, /could not be matched/);
    assert.match(unresolved.message, /No different Contest was selected/);
    assert.equal("contestId" in unresolved, false);
  }
});
