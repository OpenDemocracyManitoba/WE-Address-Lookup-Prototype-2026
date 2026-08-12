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

const STREET_TYPES = Object.freeze({
  ALLEY: ["ALLEY"],
  AVE: ["AVE", "AVENUE"],
  BAY: ["BAY"],
  BEND: ["BEND"],
  BLVD: ["BLVD", "BOULEVARD"],
  CIR: ["CIR", "CIRCLE"],
  CLOSE: ["CLOSE"],
  COMMON: ["COMMON"],
  COVE: ["COVE"],
  CRES: ["CRES", "CRESCENT"],
  CROSS: ["CROSS"],
  CRT: ["CRT", "COURT"],
  DR: ["DR", "DRIVE"],
  FWY: ["FWY", "FREEWAY"],
  GATE: ["GATE"],
  GDN: ["GDN", "GARDEN"],
  GDNS: ["GDNS", "GARDENS"],
  GROVE: ["GROVE"],
  HWY: ["HWY", "HIGHWAY"],
  KEY: ["KEY"],
  LANE: ["LANE"],
  MEWS: ["MEWS"],
  PATH: ["PATH"],
  PK: ["PK", "PARK", "PARC"],
  PKY: ["PKY", "PARKWAY"],
  PL: ["PL", "PLACE"],
  PROM: ["PROM", "PROMENADE"],
  PT: ["PT", "POINT", "POINTE"],
  RD: ["RD", "ROAD"],
  RIDGE: ["RIDGE"],
  ROW: ["ROW"],
  RUN: ["RUN"],
  SQ: ["SQ", "SQUARE", "SQUARES"],
  ST: ["ST", "STREET"],
  TERR: ["TERR", "TERRACE", "TERRASSE"],
  TRAIL: ["TRAIL"],
  WALK: ["WALK", "WALKWAY"],
  WAY: ["WAY"],
});

const TYPE_LOOKUP = new Map(
  Object.entries(STREET_TYPES).flatMap(([cityValue, aliases]) =>
    aliases.map((alias) => [alias, cityValue]),
  ),
);
const DIRECTIONS = new Set(["N", "S", "E", "W", "NW", "SW"]);
const SUFFIXES = new Set(["1/2", "1/2A", ..."ABCDEFGHIJKLMN"]);
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

export function normalizeStreetType(token) {
  const cleaned = String(token ?? "")
    .replace(/\.+$/g, "")
    .toUpperCase();
  return TYPE_LOOKUP.get(cleaned) ?? null;
}

function normalizeSuffix(value) {
  const compact = String(value ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
  return SUFFIXES.has(compact) ? compact : null;
}

function makeCandidate(
  streetNumber,
  suffix,
  nameTokens,
  { streetType = null, streetDirection = null, preference = 0 } = {},
) {
  const streetName = nameTokens.join(" ");
  if (alphanumericCount(streetName) < 3) return null;
  return Object.freeze({
    streetNumber,
    streetNumberSuffix: suffix,
    streetName,
    streetType,
    streetDirection,
    preference,
  });
}

function interpretedTail(tokens) {
  const finalDirection = DIRECTIONS.has(tokens.at(-1)) ? tokens.at(-1) : null;
  const finalType = normalizeStreetType(tokens.at(-1));
  const typeBeforeDirection = finalDirection
    ? normalizeStreetType(tokens.at(-2))
    : null;

  if (finalDirection && typeBeforeDirection) {
    return {
      nameTokens: tokens.slice(0, -2),
      streetType: typeBeforeDirection,
      streetDirection: finalDirection,
      preferInterpretation: true,
    };
  }
  if (finalType) {
    return {
      nameTokens: tokens.slice(0, -1),
      streetType: finalType,
      streetDirection: null,
      preferInterpretation: true,
    };
  }
  if (finalDirection) {
    return {
      nameTokens: tokens.slice(0, -1),
      streetType: null,
      streetDirection: finalDirection,
      preferInterpretation: false,
    };
  }
  return null;
}

function generateTailCandidates(
  streetNumber,
  suffix,
  tail,
  preferenceBase = 0,
) {
  const tokens = Object.freeze(tail.split(" ").filter(Boolean));
  if (!tokens.length) return Object.freeze([]);

  const interpretation = interpretedTail(tokens);
  const interpretedTailIsPreferred =
    interpretation?.preferInterpretation === true;
  const interpreted = interpretation
    ? makeCandidate(streetNumber, suffix, interpretation.nameTokens, {
        streetType: interpretation.streetType,
        streetDirection: interpretation.streetDirection,
        preference: preferenceBase + (interpretedTailIsPreferred ? 0 : 1),
      })
    : null;
  const literalPreferenceOffset =
    interpretedTailIsPreferred && interpreted ? 1 : 0;
  const literal = makeCandidate(streetNumber, suffix, tokens, {
    preference: preferenceBase + literalPreferenceOffset,
  });
  const unique = new Map();
  for (const candidate of [literal, interpreted]) {
    if (candidate) unique.set(candidateKey(candidate), candidate);
  }
  return Object.freeze([...unique.values()]);
}

function candidateKey(candidate) {
  return [
    candidate.streetNumber,
    candidate.streetNumberSuffix,
    candidate.streetName,
    candidate.streetType,
    candidate.streetDirection,
  ]
    .map((value) => value ?? "")
    .join("\u001f");
}

const LITERAL_CIVIC_NUMBER_READING_FALLBACK_PREFERENCE = 10;

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
    if (suffix && tail) readings.push({ suffix, tail, preference: 0 });
  } else {
    const plainMatch = normalizedInput.match(/^(\d+)(?:\s+(.*))?$/u);
    if (!plainMatch)
      return {
        normalizedInput,
        streetNumber: null,
        candidates: [],
        eligible: false,
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
          preference: 0,
        });
      } else if (oneTokenSuffix && tokens.slice(1).length) {
        readings.push({
          suffix: oneTokenSuffix,
          tail: tokens.slice(1).join(" "),
          preference: 0,
        });
      }
      const hasSuffixReading = readings.length > 0;
      readings.push({
        suffix: null,
        tail,
        preference: hasSuffixReading
          ? LITERAL_CIVIC_NUMBER_READING_FALLBACK_PREFERENCE
          : 0,
      });
    }
  }

  if (!Number.isSafeInteger(streetNumber)) {
    return {
      normalizedInput,
      streetNumber: null,
      candidates: [],
      eligible: false,
    };
  }

  const unique = new Map();
  for (const reading of readings) {
    for (const candidate of generateTailCandidates(
      streetNumber,
      reading.suffix,
      reading.tail,
      reading.preference,
    )) {
      const key = candidateKey(candidate);
      const existing = unique.get(key);
      if (!existing || candidate.preference < existing.preference)
        unique.set(key, candidate);
    }
  }
  const candidates = Object.freeze(
    [...unique.values()].sort((a, b) => a.preference - b.preference),
  );
  return {
    normalizedInput,
    streetNumber,
    candidates,
    eligible: candidates.length > 0,
  };
}

export function isSearchEligible(value) {
  return parseAddress(value).eligible;
}

export function escapeSoqlLiteral(value) {
  return String(value).replace(/'/g, "''");
}

function candidatePredicate(candidate) {
  const predicates = [
    `upper(street_name) like '${escapeSoqlLiteral(candidate.streetName)}%'`,
  ];
  if (candidate.streetNumberSuffix) {
    predicates.push(
      `upper(street_number_suffix) = '${escapeSoqlLiteral(candidate.streetNumberSuffix)}'`,
    );
  }
  if (candidate.streetType) {
    predicates.push(
      `upper(street_type) = '${escapeSoqlLiteral(candidate.streetType)}'`,
    );
  }
  if (candidate.streetDirection) {
    predicates.push(
      `upper(street_direction) = '${escapeSoqlLiteral(candidate.streetDirection)}'`,
    );
  }
  return `(${predicates.join(" AND ")})`;
}

export function buildQuery(candidates, endpoint = API_ENDPOINT) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new TypeError("At least one parsed candidate is required.");
  }
  const streetNumber = candidates[0].streetNumber;
  if (
    !Number.isSafeInteger(streetNumber) ||
    streetNumber < 0 ||
    candidates.some((item) => item.streetNumber !== streetNumber)
  ) {
    throw new TypeError("Candidates must share one numeric civic number.");
  }
  const alternatives = [
    ...new Map(candidates.map((item) => [candidateKey(item), item])).values(),
  ];
  const where = `street_number = ${streetNumber} AND (${alternatives.map(candidatePredicate).join(" OR ")})`;
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

export function normalizeAuthoritativeRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const displayAddress = cleanApiString(
    row.display_address ?? row.street_address,
  );
  const streetNumberValue =
    typeof row.street_number === "number"
      ? row.street_number
      : Number(row.street_number);
  if (!displayAddress || !Number.isFinite(streetNumberValue)) return null;
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

function rowKey(row) {
  return [
    row.displayAddress,
    row.streetNumber,
    row.streetNumberSuffix,
    row.streetName,
    row.streetType,
    row.streetDirection,
    row.schoolDivision,
    row.schoolDivisionWard,
    row.councilWard,
  ]
    .map((value) => value ?? "")
    .join("\u001f");
}

function candidateMatchRank(row, candidates) {
  let best = Number.MAX_SAFE_INTEGER;
  for (const candidate of candidates ?? []) {
    if (row.streetNumber !== candidate.streetNumber) continue;
    if (
      !String(row.streetName ?? "")
        .toUpperCase()
        .startsWith(candidate.streetName)
    )
      continue;
    if (
      candidate.streetNumberSuffix &&
      row.streetNumberSuffix?.toUpperCase() !== candidate.streetNumberSuffix
    )
      continue;
    if (
      candidate.streetType &&
      row.streetType?.toUpperCase() !== candidate.streetType
    )
      continue;
    if (
      candidate.streetDirection &&
      row.streetDirection?.toUpperCase() !== candidate.streetDirection
    )
      continue;
    best = Math.min(best, candidate.preference);
  }
  return best;
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

function dedupeAndSortNormalizedRows(rows, candidates) {
  const unique = new Map();
  for (const row of rows) unique.set(rowKey(row), row);
  return [...unique.values()].sort((a, b) => {
    const rankDifference =
      candidateMatchRank(a, candidates) - candidateMatchRank(b, candidates);
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

export function dedupeAndSortRows(rows, candidates = []) {
  const normalizedRows = [];
  for (const row of rows ?? []) {
    const normalized = row?.displayAddress
      ? row
      : normalizeAuthoritativeRow(row);
    if (normalized) normalizedRows.push(normalized);
  }
  return dedupeAndSortNormalizedRows(normalizedRows, candidates);
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
  RESULT_FIELDS,
  STREET_TYPES,
  DIRECTIONS,
  SUFFIXES,
};
