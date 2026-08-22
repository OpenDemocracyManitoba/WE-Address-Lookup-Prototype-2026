import test from "node:test";
import assert from "node:assert/strict";
import { presentElection } from "../election-presentation.js";

test("Contest presentation omits nomination-withdrawn Candidate Records", () => {
  const presentation = presentElection(
    {
      election: "Fixture Election",
      contests: [
        {
          id: "council-fixture-ward",
          office: "Councillor",
          electoralArea: { kind: "councilWard", canonicalName: "Fixture Ward" },
          numberToElect: 1,
        },
      ],
    },
    {
      candidates: [
        {
          contestId: "council-fixture-ward",
          sourcePublishedName: "Alex Active",
          phase: "nomination",
          status: { sourceValue: "Nominated", value: "Nominated" },
        },
        {
          contestId: "council-fixture-ward",
          sourcePublishedName: "Wendy Withdrawn",
          phase: "nomination",
          status: {
            sourceValue: "Nomination Withdrawn",
            value: "Nomination Withdrawn",
          },
        },
      ],
    },
  );

  assert.deepEqual(
    presentation.contests[0].candidates.map((candidate) => ({
      name: candidate.sourcePublishedName,
      role: candidate.presentation.roleLabel,
      status: candidate.status.value,
    })),
    [{ name: "Alex Active", role: "Candidate", status: "Nominated" }],
  );
});
