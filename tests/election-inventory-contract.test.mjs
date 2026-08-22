import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

function labelKey(label) {
  return label.kind === "schoolDivisionWard"
    ? `${label.source}\u0000${label.kind}\u0000${label.schoolDivision}\u0000${label.ward}`
    : `${label.source}\u0000${label.kind}\u0000${label.label}`;
}

function councilLabels(source, labels) {
  return labels.map((label) => ({ source, kind: "councilWard", label }));
}

function schoolLabels(source, labels) {
  return labels.map(([schoolDivision, ward]) => ({
    source,
    kind: "schoolDivisionWard",
    schoolDivision,
    ward,
  }));
}

test("the 2026 Election inventory completely and unambiguously covers the committed source evidence", () => {
  const inventory = readJson("../data/election-2026/contests.json");
  const mappings = readJson("../data/election-2026/source-label-mappings.json");
  const candidateEvidence = readJson("./fixtures/election-2026/city-candidates.json");
  const addressEvidence = readJson("./fixtures/election-2026/city-addresses.json");

  const contests = new Map(inventory.contests.map((contest) => [contest.id, contest]));
  assert.equal(contests.size, inventory.contests.length, "Contest IDs must be unique");
  assert.equal(inventory.contests.length, 43, "the curated inventory must contain all 43 applicable Contests");

  for (const contest of inventory.contests) {
    assert.ok(["Mayor", "Councillor", "School Trustee"].includes(contest.office), `${contest.id} has an Office`);
    assert.ok(contest.electoralArea?.canonicalName, `${contest.id} has a canonical Electoral Area`);
    assert.ok(Number.isInteger(contest.numberToElect) && contest.numberToElect > 0, `${contest.id} has a Number to Elect`);
    assert.ok(contest.provenance?.length, `${contest.id} has provenance`);
    assert.ok(Array.isArray(contest.aliases) && contest.aliases.length, `${contest.id} has source-label aliases`);
    assert.ok(["supported", "unsupported"].includes(contest.candidateList.support), `${contest.id} declares Candidate support`);
    assert.ok(["Published", "Unavailable"].includes(contest.candidateList.availability), `${contest.id} declares Candidate-list availability`);
    if (contest.candidateList.availability === "Unavailable") {
      assert.equal(contest.candidateList.verifiedCandidateCount, null, `${contest.id} must not represent unavailable coverage as zero Candidates`);
    }
  }

  const unsupported = inventory.contests
    .filter((contest) => contest.candidateList.support === "unsupported")
    .map((contest) => contest.id)
    .sort();
  assert.deepEqual(unsupported, ["school-interlake-ward-1", "school-seine-river-ward-1"]);

  const mappingCounts = new Map();
  for (const mapping of mappings.labels) {
    const contest = contests.get(mapping.contestId);
    assert.ok(contest, `${labelKey(mapping)} maps to an existing Contest`);
    assert.ok(["supported", "unsupported"].includes(mapping.support), `${labelKey(mapping)} declares support status`);
    assert.equal(mapping.support, contest.candidateList.support, `${labelKey(mapping)} support agrees with its Contest`);
    const key = labelKey(mapping);
    mappingCounts.set(key, (mappingCounts.get(key) ?? 0) + 1);
  }

  const observedLabels = [
    ...councilLabels(candidateEvidence.sourceId, candidateEvidence.observedLabels.councilWards),
    ...schoolLabels(candidateEvidence.sourceId, candidateEvidence.observedLabels.schoolDivisionWards),
    ...councilLabels(addressEvidence.sourceId, addressEvidence.observedLabels.councilWards),
    ...schoolLabels(addressEvidence.sourceId, addressEvidence.observedLabels.schoolDivisionWards),
  ];
  for (const label of observedLabels) {
    assert.equal(mappingCounts.get(labelKey(label)), 1, `${labelKey(label)} maps to exactly one canonical Contest`);
  }

  for (const [division, ward] of addressEvidence.observedLabels.schoolDivisionWards) {
    assert.equal(
      mappings.labels.some((mapping) =>
        mapping.source === addressEvidence.sourceId &&
        mapping.kind === "schoolDivisionWard" &&
        mapping.schoolDivision === division &&
        mapping.ward === ward),
      true,
      `${division} ${ward} is mapped as a qualified School Division Ward`,
    );
  }
  const repeatedWardOneTargets = mappings.labels
    .filter((mapping) => mapping.source === addressEvidence.sourceId && mapping.kind === "schoolDivisionWard" && mapping.ward === "1")
    .map((mapping) => mapping.contestId);
  assert.ok(new Set(repeatedWardOneTargets).size > 1, "Ward 1 remains distinct across School Divisions");

  assert.ok(candidateEvidence.rawRows.some((row) => row.type === "Mayor"));
  assert.ok(candidateEvidence.rawRows.some((row) => row.type === "Councillor" && row.ward));
  assert.ok(candidateEvidence.rawRows.some((row) => row.type === "School Trustee" && row.school_division && row.school_division_ward));
  assert.ok(candidateEvidence.rawRows.some((row) => row.name.includes("WITHDRAWN")));
  assert.ok(candidateEvidence.rawRows.some((row) => row.facebook || row.twitter || row.linkedin || row.instagram));
  assert.ok(candidateEvidence.rawRows.some((row) => !row.phone && !row.email && !row.website));
  for (const evidence of [candidateEvidence, candidateEvidence.publicationPage, addressEvidence]) {
    assert.match(evidence.observedAt, /^2026-\d{2}-\d{2}$/u, `${evidence.sourceId} records when it was observed`);
    assert.match(evidence.retrievalUrl, /^https:\/\//u, `${evidence.sourceId} records where it was retrieved`);
    assert.ok(evidence.retrievalMethod, `${evidence.sourceId} records how it was retrieved`);
    assert.ok(evidence.format, `${evidence.sourceId} records its raw format`);
  }
  const publicationScript = candidateEvidence.publicationPage.rawScriptFragments.join("\n");
  assert.match(publicationScript, /9gi9-dauz\.json/u);
  assert.match(publicationScript, /candidate_status === 'Nominated'/u);
  for (const row of candidateEvidence.rawRows) {
    for (const field of ["id", "election_date", "registration_date", "name", "type", "candidate_status"]) {
      assert.ok(row[field], `Candidate fixture ${row.id} retains raw ${field}`);
    }
  }

  assert.ok(addressEvidence.rawRows.some((row) => row.school_division === "Seine River" && row.school_division_ward === "1"));
  assert.ok(addressEvidence.rawRows.some((row) => row.school_division === "Interlake" && row.school_division_ward === "Rosser"));
  assert.ok(addressEvidence.rawRows.some((row) => row.school_division == null && row.school_division_ward == null));
  for (const row of addressEvidence.rawRows) {
    for (const field of ["street_address", "ward_as_of_september_17"]) {
      assert.ok(row[field], `Address fixture ${row.street_address} retains raw ${field}`);
    }
  }
});
