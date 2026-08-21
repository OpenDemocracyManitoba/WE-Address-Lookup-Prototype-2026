const API_ENDPOINT = "https://data.winnipeg.ca/resource/cam2-ii3u.json";
const RESULT_FIELDS = Object.freeze([
  "street_address",
  "street_number",
  "street_number_suffix",
  "street_name",
  "street_type",
  "street_direction",
  "school_division",
  "school_division_ward",
  "ward_as_of_september_17",
]);

const SUFFIXES = new Set(["1/2", "1/2A", ..."ABCDEFGHIJKLMN"]);
const MAX_TRAILING_TOKEN_DROPS = 2;
function alphanumericCount(value) {
  return (value.match(/[\p{L}\p{N}]/gu) || []).length;
}

export function normalizeInput(value) {
  return String(value ?? "")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/[^\p{L}\p{N}\s.'\-/]/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("en-CA");
}

function normalizeSuffix(value) {
  const suffix = String(value ?? "").toUpperCase();
  return SUFFIXES.has(suffix) ? suffix : null;
}

function generateTailInterpretations(streetNumber, suffix, tail) {
  const tokens = tail.split(" ");
  const addressInterpretations = [];
  for (
    let dropped = 0;
    dropped <= MAX_TRAILING_TOKEN_DROPS && dropped < tokens.length;
    dropped += 1
  ) {
    const streetName = tokens.slice(0, tokens.length - dropped).join(" ");
    if (alphanumericCount(streetName) >= 3) {
      addressInterpretations.push(Object.freeze({
        streetNumber,
        streetNumberSuffix: suffix,
        streetName,
        trailingTokenDrops: dropped,
      }));
    }
  }
  return Object.freeze(addressInterpretations);
}

export function parseAddress(value) {
  const normalizedInput = normalizeInput(value);
  const numberMatch = normalizedInput.match(
    /^(\d+)(1\/2[A-N]?|[A-N])(?:\s+|$)(.*)$/u,
  );
  let streetNumber;
  let tail;
  const readings = [];

  if (numberMatch) {
    streetNumber = Number(numberMatch[1]);
    const suffix = normalizeSuffix(numberMatch[2]);
    tail = numberMatch[3];
    if (suffix && tail) readings.push({ suffix, tail });
  } else {
    const plainMatch = normalizedInput.match(/^(\d+)(?:\s+(.*))?$/u);
    if (!plainMatch)
      return {
        normalizedInput,
        streetNumber: null,
        addressInterpretations: [],
        lookupReady: false,
      };
    streetNumber = Number(plainMatch[1]);
    tail = plainMatch[2] ?? "";
    if (tail) {
      const tokens = tail.split(" ");
      const twoTokenSuffix =
        tokens.length > 2 ? normalizeSuffix(`${tokens[0]}${tokens[1]}`) : null;
      const oneTokenSuffix = normalizeSuffix(tokens[0]);
      if (twoTokenSuffix && tokens.slice(2).length) {
        readings.push({
          suffix: twoTokenSuffix,
          tail: tokens.slice(2).join(" "),
        });
      } else if (oneTokenSuffix && tokens.slice(1).length) {
        readings.push({
          suffix: oneTokenSuffix,
          tail: tokens.slice(1).join(" "),
        });
      }
      readings.push({
        suffix: null,
        tail,
      });
    }
  }

  if (!Number.isSafeInteger(streetNumber)) {
    return {
      normalizedInput,
      streetNumber: null,
      addressInterpretations: [],
      lookupReady: false,
    };
  }

  const addressInterpretations = Object.freeze(
    readings.flatMap((reading) =>
      generateTailInterpretations(
        streetNumber,
        reading.suffix,
        reading.tail,
      ),
    ),
  );
  return {
    normalizedInput,
    streetNumber,
    addressInterpretations,
    lookupReady: addressInterpretations.length > 0,
  };
}

export function escapeSoqlLiteral(value) {
  return String(value).replace(/'/g, "''");
}

function queryAlternativePredicate(queryAlternative) {
  const predicates = [
    `upper(street_name) like '${escapeSoqlLiteral(queryAlternative.streetName)}%'`,
  ];
  if (queryAlternative.streetNumberSuffix) {
    predicates.push(
      `upper(street_number_suffix) = '${escapeSoqlLiteral(queryAlternative.streetNumberSuffix)}'`,
    );
  }
  return `(${predicates.join(" AND ")})`;
}

function selectQueryAlternatives(addressInterpretations) {
  const shortestBySuffix = new Map();
  for (const addressInterpretation of addressInterpretations) {
    const suffixKey = addressInterpretation.streetNumberSuffix ?? "";
    const current = shortestBySuffix.get(suffixKey);
    if (
      !current ||
      addressInterpretation.streetName.length < current.streetName.length
    ) {
      shortestBySuffix.set(suffixKey, addressInterpretation);
    }
  }
  return [...shortestBySuffix.values()];
}

export function buildQuery(addressInterpretations, endpoint = API_ENDPOINT) {
  if (
    !Array.isArray(addressInterpretations) ||
    addressInterpretations.length === 0
  ) {
    throw new TypeError("At least one address interpretation is required.");
  }
  const streetNumber = addressInterpretations[0].streetNumber;
  if (
    !Number.isSafeInteger(streetNumber) ||
    streetNumber < 0 ||
    addressInterpretations.some((item) => item.streetNumber !== streetNumber)
  ) {
    throw new TypeError(
      "Address interpretations must share one numeric civic number.",
    );
  }
  const queryAlternatives = selectQueryAlternatives(addressInterpretations);
  const where = `street_number = ${streetNumber} AND (${queryAlternatives.map(queryAlternativePredicate).join(" OR ")})`;
  const params = new URLSearchParams();
  params.set(
    "$select",
    `street_address as display_address,${RESULT_FIELDS.slice(1).join(",")}`,
  );
  params.set("$where", where);
  params.set("$group", RESULT_FIELDS.join(","));
  params.set(
    "$order",
    RESULT_FIELDS.slice(1).concat("street_address").join(","),
  );
  return `${endpoint}?${params.toString()}`;
}

function cleanApiString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeStreetNumber(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string" || !/^\d+$/u.test(value)) return null;
  const streetNumber = Number(value);
  return Number.isSafeInteger(streetNumber) ? streetNumber : null;
}

export function normalizeAuthoritativeRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const displayAddress = cleanApiString(
    row.display_address ?? row.street_address,
  );
  const streetNumberValue = normalizeStreetNumber(row.street_number);
  if (!displayAddress || streetNumberValue === null) return null;
  return {
    displayAddress,
    streetNumber: streetNumberValue,
    streetNumberSuffix: cleanApiString(row.street_number_suffix),
    streetName: cleanApiString(row.street_name),
    streetType: cleanApiString(row.street_type),
    streetDirection: cleanApiString(row.street_direction),
    schoolDivision: cleanApiString(row.school_division),
    schoolDivisionWard: cleanApiString(row.school_division_ward),
    councilWard: cleanApiString(row.ward_as_of_september_17),
  };
}

function rowMatchesAddressInterpretation(row, addressInterpretation) {
  return (
    row.streetNumber === addressInterpretation.streetNumber &&
    String(row.streetName ?? "")
      .toUpperCase()
      .startsWith(addressInterpretation.streetName) &&
    (!addressInterpretation.streetNumberSuffix ||
      row.streetNumberSuffix?.toUpperCase() ===
        addressInterpretation.streetNumberSuffix)
  );
}

function addressInterpretationMatchRank(row, addressInterpretations) {
  const rank = addressInterpretations.findIndex((addressInterpretation) =>
    rowMatchesAddressInterpretation(row, addressInterpretation),
  );
  return rank === -1 ? Number.MAX_SAFE_INTEGER : rank;
}

function addressInterpretationMatchTier(row, addressInterpretations) {
  const tiers = addressInterpretations
    .filter((addressInterpretation) =>
      rowMatchesAddressInterpretation(row, addressInterpretation),
    )
    .map(
      (addressInterpretation) =>
        addressInterpretation.trailingTokenDrops ?? 0,
    );
  return tiers.length ? Math.min(...tiers) : Number.MAX_SAFE_INTEGER;
}

function comparableAddress(value) {
  return normalizeInput(value).replace(
    /^(\d+)\s+(1\/2[A-N]?|[A-N])\s+/u,
    "$1$2 ",
  );
}

function authoritativeInputVariants(row) {
  const suffix = row.streetNumberSuffix ?? "";
  const numbers = suffix
    ? [`${row.streetNumber}${suffix}`, `${row.streetNumber}`]
    : [`${row.streetNumber}`];
  const name = row.streetName ?? "";
  const type = row.streetType ?? "";
  const direction = row.streetDirection ?? "";
  return numbers.flatMap((number) => [
    comparableAddress(`${number} ${name} ${type} ${direction}`),
    comparableAddress(`${number} ${name} ${direction}`),
  ]);
}

const NORMALIZED_ROW_SORT_KEYS = Object.freeze([
  "streetNumber",
  "streetNumberSuffix",
  "streetName",
  "streetType",
  "streetDirection",
  "displayAddress",
  "councilWard",
  "schoolDivision",
  "schoolDivisionWard",
]);
const NORMALIZED_ROW_COLLATOR = new Intl.Collator("en-CA", {
  numeric: true,
  sensitivity: "base",
});

function sortNormalizedRows(rows, addressInterpretations) {
  return [...rows].sort((a, b) => {
    const tierDifference =
      addressInterpretationMatchTier(a, addressInterpretations) -
      addressInterpretationMatchTier(b, addressInterpretations);
    if (tierDifference) return tierDifference;
    const rankDifference =
      addressInterpretationMatchRank(a, addressInterpretations) -
      addressInterpretationMatchRank(b, addressInterpretations);
    if (rankDifference) return rankDifference;
    for (const key of NORMALIZED_ROW_SORT_KEYS) {
      const difference = NORMALIZED_ROW_COLLATOR.compare(
        String(a[key] ?? ""),
        String(b[key] ?? ""),
      );
      if (difference) return difference;
    }
    return 0;
  });
}

export function buildAddressResults(
  rawRows,
  addressInterpretations,
  normalizedInput,
) {
  const sorted = sortNormalizedRows(
    rawRows.map(normalizeAuthoritativeRow).filter(Boolean),
    addressInterpretations,
  );
  const exactInput = comparableAddress(normalizedInput);
  const exact = exactInput
    ? sorted.filter((row) => comparableAddress(row.displayAddress) === exactInput)
    : [];
  const completions = exactInput
    ? sorted.filter((row) =>
        authoritativeInputVariants(row).some((variant) =>
          variant.startsWith(exactInput),
        ),
      )
    : [];
  const strongestTier = sorted.reduce(
    (tier, row) => Math.min(
      tier,
      addressInterpretationMatchTier(row, addressInterpretations),
    ),
    Number.MAX_SAFE_INTEGER,
  );
  const strongest = exact.length
    ? exact
    : completions.length
      ? completions
      : sorted.filter(
          (row) =>
            addressInterpretationMatchTier(row, addressInterpretations) ===
            strongestTier,
        );

  const uniqueAddresses = new Map();
  for (const row of strongest) {
    const key = normalizeInput(row.displayAddress);
    if (!uniqueAddresses.has(key)) uniqueAddresses.set(key, row);
  }
  return Object.freeze([...uniqueAddresses.values()]);
}

export function formatTrusteeWard(value) {
  const cleaned = cleanApiString(value);
  if (!cleaned) return "Not available";
  return /^\d+$/.test(cleaned) ? `Ward ${cleaned}` : cleaned;
}

export function formatCouncilWard(value) {
  return cleanApiString(value) ?? "Not available";
}

export function formatSchoolTrustee(division, ward) {
  const divisionLabel = cleanApiString(division) ?? "Not available";
  const wardLabel = formatTrusteeWard(ward);
  return `${divisionLabel} — ${wardLabel}`;
}

export {
  API_ENDPOINT,
};
