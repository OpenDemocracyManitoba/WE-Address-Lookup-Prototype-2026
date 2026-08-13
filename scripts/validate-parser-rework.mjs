import { execFileSync } from "node:child_process";

const ENDPOINT = "https://data.winnipeg.ca/resource/cam2-ii3u.json";
const PAGE_SIZE = 50_000;
const FIELDS = [
  "street_address",
  "street_number",
  "street_number_suffix",
  "street_name",
  "street_type",
  "street_direction",
  "school_division",
  "school_division_ward",
  "ward_as_of_september_17",
];

async function baselineModule() {
  const source = execFileSync("git", ["show", "HEAD:address-data.js"], {
    encoding: "utf8",
  });
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

async function fetchRows() {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const params = new URLSearchParams();
    params.set("$select", FIELDS.join(","));
    params.set("$group", FIELDS.join(","));
    params.set("$order", FIELDS.join(","));
    params.set("$limit", String(PAGE_SIZE));
    params.set("$offset", String(offset));
    const response = await fetch(`${ENDPOINT}?${params}`);
    if (!response.ok) throw new Error(`City request failed with HTTP ${response.status}`);
    const page = await response.json();
    if (!Array.isArray(page)) throw new TypeError("City response was not an array");
    rows.push(...page);
    process.stderr.write(`Fetched ${rows.length} grouped civic rows\n`);
    if (page.length < PAGE_SIZE) return rows;
  }
}

function normalized(value) {
  return String(value ?? "").trim().toUpperCase();
}

function rowMatchesCandidate(row, candidate) {
  if (Number(row.street_number) !== candidate.streetNumber) return false;
  if (!normalized(row.street_name).startsWith(candidate.streetName)) return false;
  if (
    candidate.streetNumberSuffix &&
    normalized(row.street_number_suffix) !== candidate.streetNumberSuffix
  ) return false;
  if (candidate.streetType && normalized(row.street_type) !== candidate.streetType) return false;
  if (
    candidate.streetDirection &&
    normalized(row.street_direction) !== candidate.streetDirection
  ) return false;
  return true;
}

function rowKey(row) {
  return FIELDS.map((field) => normalized(row[field])).join("\u001f");
}

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

function summarize(values) {
  const sorted = values.toSorted((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted.at(-1) ?? null,
  };
}

function resultRank(module, matches, candidates, target) {
  const normalizedRows = module.normalizeRawAuthoritativeRows(matches);
  const sorted = module.dedupeAndSortNormalizedRows(normalizedRows, candidates);
  const targetKey = rowKey(target);
  return sorted.findIndex((row) => rowKey({
    street_address: row.displayAddress,
    street_number: row.streetNumber,
    street_number_suffix: row.streetNumberSuffix,
    street_name: row.streetName,
    street_type: row.streetType,
    street_direction: row.streetDirection,
    school_division: row.schoolDivision,
    school_division_ward: row.schoolDivisionWard,
    ward_as_of_september_17: row.councilWard,
  }) === targetKey);
}

function audit(module, rowsByNumber, rows, inputForRow) {
  const resultCounts = [];
  const targetRanks = [];
  const failures = [];
  let maxCandidates = 0;
  let maxQueryLength = 0;
  let broadest = null;

  for (const target of rows) {
    const input = inputForRow(target);
    const parsed = module.parseAddress(input);
    maxCandidates = Math.max(maxCandidates, parsed.candidates.length);
    if (!parsed.eligible) {
      if (failures.length < 10) failures.push({ input, reason: "ineligible", target });
      continue;
    }
    maxQueryLength = Math.max(maxQueryLength, module.buildQuery(parsed.candidates).length);
    const cohort = rowsByNumber.get(Number(target.street_number)) ?? [];
    const matches = cohort.filter((row) =>
      parsed.candidates.some((candidate) => rowMatchesCandidate(row, candidate)),
    );
    const found = matches.some((row) => rowKey(row) === rowKey(target));
    if (!found) {
      if (failures.length < 10) failures.push({ input, reason: "not recalled", target });
      continue;
    }
    resultCounts.push(matches.length);
    const rank = resultRank(module, matches, parsed.candidates, target);
    targetRanks.push(rank + 1);
    if (!broadest || matches.length > broadest.count) {
      broadest = { input, count: matches.length, targetRank: rank + 1 };
    }
  }

  return {
    attempted: rows.length,
    failed: rows.length - resultCounts.length,
    failures,
    maxCandidates,
    maxQueryLength,
    resultCounts: summarize(resultCounts),
    targetRanks: summarize(targetRanks),
    broadest,
  };
}

const [baseline, experiment, rows] = await Promise.all([
  baselineModule(),
  import("../address-data.js"),
  fetchRows(),
]);
const rowsByNumber = new Map();
for (const row of rows) {
  const number = Number(row.street_number);
  if (!rowsByNumber.has(number)) rowsByNumber.set(number, []);
  rowsByNumber.get(number).push(row);
}

const officialInput = (row) => row.street_address;
const nameInput = (row) =>
  `${row.street_number}${row.street_number_suffix ?? ""} ${row.street_name}`;
const partialTypeInput = (row) =>
  `${nameInput(row)} ${String(row.street_type).slice(0, -1)}`;
const longTypeInput = (row) => {
  const aliases = baseline.STREET_TYPES[normalized(row.street_type)] ?? [row.street_type];
  const longestAlias = aliases.toSorted((a, b) => b.length - a.length)[0];
  return `${nameInput(row)} ${longestAlias}${row.street_direction ? ` ${row.street_direction}` : ""}`;
};
const typedRows = rows.filter((row) => String(row.street_type ?? "").length >= 2);

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  groupedRows: rows.length,
  baseline: {
    officialAddress: audit(baseline, rowsByNumber, rows, officialInput),
    numberAndName: audit(baseline, rowsByNumber, rows, nameInput),
    partialType: audit(baseline, rowsByNumber, typedRows, partialTypeInput),
    longTypeAlias: audit(baseline, rowsByNumber, typedRows, longTypeInput),
  },
  experiment: {
    officialAddress: audit(experiment, rowsByNumber, rows, officialInput),
    numberAndName: audit(experiment, rowsByNumber, rows, nameInput),
    partialType: audit(experiment, rowsByNumber, typedRows, partialTypeInput),
    longTypeAlias: audit(experiment, rowsByNumber, typedRows, longTypeInput),
  },
}, null, 2));
