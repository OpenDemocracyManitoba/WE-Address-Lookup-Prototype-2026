import * as addressData from "../address-data.js";

const ENDPOINT = "https://data.winnipeg.ca/resource/cam2-ii3u.json";
const PAGE_SIZE = 50_000;
const PROGRESSIVE = process.argv.includes("--progressive");
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

// These are audit inputs, not parser vocabulary. Each expansion should exercise
// the same trailing-token behavior as the abbreviated City street type.
const LONG_STREET_TYPE_ALIASES = Object.freeze({
  AVE: "AVENUE",
  BLVD: "BOULEVARD",
  CIR: "CIRCLE",
  CRES: "CRESCENT",
  CRT: "COURT",
  DR: "DRIVE",
  FWY: "FREEWAY",
  GDN: "GARDEN",
  GDNS: "GARDENS",
  HWY: "HIGHWAY",
  PK: "PARK",
  PKY: "PARKWAY",
  PL: "PLACE",
  PROM: "PROMENADE",
  PT: "POINTE",
  RD: "ROAD",
  SQ: "SQUARES",
  ST: "STREET",
  TERR: "TERRASSE",
  WALK: "WALKWAY",
});

const options = process.argv.slice(2);
if (options.some((option) => option !== "--progressive")) {
  throw new TypeError("Usage: node scripts/audit-live-addresses.mjs [--progressive]");
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
    if (!response.ok) {
      throw new Error(`City request failed with HTTP ${response.status}`);
    }
    const page = await response.json();
    if (!Array.isArray(page)) {
      throw new TypeError("City response was not an array");
    }
    rows.push(...page);
    process.stderr.write(`Fetched ${rows.length} grouped civic rows\n`);
    if (page.length < PAGE_SIZE) return rows;
  }
}

function normalized(value) {
  return String(value ?? "").trim().toUpperCase();
}

function rowMatchesAddressInterpretation(row, addressInterpretation) {
  return (
    Number(row.street_number) === addressInterpretation.streetNumber &&
    normalized(row.street_name).startsWith(
      addressInterpretation.streetName,
    ) &&
    (!addressInterpretation.streetNumberSuffix ||
      normalized(row.street_number_suffix) ===
        addressInterpretation.streetNumberSuffix)
  );
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

function resultRank(results, target) {
  const targetAddress = normalized(target.street_address);
  return results.findIndex(
    (row) => normalized(row.displayAddress) === targetAddress,
  );
}

function audit(rowsByNumber, rows, inputForRow) {
  const retrievedResultCounts = [];
  const displayedResultCounts = [];
  const targetRanks = [];
  const failureCounts = {
    "not lookup ready": 0,
    "not recalled": 0,
    "not displayed": 0,
  };
  const failureExamples = [];
  let maxAddressInterpretations = 0;
  let maxQueryLength = 0;
  let broadest = null;
  let attempted = 0;
  let recalled = 0;
  let displayed = 0;

  function recordFailure(input, reason, target) {
    failureCounts[reason] += 1;
    if (failureExamples.length < 10) {
      failureExamples.push({ input, reason, target: target.street_address });
    }
  }

  for (const target of rows) {
    const generated = inputForRow(target);
    const inputs = Array.isArray(generated) ? generated : [generated];
    for (const input of inputs) {
      attempted += 1;
      const parsed = addressData.parseAddress(input);
      maxAddressInterpretations = Math.max(
        maxAddressInterpretations,
        parsed.addressInterpretations.length,
      );
      if (!parsed.lookupReady) {
        recordFailure(input, "not lookup ready", target);
        continue;
      }

      maxQueryLength = Math.max(
        maxQueryLength,
        addressData.buildQuery(parsed.addressInterpretations).length,
      );
      const cohort = rowsByNumber.get(Number(target.street_number)) ?? [];
      const matches = cohort.filter((row) =>
        parsed.addressInterpretations.some((addressInterpretation) =>
          rowMatchesAddressInterpretation(row, addressInterpretation),
        ),
      );
      if (!matches.some((row) => rowKey(row) === rowKey(target))) {
        recordFailure(input, "not recalled", target);
        continue;
      }

      recalled += 1;
      retrievedResultCounts.push(matches.length);
      const results = addressData.buildAddressResults(
        matches,
        parsed.addressInterpretations,
        parsed.normalizedInput,
      );
      const rank = resultRank(results, target);
      if (rank === -1) {
        recordFailure(input, "not displayed", target);
        continue;
      }

      displayed += 1;
      displayedResultCounts.push(results.length);
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
    recalled,
    displayed,
    failed: attempted - displayed,
    failureCounts,
    failureExamples,
    maxAddressInterpretations,
    maxQueryLength,
    retrievedResultCounts: summarize(retrievedResultCounts),
    displayedResultCounts: summarize(displayedResultCounts),
    targetRanks: summarize(targetRanks),
    broadest,
  };
}

function numberAndName(row) {
  return `${row.street_number}${row.street_number_suffix ?? ""} ${row.street_name}`;
}

function progressiveNameInputs(row) {
  const inputs = new Set();
  const name = String(row.street_name ?? "");
  for (let length = 1; length <= name.length; length += 1) {
    const prefix = name.slice(0, length).trimEnd();
    if ((prefix.match(/[\p{L}\p{N}]/gu) ?? []).length >= 3) {
      inputs.add(
        `${row.street_number}${row.street_number_suffix ?? ""} ${prefix}`,
      );
    }
  }
  return [...inputs];
}

const rows = await fetchRows();
const rowsByNumber = new Map();
for (const row of rows) {
  const number = Number(row.street_number);
  if (!rowsByNumber.has(number)) rowsByNumber.set(number, []);
  rowsByNumber.get(number).push(row);
}

let corpora;
if (PROGRESSIVE) {
  corpora = {
    progressiveNamePrefix: audit(rowsByNumber, rows, progressiveNameInputs),
  };
} else {
  const typedRows = rows.filter(
    (row) => String(row.street_type ?? "").length >= 2,
  );
  const multiCharacterDirectionRows = rows.filter(
    (row) => String(row.street_direction ?? "").length >= 2,
  );
  const directionalRows = rows.filter((row) => row.street_direction);
  const suffixRows = rows.filter((row) => row.street_number_suffix);
  const splitFractionalSuffixRows = suffixRows.filter((row) =>
    /^1\/2[A-N]$/u.test(String(row.street_number_suffix)),
  );

  corpora = {
    officialAddress: audit(rowsByNumber, rows, (row) => row.street_address),
    numberAndName: audit(rowsByNumber, rows, numberAndName),
    partialType: audit(
      rowsByNumber,
      typedRows,
      (row) => `${numberAndName(row)} ${String(row.street_type).slice(0, -1)}`,
    ),
    partialDirection: audit(
      rowsByNumber,
      multiCharacterDirectionRows,
      (row) =>
        `${numberAndName(row)} ${row.street_type} ${String(row.street_direction).slice(0, -1)}`,
    ),
    directionWithoutType: audit(
      rowsByNumber,
      directionalRows,
      (row) => `${numberAndName(row)} ${row.street_direction}`,
    ),
    longTypeAlias: audit(
      rowsByNumber,
      typedRows,
      (row) => {
        const type = normalized(row.street_type);
        const alias = LONG_STREET_TYPE_ALIASES[type] ?? row.street_type;
        const direction = row.street_direction
          ? ` ${row.street_direction}`
          : "";
        return `${numberAndName(row)} ${alias}${direction}`;
      },
    ),
    compactSuffix: audit(
      rowsByNumber,
      suffixRows,
      (row) =>
        `${row.street_number}${row.street_number_suffix} ${row.street_name}`,
    ),
    spacedSuffix: audit(
      rowsByNumber,
      suffixRows,
      (row) =>
        `${row.street_number} ${row.street_number_suffix} ${row.street_name}`,
    ),
    splitFractionalSuffix: audit(
      rowsByNumber,
      splitFractionalSuffixRows,
      (row) => {
        const suffix = String(row.street_number_suffix);
        return `${row.street_number} 1/2 ${suffix.slice(3)} ${row.street_name}`;
      },
    ),
  };
}

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      mode: PROGRESSIVE ? "progressive" : "standard",
      groupedRows: rows.length,
      corpora,
    },
    null,
    2,
  ),
);

if (Object.values(corpora).some((result) => result.failed > 0)) {
  process.exitCode = 1;
}
