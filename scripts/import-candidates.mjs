import { createInterface } from "node:readline/promises";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_ID = "city-candidate-dataset";
const SOURCE_URL = "https://data.winnipeg.ca/resource/9gi9-dauz.json?$limit=18000&$where=election_date%20%3E=%20%272026-01-01T00:00:00.000%27%20AND%20election_date%20%3C%20%272027-01-01T00:00:00.000%27%20AND%20(nomination_order%20IS%20NULL%20OR%20nomination_order%20%3E=%200)";
const defaultDataDirectory = fileURLToPath(new URL("../data/election-2026", import.meta.url));

function parseArguments(arguments_) {
  const options = {
    dataDirectory: defaultDataDirectory,
    list: false,
    observedAt: new Date().toISOString(),
    sourceFile: null,
  };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--list") {
      options.list = true;
    } else if (argument === "--data-dir") {
      options.dataDirectory = resolve(requiredValue(arguments_, ++index, argument));
    } else if (argument === "--source-file") {
      options.sourceFile = resolve(requiredValue(arguments_, ++index, argument));
    } else if (argument === "--observed-at") {
      options.observedAt = requiredValue(arguments_, ++index, argument);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (Number.isNaN(Date.parse(options.observedAt))) {
    throw new Error(`Invalid --observed-at value: ${options.observedAt}`);
  }
  options.observedAt = new Date(options.observedAt).toISOString();
  return options;
}

function requiredValue(arguments_, index, argument) {
  const value = arguments_[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${argument} requires a value.`);
  }
  return value;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readJsonOrDefault(path, fallback) {
  try {
    return readJson(path);
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function writeJsonAtomically(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporaryPath, path);
}

function nonEmpty(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function sourceLabelFor(row) {
  if (row.type === "Mayor") {
    return { contestId: "mayor-winnipeg" };
  }
  if (row.type === "Councillor") {
    const label = nonEmpty(row.ward);
    if (!label) throw new Error(`Councillor ${JSON.stringify(row.name)} has no Council Ward Source Label.`);
    return { kind: "councilWard", label };
  }
  if (row.type === "School Trustee") {
    const schoolDivision = nonEmpty(row.school_division);
    const ward = nonEmpty(row.school_division_ward);
    if (!schoolDivision || !ward) {
      throw new Error(`School Trustee ${JSON.stringify(row.name)} has an incomplete School Division Ward Source Label.`);
    }
    return {
      kind: "schoolDivisionWard",
      schoolDivision,
      ward,
    };
  }
  throw new Error(`Unsupported Candidate type ${JSON.stringify(row.type)} for ${JSON.stringify(row.name)}.`);
}

function sameSourceLabel(left, right) {
  return left.source === SOURCE_ID
    && left.kind === right.kind
    && left.label === right.label
    && left.schoolDivision === right.schoolDivision
    && left.ward === right.ward;
}

function describeSourceLabel(label) {
  if (label.kind === "councilWard") return `Council Ward ${JSON.stringify(label.label)}`;
  return `School Division Ward ${JSON.stringify(label.schoolDivision)} / ${JSON.stringify(label.ward)}`;
}

function candidateStatus(row) {
  const sourceValue = nonEmpty(row.candidate_status);
  if (!sourceValue) {
    throw new Error(`Candidate ${JSON.stringify(row.name)} has no source status.`);
  }
  const withdrawn = /\s+-\s*WITHDRAWN\s*$/i.test(row.name ?? "");
  const known = new Map([
    ["Registered", withdrawn ? "Registration Withdrawn" : "Registered"],
    ["Registration Withdrawn", "Registration Withdrawn"],
    ["Nominated", withdrawn ? "Nomination Withdrawn" : "Nominated"],
    ["Nomination Withdrawn", "Nomination Withdrawn"],
    ["Not Nominated", "Not Nominated"],
  ]);
  if (!known.has(sourceValue)) {
    throw new Error(`Candidate ${JSON.stringify(row.name)} has unrecognized source status ${JSON.stringify(sourceValue)}.`);
  }
  const value = known.get(sourceValue);
  const phase = ["Nominated", "Nomination Withdrawn", "Not Nominated"].includes(value)
    ? "nomination"
    : "registration";
  return { phase, status: { sourceValue, value } };
}

function addOptionalFields(candidate, row) {
  const fields = [
    ["registrationDate", "registration_date"],
    ["biography", "biography"],
    ["biographyFrench", "biography_francais"],
    ["imageUrl", "image"],
    ["campaignWebsite", "website"],
    ["email", "email"],
    ["phone", "phone"],
  ];
  for (const [target, source] of fields) {
    const value = nonEmpty(row[source]);
    if (value !== undefined) candidate[target] = value;
  }
  const socialLinks = ["facebook", "twitter", "linkedin", "instagram"]
    .flatMap((platform) => nonEmpty(row[platform]) ? [{ platform, url: row[platform] }] : []);
  if (socialLinks.length > 0) candidate.socialLinks = socialLinks;
  const disclosures = [
    ["financialDisclosure", "financial_disclosure_file_name", "financial_disclosure_link"],
    ["statementOfDisclosure", "statement_of_disclosure_file_name", "statement_of_disclosure_link"],
  ];
  for (const [target, fileNameField, linkField] of disclosures) {
    const fileName = nonEmpty(row[fileNameField]);
    const url = nonEmpty(row[linkField]);
    if (fileName || url) candidate[target] = { ...(fileName ? { fileName } : {}), ...(url ? { url } : {}) };
  }
  return candidate;
}

function normalizeRow(row, contestId, observedAt) {
  if (!nonEmpty(row.name)) throw new Error("A Candidate record has no source-published name.");
  const { phase, status } = candidateStatus(row);
  return addOptionalFields({
    contestId,
    source: {
      sourceId: SOURCE_ID,
      observedAt,
      ...(nonEmpty(row.id) ? { recordId: row.id } : {}),
    },
    sourcePublishedName: row.name,
    phase,
    status,
  }, row);
}

function candidateKey(candidate) {
  return candidate.source.recordId
    ? `${candidate.source.sourceId}:record:${candidate.source.recordId}`
    : `${candidate.source.sourceId}:record-without-id:${candidate.contestId}:${candidate.sourcePublishedName}`;
}

function comparableCandidate(candidate) {
  const { observedAt: _observedAt, ...source } = candidate.source;
  return { ...candidate, source };
}

function changedFieldLabels(previous, next, prefix = "") {
  if (JSON.stringify(previous) === JSON.stringify(next)) return [];
  const previousIsObject = previous !== null && typeof previous === "object" && !Array.isArray(previous);
  const nextIsObject = next !== null && typeof next === "object" && !Array.isArray(next);
  if (!previousIsObject || !nextIsObject) return [prefix];

  return [...new Set([...Object.keys(previous), ...Object.keys(next)])]
    .sort((left, right) => left.localeCompare(right, "en-CA"))
    .flatMap((field) =>
      changedFieldLabels(
        previous[field],
        next[field],
        prefix ? `${prefix}.${field}` : field,
      )
    );
}

function assertNoConflictingDuplicates(candidates) {
  const records = new Map();
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    const previous = records.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(candidate)) {
      throw new Error(`Conflicting duplicate Candidate record: ${key}.`);
    }
    records.set(key, candidate);
  }
  return [...records.values()];
}

function summarizeChanges(previousCandidates, nextCandidates) {
  const previous = new Map(previousCandidates.map((candidate) => [candidateKey(candidate), candidate]));
  const next = new Map(nextCandidates.map((candidate) => [candidateKey(candidate), candidate]));
  const added = [];
  const changed = [];
  const removed = [];
  for (const [key, candidate] of next) {
    if (!previous.has(key)) added.push(candidate);
    else if (JSON.stringify(comparableCandidate(previous.get(key))) !== JSON.stringify(comparableCandidate(candidate))) {
      changed.push({
        candidate,
        fields: changedFieldLabels(
          comparableCandidate(previous.get(key)),
          comparableCandidate(candidate),
        ),
      });
    }
  }
  for (const key of previous.keys()) {
    if (!next.has(key)) removed.push(previous.get(key));
  }
  return { added, changed, removed };
}

function printChangeSummary(summary) {
  console.log(
    `Added ${summary.added.length}, changed ${summary.changed.length}, removed ${summary.removed.length}`,
  );
  const groups = [
    ["Added Candidate Records:", "+", summary.added],
    ["Changed Candidate Records:", "~", summary.changed],
    ["Removed Candidate Records:", "-", summary.removed],
  ];
  for (const [heading, marker, records] of groups) {
    if (records.length === 0) continue;
    console.log(heading);
    for (const record of records) {
      const candidate = record.candidate ?? record;
      const fields = record.fields?.length ? ` (${record.fields.join(", ")})` : "";
      console.log(`  ${marker} [${candidate.contestId}] ${candidate.sourcePublishedName}${fields}`);
    }
  }
}

function contestDisplayName(contest) {
  return `${contest.office} — ${contest.electoralArea.canonicalName}`;
}

function assertContestMatchesRecord(contest, row, sourceLabel) {
  if (contest.office !== row.type) {
    throw new Error(`${contestDisplayName(contest)} does not elect a ${row.type}.`);
  }
  if (sourceLabel.kind && contest.electoralArea.kind !== sourceLabel.kind) {
    throw new Error(`${contestDisplayName(contest)} does not match ${describeSourceLabel(sourceLabel)}.`);
  }
}

function listCandidates(dataDirectory) {
  const contests = readJson(join(dataDirectory, "contests.json")).contests
    .filter((contest) => contest.candidateList.support === "supported");
  const candidates = readJson(join(dataDirectory, "candidates.json")).candidates;
  const namesByContest = new Map();
  for (const candidate of candidates) {
    const names = namesByContest.get(candidate.contestId) ?? [];
    names.push(candidate.sourcePublishedName);
    namesByContest.set(candidate.contestId, names);
  }
  for (const contest of contests) {
    console.log(contestDisplayName(contest));
    const names = namesByContest.get(contest.id)?.sort((left, right) => left.localeCompare(right, "en-CA"));
    if (!names?.length) console.log("  (no imported candidates)");
    else for (const name of names) console.log(`  ${name}`);
  }
}

async function readSource(options) {
  if (options.sourceFile) {
    return { sourceText: readFileSync(options.sourceFile, "utf8"), retrievalUrl: `file:${options.sourceFile}` };
  }
  const response = await fetch(SOURCE_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Required City Candidate source failed with HTTP ${response.status}.`);
  return { sourceText: await response.text(), retrievalUrl: SOURCE_URL };
}

async function ask(question, answers) {
  process.stdout.write(question);
  const { value = "" } = await answers.next();
  return value.trim();
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.list) {
    listCandidates(options.dataDirectory);
    return;
  }

  const contestsFile = join(options.dataDirectory, "contests.json");
  const mappingsFile = join(options.dataDirectory, "source-label-mappings.json");
  const decisionsFile = join(options.dataDirectory, "source-mapping-decisions.json");
  const candidatesFile = join(options.dataDirectory, "candidates.json");
  const contests = readJson(contestsFile).contests;
  const contestsById = new Map(contests.map((contest) => [contest.id, contest]));
  const supportedContestIds = new Set(
    contests.filter((contest) => contest.candidateList.support === "supported").map((contest) => contest.id),
  );
  const reviewedMappings = readJson(mappingsFile).labels
    .filter((mapping) => mapping.source === SOURCE_ID);
  const decisionsDocument = readJsonOrDefault(decisionsFile, { decisions: [] });
  const { sourceText, retrievalUrl } = await readSource(options);
  const rows = JSON.parse(sourceText);
  if (!Array.isArray(rows)) throw new Error("The City Candidate source response is not a JSON array.");

  const snapshotDirectory = join(options.dataDirectory, "source-snapshots", SOURCE_ID);
  mkdirSync(snapshotDirectory, { recursive: true });
  const snapshotName = `${options.observedAt.replaceAll(":", "-").replace(".", "-")}.json`;
  const snapshotPath = join(snapshotDirectory, snapshotName);
  if (existsSync(snapshotPath)) {
    if (readFileSync(snapshotPath, "utf8") !== sourceText) {
      throw new Error(`A different immutable Source Snapshot already exists at ${snapshotPath}.`);
    }
  } else {
    writeFileSync(snapshotPath, sourceText);
  }

  const input = createInterface({ input: process.stdin, output: process.stdout });
  const answers = input[Symbol.asyncIterator]();
  try {
    const normalized = [];
    for (const row of rows) {
      const sourceLabel = sourceLabelFor(row);
      let contestId = sourceLabel.contestId;
      if (!contestId) {
        const reviewed = reviewedMappings.filter((mapping) => sameSourceLabel(mapping, sourceLabel));
        const saved = decisionsDocument.decisions.filter((mapping) => sameSourceLabel(mapping, sourceLabel));
        const savedContestIds = new Set(saved.map((mapping) => mapping.contestId));
        const reviewedContestIds = new Set(reviewed.map((mapping) => mapping.contestId));
        const isAmbiguous = savedContestIds.size > 1
          || (savedContestIds.size === 0 && reviewedContestIds.size > 1);
        if (savedContestIds.size === 1) contestId = saved[0].contestId;
        else if (reviewedContestIds.size === 1) contestId = reviewed[0].contestId;
        if (!contestId || isAmbiguous) {
          console.log(`${isAmbiguous ? "Ambiguous" : "Unfamiliar"} source label: ${describeSourceLabel(sourceLabel)}`);
          const entered = await ask("Canonical Contest ID (blank to cancel): ", answers);
          if (!supportedContestIds.has(entered)) {
            throw new Error(`Unresolved Contest for ${describeSourceLabel(sourceLabel)}.`);
          }
          assertContestMatchesRecord(contestsById.get(entered), row, sourceLabel);
          contestId = entered;
          decisionsDocument.decisions = decisionsDocument.decisions
            .filter((mapping) => !sameSourceLabel(mapping, sourceLabel));
          decisionsDocument.decisions.push({
            source: SOURCE_ID,
            ...sourceLabel,
            contestId,
            decidedAt: options.observedAt,
          });
          writeJsonAtomically(decisionsFile, decisionsDocument);
        }
      }
      if (!supportedContestIds.has(contestId)) {
        throw new Error(`Candidate ${JSON.stringify(row.name)} resolved to unsupported or unknown Contest ${JSON.stringify(contestId)}.`);
      }
      assertContestMatchesRecord(contestsById.get(contestId), row, sourceLabel);
      normalized.push(normalizeRow(row, contestId, options.observedAt));
    }
    const candidates = assertNoConflictingDuplicates(normalized)
      .sort((left, right) => {
        const contestOrder = left.contestId.localeCompare(right.contestId, "en-CA");
        return contestOrder || left.sourcePublishedName.localeCompare(right.sourcePublishedName, "en-CA");
      });
    const previousDocument = readJsonOrDefault(candidatesFile, { candidates: [] });
    const summary = summarizeChanges(previousDocument.candidates, candidates);
    printChangeSummary(summary);
    const confirmed = /^(y|yes)$/i.test(await ask("Replace normalized Candidate data? [y/N] ", answers));
    if (!confirmed) throw new Error("Import declined; normalized Candidate data was not changed.");

    writeJsonAtomically(candidatesFile, {
      election: "2026 Municipal Council and School Boards Election",
      importedAt: options.observedAt,
      sourceSnapshots: [{
        sourceId: SOURCE_ID,
        observedAt: options.observedAt,
        retrievalUrl,
        path: relative(options.dataDirectory, snapshotPath).replaceAll("\\", "/"),
      }],
      candidates,
    });
    console.log("Candidate data replaced.");
    console.log("Review and commit the Source Snapshot, normalized Candidate data, and any mapping decisions.");
  } finally {
    input.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
