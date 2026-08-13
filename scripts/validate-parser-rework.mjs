import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const ENDPOINT = "https://data.winnipeg.ca/resource/cam2-ii3u.json";
const PAGE_SIZE = 50_000;
const baselineOption = process.argv.indexOf("--baseline");
if (baselineOption !== -1 && !process.argv[baselineOption + 1]) {
  throw new TypeError("--baseline requires a Git ref");
}
const BASELINE_REF =
  baselineOption === -1 ? "main" : process.argv[baselineOption + 1];
const EXPERIMENT_ONLY = process.argv.includes("--experiment-only");
const PROGRESSIVE_ONLY = process.argv.includes("--progressive-only");
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
  const source = execFileSync("git", ["show", `${BASELINE_REF}:address-data.js`], {
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

function displayedResults(module, matches, candidates, input) {
  if (typeof module.buildAddressResults === "function") {
    return module.buildAddressResults(matches, candidates, input);
  }
  const normalizedRows = module.normalizeRawAuthoritativeRows(matches);
  return module.dedupeAndSortNormalizedRows(normalizedRows, candidates);
}

function resultRank(results, target) {
  const targetAddress = normalized(target.street_address);
  return results.findIndex(
    (row) => normalized(row.displayAddress) === targetAddress,
  );
}

function audit(module, rowsByNumber, rows, inputForRow) {
  const outputHash = createHash("sha256");
  const retrievedResultCounts = [];
  const resultCounts = [];
  const targetRanks = [];
  const failures = [];
  let maxCandidates = 0;
  let maxQueryLength = 0;
  let broadest = null;
  let attempted = 0;

  for (const target of rows) {
    const generated = inputForRow(target);
    const inputs = Array.isArray(generated) ? generated : [generated];
    for (const input of inputs) {
      attempted += 1;
      const parsed = module.parseAddress(input);
      maxCandidates = Math.max(maxCandidates, parsed.candidates.length);
      if (!parsed.eligible) {
        if (failures.length < 10) {
          failures.push({ input, reason: "ineligible", target });
        }
        continue;
      }
      maxQueryLength = Math.max(
        maxQueryLength,
        module.buildQuery(parsed.candidates).length,
      );
      const cohort = rowsByNumber.get(Number(target.street_number)) ?? [];
      const matches = cohort.filter((row) =>
        parsed.candidates.some((candidate) => rowMatchesCandidate(row, candidate)),
      );
      const found = matches.some((row) => rowKey(row) === rowKey(target));
      if (!found) {
        if (failures.length < 10) {
          failures.push({ input, reason: "not recalled", target });
        }
        continue;
      }
      retrievedResultCounts.push(matches.length);
      const results = displayedResults(
        module,
        matches,
        parsed.candidates,
        input,
      );
      const rank = resultRank(results, target);
      outputHash.update(
        `${input}\u001e${results.map((row) => normalized(row.displayAddress)).join("\u001f")}\n`,
      );
      if (rank === -1) {
        if (failures.length < 10) {
          failures.push({ input, reason: "not displayed", target });
        }
        continue;
      }
      resultCounts.push(results.length);
      targetRanks.push(rank + 1);
      if (!broadest || results.length > broadest.displayedCount) {
        broadest = {
          input,
          retrievedCount: matches.length,
          displayedCount: results.length,
          targetRank: rank + 1,
        };
      }
    }
  }

  return {
    attempted,
    failed: attempted - resultCounts.length,
    failures,
    maxCandidates,
    maxQueryLength,
    retrievedResultCounts: summarize(retrievedResultCounts),
    resultCounts: summarize(resultCounts),
    targetRanks: summarize(targetRanks),
    broadest,
    outputFingerprint: outputHash.digest("hex"),
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
const partialDirectionInput = (row) =>
  `${nameInput(row)} ${row.street_type} ${String(row.street_direction).slice(0, -1)}`;
const directionWithoutTypeInput = (row) =>
  `${nameInput(row)} ${row.street_direction}`;
const compactSuffixInput = (row) =>
  `${row.street_number}${row.street_number_suffix} ${row.street_name}`;
const spacedSuffixInput = (row) =>
  `${row.street_number} ${row.street_number_suffix} ${row.street_name}`;
const splitFractionalSuffixInput = (row) => {
  const suffix = String(row.street_number_suffix);
  return suffix.startsWith("1/2") && suffix.length > 3
    ? `${row.street_number} 1/2 ${suffix.slice(3)} ${row.street_name}`
    : spacedSuffixInput(row);
};
const omittedSuffixInput = (row) =>
  `${row.street_number} ${row.street_name}`;
const progressiveNameInputs = (row) => {
  const inputs = new Set();
  const name = String(row.street_name ?? "");
  for (let length = 1; length <= name.length; length += 1) {
    const prefix = name.slice(0, length).trimEnd();
    if ((prefix.match(/[\p{L}\p{N}]/gu) ?? []).length >= 3) {
      inputs.add(`${row.street_number}${row.street_number_suffix ?? ""} ${prefix}`);
    }
  }
  return [...inputs];
};
const longTypeInput = (row) => {
  const aliases = baseline.STREET_TYPES[normalized(row.street_type)] ?? [row.street_type];
  const longestAlias = aliases.toSorted((a, b) => b.length - a.length)[0];
  return `${nameInput(row)} ${longestAlias}${row.street_direction ? ` ${row.street_direction}` : ""}`;
};
const typedRows = rows.filter((row) => String(row.street_type ?? "").length >= 2);
const multiCharacterDirectionRows = rows.filter(
  (row) => String(row.street_direction ?? "").length >= 2,
);
const directionalRows = rows.filter((row) => row.street_direction);
const suffixRows = rows.filter((row) => row.street_number_suffix);

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  baselineRef: BASELINE_REF,
  groupedRows: rows.length,
  baseline: EXPERIMENT_ONLY ? undefined : {
    officialAddress: audit(baseline, rowsByNumber, rows, officialInput),
    numberAndName: audit(baseline, rowsByNumber, rows, nameInput),
    partialType: audit(baseline, rowsByNumber, typedRows, partialTypeInput),
    partialDirection: audit(
      baseline,
      rowsByNumber,
      multiCharacterDirectionRows,
      partialDirectionInput,
    ),
    directionWithoutType: audit(
      baseline,
      rowsByNumber,
      directionalRows,
      directionWithoutTypeInput,
    ),
    longTypeAlias: audit(baseline, rowsByNumber, typedRows, longTypeInput),
    compactSuffix: audit(baseline, rowsByNumber, suffixRows, compactSuffixInput),
    spacedSuffix: audit(baseline, rowsByNumber, suffixRows, spacedSuffixInput),
    splitFractionalSuffix: audit(
      baseline,
      rowsByNumber,
      suffixRows,
      splitFractionalSuffixInput,
    ),
    omittedSuffix: audit(baseline, rowsByNumber, suffixRows, omittedSuffixInput),
  },
  experiment: PROGRESSIVE_ONLY ? {
    progressiveNamePrefix: audit(
      experiment,
      rowsByNumber,
      rows,
      progressiveNameInputs,
    ),
  } : {
    officialAddress: audit(experiment, rowsByNumber, rows, officialInput),
    numberAndName: audit(experiment, rowsByNumber, rows, nameInput),
    partialType: audit(experiment, rowsByNumber, typedRows, partialTypeInput),
    partialDirection: audit(
      experiment,
      rowsByNumber,
      multiCharacterDirectionRows,
      partialDirectionInput,
    ),
    directionWithoutType: audit(
      experiment,
      rowsByNumber,
      directionalRows,
      directionWithoutTypeInput,
    ),
    longTypeAlias: audit(experiment, rowsByNumber, typedRows, longTypeInput),
    compactSuffix: audit(experiment, rowsByNumber, suffixRows, compactSuffixInput),
    spacedSuffix: audit(experiment, rowsByNumber, suffixRows, spacedSuffixInput),
    splitFractionalSuffix: audit(
      experiment,
      rowsByNumber,
      suffixRows,
      splitFractionalSuffixInput,
    ),
    omittedSuffix: audit(experiment, rowsByNumber, suffixRows, omittedSuffixInput),
  },
}, null, 2));
