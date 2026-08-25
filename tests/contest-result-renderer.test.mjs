import test from "node:test";
import assert from "node:assert/strict";

import { loadElectionPresentation } from "../election-presentation.js";
import { renderApplicableContests } from "../contest-result-renderer.js";

const { contests } = loadElectionPresentation();

function contestTemplates() {
  return new Map([
    ...contests.map((contest) => [
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
    ...["Mayor", "Councillor", "School Trustee"].map((office) => [
      office,
      {
        content: {
          cloneNode() {
            return { office, unresolved: true };
          },
        },
      },
    ]),
  ]);
}

function createRenderHarness() {
  const container = {
    children: [],
    replaceChildren(...children) {
      this.children = children;
    },
  };
  const render = (address) =>
    renderApplicableContests({
      address,
      container,
      contests,
      templates: contestTemplates(),
    });
  return {
    container,
    render,
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
  render(null);
  assert.deepEqual(container.children, []);
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
  assert.deepEqual(container.children.slice(1), [
    { office: "Councillor", unresolved: true },
    { office: "School Trustee", unresolved: true },
  ]);
});

test("rendering selects unresolved templates for incomplete assignments", () => {
  const { container, render } = createRenderHarness();

  render({});

  assert.equal(container.children[0].contestId, "mayor-winnipeg");
  assert.deepEqual(container.children.slice(1), [
    { office: "Councillor", unresolved: true },
    { office: "School Trustee", unresolved: true },
  ]);
});
