import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resolveApplicableContests } from "../contest-resolver.js";

const { contests } = JSON.parse(
  readFileSync(new URL("../data/election-2026/contests.json", import.meta.url), "utf8"),
);

test("a supported Civic Address resolves the applicable Contests in Office order", () => {
  const resolution = resolveApplicableContests(
    {
      councilWard: "Fort Rouge - East Fort Garry",
      schoolDivision: "Winnipeg",
      schoolDivisionWard: "5",
    },
    contests,
  );

  assert.deepEqual(
    resolution.map(({ office, status, contest }) => ({
      office,
      status,
      contestId: contest?.id,
    })),
    [
      { office: "Mayor", status: "resolved", contestId: "mayor-winnipeg" },
      {
        office: "Councillor",
        status: "resolved",
        contestId: "council-fort-rouge-east-fort-garry",
      },
      {
        office: "School Trustee",
        status: "resolved",
        contestId: "school-winnipeg-ward-5",
      },
    ],
  );
});

for (const assignment of [
  {
    name: "Seine River",
    councilWard: "St. Norbert - Seine River",
    schoolDivision: "Seine River",
    schoolDivisionWard: "1",
    councilContestId: "council-st-norbert-seine-river",
    schoolContestId: "school-seine-river-ward-1",
  },
  {
    name: "Interlake Rosser",
    councilWard: "St. James",
    schoolDivision: "Interlake",
    schoolDivisionWard: "Rosser",
    councilContestId: "council-st-james",
    schoolContestId: "school-interlake-ward-1",
  },
]) {
  test(`${assignment.name} resolves without becoming an empty Candidate list`, () => {
    const resolution = resolveApplicableContests(assignment, contests);

    assert.deepEqual(
      resolution.map(({ status, contest }) => ({
        status,
        contestId: contest?.id,
        candidateListAvailability: contest?.candidateList.availability,
      })),
      [
        {
          status: "resolved",
          contestId: "mayor-winnipeg",
          candidateListAvailability: "Published",
        },
        {
          status: "resolved",
          contestId: assignment.councilContestId,
          candidateListAvailability: "Published",
        },
        {
          status: "resolved",
          contestId: assignment.schoolContestId,
          candidateListAvailability: "Unavailable",
        },
      ],
    );
  });
}

test("unfamiliar and incomplete labels stay unresolved while independent Contests remain usable", () => {
  const unfamiliar = resolveApplicableContests({
    councilWard: "A Different Ward",
    schoolDivision: "Winnipeg",
    schoolDivisionWard: "99",
  }, contests);
  assert.deepEqual(
    unfamiliar.map(({ status, contest }) => [status, contest?.id ?? null]),
    [
      ["resolved", "mayor-winnipeg"],
      ["unresolved", null],
      ["unresolved", null],
    ],
  );
  assert.match(unfamiliar[1].message, /Council Ward could not be matched/);
  assert.match(
    unfamiliar[2].message,
    /School Division Ward could not be matched/,
  );
  assert.match(unfamiliar[2].message, /No different Contest was selected/);

  const incomplete = resolveApplicableContests({
    councilWard: "Point Douglas",
    schoolDivision: "Winnipeg",
    schoolDivisionWard: null,
  }, contests);
  assert.deepEqual(
    incomplete.map(({ status, contest }) => [status, contest?.id ?? null]),
    [
      ["resolved", "mayor-winnipeg"],
      ["resolved", "council-point-douglas"],
      ["unresolved", null],
    ],
  );
});
