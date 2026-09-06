import test from "node:test";
import assert from "node:assert/strict";

import { renderApplicableContests } from "../contest-result-renderer.js";

const contests = [
  {
    id: "mayor-fixture-city",
    office: "Mayor",
    electoralArea: { kind: "citywide", canonicalName: "Fixture City" },
    aliases: ["Fixture City"],
    candidateList: { support: "supported", availability: "Published" },
    candidates: [
      { sourcePublishedName: "Morgan Mayor" },
      { sourcePublishedName: "Alex Alder" },
    ],
  },
  {
    id: "council-fixture-north",
    office: "Councillor",
    electoralArea: { kind: "councilWard", canonicalName: "Fixture North" },
    aliases: ["Fixture North"],
    candidateList: { support: "supported", availability: "Published" },
    candidates: [{ sourcePublishedName: "Casey Councillor" }],
  },
  {
    id: "council-fixture-south",
    office: "Councillor",
    electoralArea: { kind: "councilWard", canonicalName: "Fixture South" },
    aliases: ["Fixture South"],
    candidateList: { support: "supported", availability: "Published" },
    candidates: [],
  },
  {
    id: "school-fixture-ward-1",
    office: "School Trustee",
    electoralArea: {
      kind: "schoolDivisionWard",
      canonicalName: "Fixture School Division — Ward 1",
    },
    aliases: ["Fixture School / 1"],
    candidateList: { support: "supported", availability: "Published" },
    candidates: [{ sourcePublishedName: "Taylor Trustee" }],
  },
  {
    id: "school-unavailable-ward-1",
    office: "School Trustee",
    electoralArea: {
      kind: "schoolDivisionWard",
      canonicalName: "Unavailable School Division — Ward 1",
    },
    aliases: ["Unavailable School / 1"],
    candidateList: { support: "unsupported", availability: "Unavailable" },
    candidates: [],
  },
];

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
    councilWard: "Fixture North",
    schoolDivision: "Fixture School",
    schoolDivisionWard: "1",
  });
  assert.deepEqual(
    container.children.map(({ contestId, href, candidates }) => ({
      contestId,
      href,
      candidates,
    })),
    [
      {
        contestId: "mayor-fixture-city",
        href: "/contests/mayor-fixture-city/",
        candidates: ["Morgan Mayor", "Alex Alder"],
      },
      {
        contestId: "council-fixture-north",
        href: "/contests/council-fixture-north/",
        candidates: ["Casey Councillor"],
      },
      {
        contestId: "school-fixture-ward-1",
        href: "/contests/school-fixture-ward-1/",
        candidates: ["Taylor Trustee"],
      },
    ],
  );

  render({
    councilWard: "Fixture South",
    schoolDivision: "Fixture School",
    schoolDivisionWard: "1",
  });
  assert.deepEqual(
    container.children.map(({ contestId }) => contestId),
    [
      "mayor-fixture-city",
      "council-fixture-south",
      "school-fixture-ward-1",
    ],
  );
  assert.equal(
    container.children.some(
      ({ contestId }) => contestId === "council-fixture-north",
    ),
    false,
  );
  render(null);
  assert.deepEqual(container.children, []);
});

test("rendering preserves resolved Contests around unsupported or unfamiliar assignments", () => {
  const { container, render } = createRenderHarness();

  render({
    councilWard: "Fixture North",
    schoolDivision: "Unavailable School",
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
      ["mayor-fixture-city", "Published"],
      ["council-fixture-north", "Published"],
      ["school-unavailable-ward-1", "Unavailable"],
    ],
  );

  render({
    councilWard: "A Different Ward",
    schoolDivision: "Fixture School",
    schoolDivisionWard: "99",
  });
  assert.equal(container.children[0].contestId, "mayor-fixture-city");
  assert.deepEqual(container.children.slice(1), [
    { office: "Councillor", unresolved: true },
    { office: "School Trustee", unresolved: true },
  ]);
});

test("rendering selects unresolved templates for incomplete assignments", () => {
  const { container, render } = createRenderHarness();

  render({});

  assert.equal(container.children[0].contestId, "mayor-fixture-city");
  assert.deepEqual(container.children.slice(1), [
    { office: "Councillor", unresolved: true },
    { office: "School Trustee", unresolved: true },
  ]);
});
