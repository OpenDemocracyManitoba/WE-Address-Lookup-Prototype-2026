"use strict";

const AddressSearch = (() => {
  const API_URL = "https://data.winnipeg.ca/resource/cam2-ii3u.json";
  const RESULT_LIMIT = 25;
  const MIN_STREET_NAME_LENGTH = 3;

  // `street_address` is the City's official civic address without apartment or
  // condo units. Alias it so the UI can consistently use `display_address`.
  const SELECT_FIELDS = [
    "street_address as display_address",
    "street_number",
    "street_number_suffix",
    "street_name",
    "street_type",
    "street_direction",
    "school_division",
    "school_division_ward",
    "ward_as_of_september_17"
  ].join(",");

  const GROUP_FIELDS = [
    "street_address",
    "street_number",
    "street_number_suffix",
    "street_name",
    "street_type",
    "street_direction",
    "school_division",
    "school_division_ward",
    "ward_as_of_september_17"
  ].join(",");

  const streetTypes = {
    AVE: ["ave", "avenue"],
    BAY: ["bay"],
    BLVD: ["blvd", "boulevard"],
    CIR: ["cir", "circle"],
    CLOSE: ["close"],
    COMMON: ["common"],
    COVE: ["cove"],
    CRES: ["cres", "crescent"],
    CROSS: ["cross"],
    CRT: ["crt", "court"],
    DR: ["dr", "drive"],
    FWY: ["fwy", "freeway"],
    GATE: ["gate"],
    GDN: ["gdn", "garden"],
    GDNS: ["gdns", "gardens"],
    GROVE: ["grove"],
    HWY: ["hwy", "highway"],
    KEY: ["key"],
    LANE: ["lane"],
    MEWS: ["mews"],
    PATH: ["path"],
    PK: ["pk", "park", "parc"],
    PKY: ["pky", "parkway"],
    PL: ["pl", "place"],
    PROM: ["prom", "promenade"],
    PT: ["pt", "point", "pointe"],
    RD: ["rd", "road"],
    RIDGE: ["ridge"],
    ROW: ["row"],
    RUN: ["run"],
    SQ: ["sq", "square", "squares"],
    ST: ["st", "street"],
    TERR: ["terr", "terrace", "terrasse"],
    TRAIL: ["trail"],
    WALK: ["walk", "walkway"],
    WAY: ["way"]
  };

  const streetTypeAliases = Object.entries(streetTypes).reduce((aliases, [abbreviation, names]) => {
    for (const name of names) {
      aliases[name.toUpperCase()] = abbreviation;
    }
    return aliases;
  }, {});

  const directions = new Set(["N", "S", "E", "W"]);

  function normalizeInput(value) {
    return value
      .normalize("NFKD")
      .replace(/[’‘]/g, "'")
      .replace(/[–—]/g, "-")
      .toUpperCase()
      .replace(/[^A-Z0-9/' -]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseAddress(value) {
    const normalized = normalizeInput(value);
    const numberMatch = normalized.match(/^(\d+)(.*)$/);

    if (!numberMatch) {
      return null;
    }

    const streetNumber = numberMatch[1];
    const remainder = numberMatch[2];
    let streetNumberSuffix = "";
    let streetText = "";

    // Letter suffixes may touch the civic number or be a separate token.
    // Fractional suffixes may also include a trailing letter, with or without
    // a space before it (for example, 3 1/2A or 3 1/2 A).
    const compactSuffixMatch = remainder.match(/^(1\/2[A-Z]?|[A-Z])\s+(.+)$/);
    const spacedSuffixMatch = remainder.match(/^\s+(1\/2(?:\s*[A-Z])?|[A-Z])\s+(.+)$/);
    const noSuffixMatch = remainder.match(/^\s+(.+)$/);

    if (compactSuffixMatch) {
      streetNumberSuffix = compactSuffixMatch[1];
      streetText = compactSuffixMatch[2];
    } else if (spacedSuffixMatch) {
      streetNumberSuffix = spacedSuffixMatch[1].replace(/\s/g, "");
      streetText = spacedSuffixMatch[2];
    } else if (noSuffixMatch) {
      streetText = noSuffixMatch[1];
    } else {
      return null;
    }

    const parts = streetText.split(" ").filter(Boolean);
    let streetDirection = "";
    let streetType = "";

    // A single "E" after the number is a street-name prefix, not a direction.
    if (parts.length > 1 && directions.has(parts.at(-1))) {
      streetDirection = parts.pop();
    }

    // A street type is optional. Keep a lone word as the street-name prefix so
    // inputs such as "100 Park" can still search for a street named PARK…
    if (parts.length > 1 && streetTypeAliases[parts.at(-1)]) {
      streetType = streetTypeAliases[parts.pop()];
    }

    const streetName = parts.join(" ").trim();
    if (!streetName) {
      return null;
    }

    return { streetNumber, streetNumberSuffix, streetName, streetType, streetDirection };
  }

  function escapeSoqlLiteral(value) {
    return value.replace(/'/g, "''");
  }

  function hasEnoughStreetName(streetName) {
    return streetName.replace(/[^A-Z0-9]/g, "").length >= MIN_STREET_NAME_LENGTH;
  }

  function buildQuery(parsed) {
    const clauses = [
      `street_number=${parsed.streetNumber}`,
      parsed.streetNumberSuffix
        ? `street_number_suffix='${escapeSoqlLiteral(parsed.streetNumberSuffix)}'`
        : "street_number_suffix is null",
      `upper(street_name) like '${escapeSoqlLiteral(parsed.streetName)}%'`
    ];

    if (parsed.streetType) {
      clauses.push(`street_type='${escapeSoqlLiteral(parsed.streetType)}'`);
    }

    if (parsed.streetDirection) {
      clauses.push(`street_direction='${escapeSoqlLiteral(parsed.streetDirection)}'`);
    }

    const params = new URLSearchParams({
      "$select": SELECT_FIELDS,
      "$where": clauses.join(" AND "),
      "$group": GROUP_FIELDS,
      "$limit": String(RESULT_LIMIT),
      "$order": "street_name,street_type,street_direction,street_number_suffix,street_address"
    });

    return `${API_URL}?${params.toString()}`;
  }

  return Object.freeze({
    buildQuery,
    escapeSoqlLiteral,
    hasEnoughStreetName,
    normalizeInput,
    parseAddress
  });
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = AddressSearch;
}
