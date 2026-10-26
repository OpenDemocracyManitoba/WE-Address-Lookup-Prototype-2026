import test from "node:test";
import assert from "node:assert/strict";
import { presentContestCoverage, presentElection } from "../election-presentation.js";

test("Contest presentation omits nomination-withdrawn Candidate Records", () => {
  const presentation = presentElection(
    {
      election: "Fixture Election",
      phase: "nomination",
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

test("Contest presentation sorts active Candidate Records by derived family name", () => {
  const presentation = presentElection(
    {
      election: "Fixture Election",
      phase: "registration",
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
          sourcePublishedName: "Casey Zulu",
          phase: "registration",
          status: { sourceValue: "Registered", value: "Registered" },
        },
        {
          contestId: "council-fixture-ward",
          sourcePublishedName: "Robin Alpha",
          phase: "registration",
          status: { sourceValue: "Registered", value: "Registered" },
        },
        {
          contestId: "council-fixture-ward",
          sourcePublishedName: "Wendy Withdrawn - WITHDRAWN",
          phase: "registration",
          status: {
            sourceValue: "Registered",
            value: "Registration Withdrawn",
          },
        },
      ],
    },
  );

  assert.deepEqual(
    presentation.contests[0].candidates.map(({ sourcePublishedName }) => sourcePublishedName),
    ["Robin Alpha", "Casey Zulu"],
  );
});

function presentCandidate(candidate) {
  return presentElection(
    {
      election: "Fixture Election",
      phase: "registration",
      contests: [
        {
          id: "mayor-winnipeg",
          office: "Mayor",
          electoralArea: { kind: "citywide", canonicalName: "Winnipeg" },
          numberToElect: 1,
        },
      ],
    },
    {
      candidates: [
        {
          contestId: "mayor-winnipeg",
          sourcePublishedName: "Casey Candidate",
          phase: "registration",
          status: { sourceValue: "Registered", value: "Registered" },
          ...candidate,
        },
      ],
    },
  ).contests[0].candidates[0];
}

test("Candidate presentation derives populated display values", () => {
  const candidate = presentCandidate({
    campaignWebsite: "campaign.example",
    financialDisclosure: {
      fileName: "Financial disclosure.pdf",
      url: "files.example/financial.pdf",
    },
    imageUrl: "images.example/candidate.jpg",
    phone: "+1 (204) 555-0123",
    registrationDate: "2026-06-30T00:00:00.000",
    socialLinks: [
      { platform: "twitter", url: "social.example/candidate" },
      { platform: "mastodon", url: "https://social.example/@candidate" },
    ],
    statementOfDisclosure: {
      fileName: "Statement.pdf",
      url: "https://files.example/statement.pdf",
    },
  });

  assert.deepEqual(candidate.presentation, {
    acclaimed: false,
    campaignUrl: "https://campaign.example/",
    displayName: "Casey Candidate",
    financialDisclosure: {
      fileName: "Financial disclosure.pdf",
      publicUrl: "https://files.example/financial.pdf",
    },
    imageUrl: "https://images.example/candidate.jpg",
    phaseLabel: "Registration",
    phoneHref: "+12045550123",
    registrationDate: "June 30, 2026",
    roleLabel: "Prospective Candidate",
    socialLinks: [
      {
        label: "X (formerly Twitter)",
        platform: "twitter",
        publicUrl: "https://social.example/candidate",
        url: "social.example/candidate",
      },
      {
        label: "mastodon",
        platform: "mastodon",
        publicUrl: "https://social.example/@candidate",
        url: "https://social.example/@candidate",
      },
    ],
    statementOfDisclosure: {
      fileName: "Statement.pdf",
      publicUrl: "https://files.example/statement.pdf",
    },
  });
});

test("Candidate presentation represents missing optional display values", () => {
  assert.deepEqual(presentCandidate({}).presentation, {
    acclaimed: false,
    campaignUrl: null,
    displayName: "Casey Candidate",
    financialDisclosure: { fileName: undefined, publicUrl: null },
    imageUrl: null,
    phaseLabel: "Registration",
    phoneHref: null,
    registrationDate: null,
    roleLabel: "Prospective Candidate",
    socialLinks: [],
    statementOfDisclosure: { fileName: undefined, publicUrl: null },
  });
});

test("Candidate presentation separates an acclaimed suffix from the display name", () => {
  const { presentation } = presentCandidate({
    sourcePublishedName: "Casey CANDIDATE  - ACCLAIMED",
  });
  assert.equal(presentation.acclaimed, true);
  assert.equal(presentation.displayName, "Casey CANDIDATE");
});

test("Candidate presentation rejects invalid optional external URLs", () => {
  const candidate = presentCandidate({
    campaignWebsite: "https://[invalid",
    financialDisclosure: { fileName: "Financial disclosure.pdf", url: "javascript:alert(1)" },
    imageUrl: "javascript:alert(1)",
    socialLinks: [
      { platform: "facebook", url: "https://[invalid" },
      { platform: "instagram", url: "javascript:alert(1)" },
    ],
    statementOfDisclosure: { url: "https://[invalid" },
  });

  assert.equal(candidate.presentation.campaignUrl, null);
  assert.equal(candidate.presentation.imageUrl, null);
  assert.deepEqual(candidate.presentation.socialLinks, []);
  assert.deepEqual(candidate.presentation.financialDisclosure, {
    fileName: "Financial disclosure.pdf",
    publicUrl: null,
  });
  assert.deepEqual(candidate.presentation.statementOfDisclosure, {
    fileName: undefined,
    publicUrl: null,
  });
});

function coverageFixture(contests) {
  return presentContestCoverage(
    { meta: { compiled: "2026-09-05" }, contests },
    {
      contests: [
        {
          id: "council-fixture-ward",
          candidateList: { availability: "Published" },
          candidates: [{ source: { recordId: "2026-1" } }],
        },
      ],
    },
  );
}

test("News coverage groups race, Candidate, and roundup items in file order", () => {
  const race = { kind: "race_profile", date: "2026-09-26", format: "video", url: "https://example.test/race", candidates: [] };
  const profile = { kind: "candidate_profile", date: "2026-05-04", format: "article", url: "https://example.test/one", candidates: [{ candidate_id: "2026-1", name_official: "Alex EXAMPLE" }] };
  const roundup = { kind: "all_wards_roundup", date: null, format: "article", url: "https://example.test/all", candidates: [] };
  const coverage = coverageFixture({ "council-fixture-ward": { items: [race, profile, roundup] } });

  assert.equal(coverage.compiled, "Sept. 5, 2026");
  const contest = coverage.contests["council-fixture-ward"];
  assert.deepEqual(contest.raceItems.map((item) => [item.url, item.displayDate, item.video]), [["https://example.test/race", "Sept. 26", true]]);
  assert.deepEqual(contest.candidateItems["2026-1"].map((item) => [item.url, item.displayDate]), [["https://example.test/one", "May 4"]]);
  assert.deepEqual(contest.roundups.map((item) => [item.url, item.displayDate]), [["https://example.test/all", null]]);
});

test("News coverage never shows a roundup as a Contest's only race-level coverage", () => {
  const roundup = { kind: "all_wards_roundup", date: "2026-09-26", url: "https://example.test/all", candidates: [] };
  const coverage = coverageFixture({ "council-fixture-ward": { items: [roundup] } });
  assert.deepEqual(coverage.contests["council-fixture-ward"].roundups, []);
});

test("News coverage rejects unknown Contests and Candidates instead of guessing", () => {
  assert.throws(() => coverageFixture({ "council-missing-ward": { items: [] } }), /unknown Contest "council-missing-ward"/);
  const profile = { kind: "candidate_profile", date: "2026-10-01", url: "https://example.test/x", candidates: [{ candidate_id: "2026-9", name_official: "Pat NOBODY" }] };
  assert.throws(() => coverageFixture({ "council-fixture-ward": { items: [profile] } }), /unknown Candidate 2026-9 \(Pat NOBODY\)/);
});
