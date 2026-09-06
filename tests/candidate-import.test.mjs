import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = new URL("../", import.meta.url);
const importScript = fileURLToPath(new URL("../scripts/import-candidates.mjs", import.meta.url));

function makeDataDirectory() {
  const root = mkdtempSync(join(tmpdir(), "candidate-import-"));
  const dataDirectory = join(root, "election-2026");
  mkdirSync(dataDirectory);
  copyFileSync(
    new URL("../data/election-2026/contests.json", import.meta.url),
    join(dataDirectory, "contests.json"),
  );
  copyFileSync(
    new URL("../data/election-2026/source-label-mappings.json", import.meta.url),
    join(dataDirectory, "source-label-mappings.json"),
  );
  return dataDirectory;
}

function existingCandidateDocument() {
  return { candidates: [{
    contestId: "mayor-winnipeg",
    source: {
      sourceId: "city-candidate-dataset",
      observedAt: "2026-08-20T00:00:00.000Z",
      recordId: "old",
    },
    sourcePublishedName: "Existing Candidate",
    phase: "registration",
    status: { sourceValue: "Registered", value: "Registered" },
  }] };
}

function runImporter(
  dataDirectory,
  sourceFile,
  input = "yes\n",
  observedAt = "2026-08-22T15:30:00.000Z",
) {
  return execFileSync(
    process.execPath,
    [
      importScript,
      "--data-dir",
      dataDirectory,
      "--source-file",
      sourceFile,
      "--observed-at",
      observedAt,
    ],
    {
      cwd: projectRoot,
      encoding: "utf8",
      input,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}

test("confirmed import preserves evidence and proposes normalized Contest-scoped Candidates", () => {
  const dataDirectory = makeDataDirectory();
  const sourceFile = join(dataDirectory, "source.json");
  const reviewedRows = readJson(
    fileURLToPath(new URL("fixtures/election-2026/city-candidates.json", import.meta.url)),
  ).rawRows;
  const sourceText = `${JSON.stringify([
    {
      ...reviewedRows.find((row) => row.id === "2026-28"),
      financial_disclosure_file_name: "financial.pdf",
      financial_disclosure_link: "https://example.test/financial.pdf",
    },
    reviewedRows.find((row) => row.id === "2026-39"),
    reviewedRows.find((row) => row.id === "2026-47"),
    {
      id: "2026-99",
      election_date: "2026-10-28T00:00:00",
      registration_date: "2026-07-01T00:00:00",
      name: "Remembered Mapping",
      type: "Councillor",
      candidate_status: "Registered",
      ward: "New Source Ward Label",
    },
  ], null, 2)}\n`;
  writeFileSync(sourceFile, sourceText);
  writeFileSync(
    join(dataDirectory, "source-mapping-decisions.json"),
    `${JSON.stringify({
      decisions: [
        {
          source: "city-candidate-dataset",
          kind: "councilWard",
          label: "New Source Ward Label",
          contestId: "council-st-boniface",
          decidedAt: "2026-08-21T12:00:00.000Z",
        },
      ],
    }, null, 2)}\n`,
  );

  const output = runImporter(dataDirectory, sourceFile);

  assert.match(output, /Added 4, changed 0, removed 0/);
  assert.match(output, /Added Candidate Records:\s+\+ \[council-st-boniface\] Matt Allard/);
  assert.match(output, /\+ \[council-st-boniface\] Remembered Mapping/);
  assert.match(output, /\+ \[mayor-winnipeg\] Scott Gillingham/);
  assert.match(output, /\+ \[school-louis-riel-ward-2\] Brian Mayes/);
  assert.ok(
    output.indexOf("Added Candidate Records:") < output.indexOf("Replace normalized Candidate data?"),
    "the review details are printed before confirmation",
  );
  assert.match(output, /Candidate data replaced\./);
  assert.match(output, /Review and commit the Source Snapshot, normalized Candidate data, and any mapping decisions\./);

  const snapshotDirectory = join(dataDirectory, "source-snapshots", "city-candidate-dataset");
  const snapshotFiles = readdirSync(snapshotDirectory);
  assert.deepEqual(snapshotFiles, ["2026-08-22T15-30-00-000Z.json"]);
  assert.equal(readFileSync(join(snapshotDirectory, snapshotFiles[0]), "utf8"), sourceText);

  const normalized = JSON.parse(readFileSync(join(dataDirectory, "candidates.json"), "utf8"));
  assert.equal(normalized.sourceSnapshots[0].observedAt, "2026-08-22T15:30:00.000Z");
  assert.equal(normalized.candidates.length, 4);
  assert.deepEqual(
    normalized.candidates.map(({ contestId, sourcePublishedName }) => [contestId, sourcePublishedName]),
    [
      ["council-st-boniface", "Matt Allard"],
      ["council-st-boniface", "Remembered Mapping"],
      ["mayor-winnipeg", "Scott Gillingham"],
      ["school-louis-riel-ward-2", "Brian Mayes"],
    ],
  );
  assert.deepEqual(normalized.candidates[2].status, {
    sourceValue: "Registered",
    value: "Registered",
  });
  assert.equal(normalized.candidates[2].phase, "registration");
  assert.equal(normalized.candidates[2].email, "info@scottgillingham.com");
  assert.deepEqual(normalized.candidates[2].financialDisclosure, {
    fileName: "financial.pdf",
    url: "https://example.test/financial.pdf",
  });
  assert.ok(!("officialAgent" in normalized.candidates[2]));

  const repeatOutput = runImporter(
    dataDirectory,
    sourceFile,
    "yes\n",
    "2026-08-23T15:30:00.000Z",
  );
  assert.match(repeatOutput, /Added 0, changed 0, removed 0/);

  const listing = execFileSync(
    process.execPath,
    [importScript, "--list", "--data-dir", dataDirectory],
    { cwd: projectRoot, encoding: "utf8" },
  );
  assert.match(listing, /Mayor — Winnipeg\n  Scott Gillingham/);
  assert.match(listing, /Councillor — St\. Boniface\n  Matt Allard\n  Remembered Mapping/);
  assert.match(listing, /School Trustee — Winnipeg School Division — Ward 2\n  \(no imported candidates\)/);
});

test("import review identifies added, changed, and removed Candidate Records without exposing changed values", () => {
  const dataDirectory = makeDataDirectory();
  const sourceFile = join(dataDirectory, "source.json");
  writeFileSync(
    join(dataDirectory, "candidates.json"),
    `${JSON.stringify({
      candidates: [
        {
          contestId: "mayor-winnipeg",
          source: {
            sourceId: "city-candidate-dataset",
            observedAt: "2026-08-20T00:00:00.000Z",
            recordId: "changed-record",
          },
          sourcePublishedName: "Changed Candidate",
          phase: "registration",
          status: { sourceValue: "Registered", value: "Registered" },
          email: "old-private-value@example.test",
        },
        {
          contestId: "mayor-winnipeg",
          source: {
            sourceId: "city-candidate-dataset",
            observedAt: "2026-08-20T00:00:00.000Z",
            recordId: "removed-record",
          },
          sourcePublishedName: "Removed Candidate",
          phase: "registration",
          status: { sourceValue: "Registered", value: "Registered" },
        },
      ],
    }, null, 2)}\n`,
  );
  writeFileSync(sourceFile, `${JSON.stringify([
    {
      id: "added-record",
      election_date: "2026-10-28T00:00:00",
      registration_date: "2026-09-01T00:00:00",
      name: "Added Candidate",
      type: "Mayor",
      candidate_status: "Registered",
    },
    {
      id: "changed-record",
      election_date: "2026-10-28T00:00:00",
      registration_date: "2026-08-01T00:00:00",
      name: "Changed Candidate",
      type: "Mayor",
      candidate_status: "Nominated",
      email: "new-private-value@example.test",
    },
  ], null, 2)}\n`);

  const output = runImporter(dataDirectory, sourceFile);

  assert.match(output, /Added 1, changed 1, removed 1/);
  assert.match(output, /Added Candidate Records:\s+\+ \[mayor-winnipeg\] Added Candidate/);
  assert.match(
    output,
    /Changed Candidate Records:\s+~ \[mayor-winnipeg\] Changed Candidate \(email, phase, registrationDate, status\.sourceValue, status\.value\)/,
  );
  assert.match(output, /Removed Candidate Records:\s+- \[mayor-winnipeg\] Removed Candidate/);
  assert.doesNotMatch(output, /old-private-value|new-private-value/);
  assert.ok(output.indexOf("Removed Candidate Records:") < output.indexOf("Replace normalized Candidate data?"));
});

test("failed validation and declined confirmation leave normalized Candidate data unchanged", async (t) => {
  await t.test("a declined replacement retains an accepted Source Mapping Decision", () => {
    const dataDirectory = makeDataDirectory();
    const sourceFile = join(dataDirectory, "source.json");
    const candidatesFile = join(dataDirectory, "candidates.json");
    const previousBytes = `${JSON.stringify(existingCandidateDocument(), null, 2)}\n`;
    writeFileSync(candidatesFile, previousBytes);
    writeFileSync(sourceFile, `${JSON.stringify([{
      id: "2026-100",
      name: "Operator Decision",
      type: "Councillor",
      candidate_status: "Registered",
      ward: "Unfamiliar Ward",
    }], null, 2)}\n`);

    assert.throws(
      () => runImporter(dataDirectory, sourceFile, "council-st-boniface\nno\n"),
      /Import declined/,
    );
    assert.equal(readFileSync(candidatesFile, "utf8"), previousBytes);
    assert.deepEqual(readJson(join(dataDirectory, "source-mapping-decisions.json")).decisions, [
      {
        source: "city-candidate-dataset",
        kind: "councilWard",
        label: "Unfamiliar Ward",
        contestId: "council-st-boniface",
        decidedAt: "2026-08-22T15:30:00.000Z",
      },
    ]);
  });

  await t.test("invalid source records do not replace existing normalized bytes", () => {
    const dataDirectory = makeDataDirectory();
    const sourceFile = join(dataDirectory, "source.json");
    const candidatesFile = join(dataDirectory, "candidates.json");
    const previousBytes = `${JSON.stringify(existingCandidateDocument(), null, 2)}\n`;
    writeFileSync(candidatesFile, previousBytes);
    writeFileSync(sourceFile, `${JSON.stringify([{
      id: "2026-invalid",
      name: "Unknown Status",
      type: "Councillor",
      candidate_status: "Future Official Status",
      ward: "St. Boniface",
    }], null, 2)}\n`);

    assert.throws(() => runImporter(dataDirectory, sourceFile), /unrecognized source status/);
    assert.equal(readFileSync(candidatesFile, "utf8"), previousBytes);
  });

  await t.test("an unfamiliar label cannot be assigned to a Contest for another Office", () => {
    const dataDirectory = makeDataDirectory();
    const sourceFile = join(dataDirectory, "source.json");
    writeFileSync(sourceFile, `${JSON.stringify([{
      id: "2026-wrong-office",
      name: "Wrong Office Decision",
      type: "Councillor",
      candidate_status: "Registered",
      ward: "Unfamiliar Ward",
    }], null, 2)}\n`);

    assert.throws(
      () => runImporter(dataDirectory, sourceFile, "mayor-winnipeg\n"),
      /does not elect a Councillor/,
    );
    assert.ok(!readdirSync(dataDirectory).includes("candidates.json"));
  });

  await t.test("a genuine mapping ambiguity is explicitly resolved and remembered", () => {
    const dataDirectory = makeDataDirectory();
    const sourceFile = join(dataDirectory, "source.json");
    writeFileSync(sourceFile, `${JSON.stringify([{
      id: "2026-ambiguous",
      name: "Resolved Candidate",
      type: "Councillor",
      candidate_status: "Registered",
      ward: "Ambiguous Ward",
    }], null, 2)}\n`);
    writeFileSync(join(dataDirectory, "source-mapping-decisions.json"), `${JSON.stringify({
      decisions: [
        { source: "city-candidate-dataset", kind: "councilWard", label: "Ambiguous Ward", contestId: "council-st-boniface" },
        { source: "city-candidate-dataset", kind: "councilWard", label: "Ambiguous Ward", contestId: "council-st-vital" },
      ],
    }, null, 2)}\n`);

    const output = runImporter(dataDirectory, sourceFile, "council-st-vital\nyes\n");

    assert.match(output, /Ambiguous source label/);
    assert.equal(readJson(join(dataDirectory, "candidates.json")).candidates[0].contestId, "council-st-vital");
    assert.deepEqual(readJson(join(dataDirectory, "source-mapping-decisions.json")).decisions, [{
      source: "city-candidate-dataset",
      kind: "councilWard",
      label: "Ambiguous Ward",
      contestId: "council-st-vital",
      decidedAt: "2026-08-22T15:30:00.000Z",
    }]);
  });

  await t.test("a timestamp collision cannot mutate an existing Source Snapshot", () => {
    const dataDirectory = makeDataDirectory();
    const sourceFile = join(dataDirectory, "source.json");
    const firstSource = `${JSON.stringify([{
      id: "2026-first",
      name: "First Observation",
      type: "Mayor",
      candidate_status: "Registered",
    }], null, 2)}\n`;
    writeFileSync(sourceFile, firstSource);
    runImporter(dataDirectory, sourceFile);
    const candidatesFile = join(dataDirectory, "candidates.json");
    const previousBytes = readFileSync(candidatesFile, "utf8");

    writeFileSync(sourceFile, `${JSON.stringify([{
      id: "2026-second",
      name: "Different Observation",
      type: "Mayor",
      candidate_status: "Registered",
    }], null, 2)}\n`);

    assert.throws(() => runImporter(dataDirectory, sourceFile), /immutable Source Snapshot already exists/);
    assert.equal(readFileSync(candidatesFile, "utf8"), previousBytes);
    assert.equal(
      readFileSync(join(dataDirectory, "source-snapshots", "city-candidate-dataset", "2026-08-22T15-30-00-000Z.json"), "utf8"),
      firstSource,
    );
  });
});

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
