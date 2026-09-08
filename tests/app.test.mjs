import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  API_ENDPOINT,
  buildAddressResults,
  buildQuery,
  escapeSoqlLiteral,
  formatCouncilWard,
  formatSchoolTrustee,
  formatTrusteeWard,
  normalizeAuthoritativeRow,
  normalizeInput,
  parseAddress,
} from "../address-data.js";
import {
  LookupController,
  errorPhaseForStatus,
  isRetryablePhase,
  statusMessage,
} from "../lookup-controller.js";
import { calculatePopupGeometry } from "../popup-geometry.js";

function addressInterpretation(input, index = 0) {
  const parsed = parseAddress(input);
  assert.equal(parsed.lookupReady, true, `${input} should be lookup ready`);
  return parsed.addressInterpretations[index];
}

function queryParts(input) {
  const parsed = parseAddress(input);
  const url = new URL(buildQuery(parsed.addressInterpretations));
  return { parsed, url, where: url.searchParams.get("$where") };
}

function rawRow(overrides = {}) {
  return {
    display_address: "1 PORTAGE AVE E",
    street_number: "1",
    street_name: "PORTAGE",
    street_type: "AVE",
    street_direction: "E",
    school_division: "Winnipeg",
    school_division_ward: "5",
    ward_as_of_september_17: "Fort Rouge - East Fort Garry",
    ...overrides,
  };
}

const REGENT_TRUSTEE_CONFLICT_ROWS = Object.freeze([
  Object.freeze(
    rawRow({
      display_address: "1615 REGENT AVE W",
      street_number: "1615",
      street_name: "REGENT",
      street_type: "AVE",
      street_direction: "W",
      school_division: "River East - Transcona",
      school_division_ward: "1",
      ward_as_of_september_17: "Elmwood - East Kildonan",
    }),
  ),
  Object.freeze(
    rawRow({
      display_address: "1615 REGENT AVE W",
      street_number: "1615",
      street_name: "REGENT",
      street_type: "AVE",
      street_direction: "W",
      school_division: "River East - Transcona",
      school_division_ward: "2",
      ward_as_of_september_17: "Elmwood - East Kildonan",
    }),
  ),
]);

class FakeClock {
  now = 0;
  nextId = 1;
  timers = new Map();

  setTimeout = (callback, delay) => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.now + delay, callback });
    return id;
  };

  clearTimeout = (id) => this.timers.delete(id);

  tick(milliseconds) {
    const end = this.now + milliseconds;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      this.now = due[1].at;
      this.timers.delete(due[0]);
      due[1].callback();
    }
    this.now = end;
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

function createController(fetchFn, options = {}) {
  const clock = new FakeClock();
  const states = [];
  const controller = new LookupController({
    fetchFn,
    debounceMs: 300,
    timeoutMs: 1_000,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
    onChange: (state) => states.push(state),
    ...options,
  });
  return { clock, controller, states };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("popup opens below when the preferred space is available", () => {
  assert.deepEqual(
    calculatePopupGeometry({
      inputTop: 100,
      inputBottom: 150,
      viewportTop: 0,
      viewportHeight: 800,
    }),
    { side: "below", maxHeight: 634 },
  );
});

test("popup opens above when below is constrained and above has more room", () => {
  assert.deepEqual(
    calculatePopupGeometry({
      inputTop: 350,
      inputBottom: 400,
      viewportTop: 0,
      viewportHeight: 500,
    }),
    { side: "above", maxHeight: 334 },
  );
});

test("popup opens below when above and below space are equal", () => {
  assert.deepEqual(
    calculatePopupGeometry({
      inputTop: 240,
      inputBottom: 260,
      viewportTop: 0,
      viewportHeight: 500,
    }),
    { side: "below", maxHeight: 224 },
  );
});

test("popup geometry accounts for a non-zero visual viewport offset", () => {
  assert.deepEqual(
    calculatePopupGeometry({
      inputTop: 250,
      inputBottom: 300,
      viewportTop: 100,
      viewportHeight: 500,
    }),
    { side: "below", maxHeight: 284 },
  );
});

test("popup maximum height retains its minimum in a very short viewport", () => {
  assert.deepEqual(
    calculatePopupGeometry({
      inputTop: 30,
      inputBottom: 70,
      viewportTop: 0,
      viewportHeight: 100,
    }),
    { side: "below", maxHeight: 48 },
  );
});

test("popup preferred-below threshold includes its exact boundary", () => {
  assert.deepEqual(
    calculatePopupGeometry({
      inputTop: 280,
      inputBottom: 280,
      viewportTop: 0,
      viewportHeight: 500,
    }),
    { side: "below", maxHeight: 204 },
  );
  assert.deepEqual(
    calculatePopupGeometry({
      inputTop: 280.1,
      inputBottom: 280.1,
      viewportTop: 0,
      viewportHeight: 500,
    }),
    { side: "above", maxHeight: 264 },
  );
});

test("popup keeps its preferred side while recalculating available height", () => {
  assert.deepEqual(
    calculatePopupGeometry({
      inputTop: 350,
      inputBottom: 400,
      viewportTop: 0,
      viewportHeight: 800,
      preferredSide: "above",
    }),
    { side: "above", maxHeight: 334 },
  );

  assert.deepEqual(
    calculatePopupGeometry({
      inputTop: 350,
      inputBottom: 400,
      viewportTop: 0,
      viewportHeight: 500,
      preferredSide: "below",
    }),
    { side: "below", maxHeight: 84 },
  );
});

test("normalization trims, collapses whitespace, uppercases, and normalizes apostrophes", () => {
  assert.equal(normalizeInput("  12   d’Arcy  "), "12 D'ARCY");
  assert.equal(normalizeInput("1 o‘connor"), "1 O'CONNOR");
});

test("normalization preserves supported hyphens, slashes, apostrophes, and periods", () => {
  assert.equal(
    normalizeInput("1 Dr. David-Friesen 1/2"),
    "1 DR. DAVID-FRIESEN 1/2",
  );
});

test("normalization neutralizes controls and unsupported query punctuation", () => {
  assert.equal(normalizeInput("1 POR%\u0000_TA;GE"), "1 POR TA GE");
});

test("Lookup Ready requires a number and three alphanumeric street-name characters", () => {
  for (const value of ["1", "1 ", "1 P", "1 Po", "1 .-'", "Portage"]) {
    assert.equal(parseAddress(value).lookupReady, false, value);
  }
  assert.equal(parseAddress("1 Por").lookupReady, true);
  assert.equal(parseAddress("1 P-O-R").lookupReady, true);
});

test("Lookup Ready accepts the safe-integer boundary and rejects larger civic numbers", () => {
  const largestSafe = parseAddress("9007199254740991 Main");
  assert.equal(largestSafe.lookupReady, true);
  assert.equal(largestSafe.streetNumber, Number.MAX_SAFE_INTEGER);

  for (const input of ["9007199254740992 Main", "99999999999999999999 Main"]) {
    const parsed = parseAddress(input);
    assert.equal(parsed.lookupReady, false, input);
    assert.equal(parsed.streetNumber, null, input);
    assert.deepEqual(parsed.addressInterpretations, [], input);
  }
});

test("ordinary inputs produce progressively shorter literal address interpretations", () => {
  assert.deepEqual(addressInterpretation("1 Portage"), {
    streetNumber: 1,
    streetNumberSuffix: null,
    streetName: "PORTAGE",
    trailingTokenDrops: 0,
  });
  assert.deepEqual(
    parseAddress("510 Main St").addressInterpretations.map(
      (item) => item.streetName,
    ),
    ["MAIN ST", "MAIN"],
  );
  assert.deepEqual(
    parseAddress("510 Main Street").addressInterpretations.map(
      (item) => item.streetName,
    ),
    ["MAIN STREET", "MAIN"],
  );
  assert.deepEqual(
    parseAddress("1 Portage Avenue").addressInterpretations.map(
      (item) => item.streetName,
    ),
    ["PORTAGE AVENUE", "PORTAGE"],
  );
});

test("type-like name endings stay literal-first with one bounded fallback", () => {
  const parsed = parseAddress("300 Assiniboine Park");
  assert.equal(parsed.addressInterpretations.length, 2);
  assert.deepEqual(
    parsed.addressInterpretations.map((item) => item.streetName),
    ["ASSINIBOINE PARK", "ASSINIBOINE"],
  );
  assert.equal(Object.isFrozen(parsed.addressInterpretations), true);
  assert.equal(parsed.addressInterpretations.every(Object.isFrozen), true);
});

test("PARK and COURT partial, ambiguous, and completed inputs stay lookup ready", () => {
  for (const input of [
    "300 Ass",
    "300 Assiniboine Park",
    "300 Assiniboine Park Dr",
    "1021 Cou",
    "1021 Court",
    "1021 Court Ave",
  ]) {
    assert.equal(parseAddress(input).lookupReady, true, input);
  }
  assert.deepEqual(
    parseAddress("1021 Court").addressInterpretations.map(
      (item) => item.streetName,
    ),
    ["COURT"],
  );

  const parkWhere = queryParts("300 Assiniboine Park").where;
  assert.match(parkWhere, /upper\(street_name\) like 'ASSINIBOINE%'/);
  assert.doesNotMatch(parkWhere, /street_type|ASSINIBOINE PARK%/);
});

test("full official addresses drop at most their two trailing structural tokens", () => {
  assert.deepEqual(
    parseAddress("1000 Garfield Street N").addressInterpretations.map(
      (item) => item.streetName,
    ),
    ["GARFIELD STREET N", "GARFIELD STREET", "GARFIELD"],
  );
  assert.deepEqual(
    parseAddress("1 Dr. David Friesen Dr").addressInterpretations.map(
      (item) => item.streetName,
    ),
    ["DR. DAVID FRIESEN DR", "DR. DAVID FRIESEN", "DR. DAVID"],
  );
  assert.deepEqual(
    parseAddress("1 Portage Ave.").addressInterpretations.map(
      (item) => item.streetName,
    ),
    ["PORTAGE AVE.", "PORTAGE"],
  );
});

test("current ALLEY, BEND, and NW fixtures retain recall without vocabulary", () => {
  assert.deepEqual(
    parseAddress("10 ADARA ALLEY").addressInterpretations.map(
      (item) => item.streetName,
    ),
    ["ADARA ALLEY", "ADARA"],
  );
  assert.deepEqual(
    parseAddress("100 BRIXHAM BEND").addressInterpretations.map(
      (item) => item.streetName,
    ),
    ["BRIXHAM BEND", "BRIXHAM"],
  );
  assert.deepEqual(
    parseAddress("29 SERVICE 3 ST NW").addressInterpretations.map(
      (item) => item.streetName,
    ),
    ["SERVICE 3 ST NW", "SERVICE 3 ST", "SERVICE 3"],
  );
});

test("compact civic suffix is separated from numeric street number", () => {
  const parsed = parseAddress("3A ELKHORN ST");
  assert.equal(parsed.addressInterpretations[0].streetNumber, 3);
  assert.equal(parsed.addressInterpretations[0].streetNumberSuffix, "A");
  assert.deepEqual(
    parsed.addressInterpretations.map((item) => item.streetName),
    ["ELKHORN ST", "ELKHORN"],
  );
});

test("spaced letter suffix produces bounded suffix and street-name readings", () => {
  const parsed = parseAddress("3 A ELKHORN ST");
  assert.deepEqual(
    parsed.addressInterpretations.map((item) => [
      item.streetNumberSuffix,
      item.streetName,
    ]),
    [
      ["A", "ELKHORN ST"],
      ["A", "ELKHORN"],
      [null, "A ELKHORN ST"],
      [null, "A ELKHORN"],
    ],
  );
});

test("1/2 and 1/2A suffix forms parse in compact and spaced forms", () => {
  assert.equal(
    addressInterpretation("371/2 LIPTON ST").streetNumberSuffix,
    "1/2",
  );
  assert.equal(
    addressInterpretation("891/2A BRAEMAR AVE").streetNumberSuffix,
    "1/2A",
  );
  assert.equal(addressInterpretation("891/2A BRAEMAR AVE").streetNumber, 89);
  assert.deepEqual(
    parseAddress("37 1/2 LIPTON ST").addressInterpretations.map((item) => [
      item.streetNumberSuffix,
      item.streetName,
    ]),
    [
      ["1/2", "LIPTON ST"],
      ["1/2", "LIPTON"],
      [null, "1/2 LIPTON ST"],
      [null, "1/2 LIPTON"],
    ],
  );
  assert.deepEqual(
    parseAddress("89 1/2 A BRAEMAR AVE").addressInterpretations.map((item) => [
      item.streetNumberSuffix,
      item.streetName,
    ]),
    [
      ["1/2A", "BRAEMAR AVE"],
      ["1/2A", "BRAEMAR"],
      [null, "1/2 A BRAEMAR AVE"],
      [null, "1/2 A BRAEMAR"],
      [null, "1/2 A"],
    ],
  );
});

test("omitted suffix adds no suffix restriction", () => {
  const { where } = queryParts("3 Elkhorn");
  assert.doesNotMatch(where, /street_number_suffix/);
});

test("direction-like trailing token yields literal-first structural fallback", () => {
  const parsed = parseAddress("50 Wildwood E");
  assert.equal(parsed.addressInterpretations.length, 2);
  assert.deepEqual(
    parsed.addressInterpretations.map((item) => item.streetName),
    ["WILDWOOD E", "WILDWOOD"],
  );
  const garfield = parseAddress("1000 Garfield N");
  assert.deepEqual(
    garfield.addressInterpretations.map((item) => item.streetName),
    ["GARFIELD N", "GARFIELD"],
  );
});

test("direction-like name ending remains available when a type follows", () => {
  assert.deepEqual(
    parseAddress("50 Wildwood E Park").addressInterpretations.map(
      (item) => item.streetName,
    ),
    ["WILDWOOD E PARK", "WILDWOOD E", "WILDWOOD"],
  );
});

test("progressive entry keeps narrowing instead of stopping at three characters", () => {
  assert.deepEqual(
    parseAddress("15 Mar").addressInterpretations.map(
      (item) => item.streetName,
    ),
    ["MAR"],
  );
  assert.deepEqual(
    parseAddress("15 Mari").addressInterpretations.map(
      (item) => item.streetName,
    ),
    ["MARI"],
  );
  assert.deepEqual(
    parseAddress("15 Marion").addressInterpretations.map(
      (item) => item.streetName,
    ),
    ["MARION"],
  );
  assert.deepEqual(
    parseAddress("15 Marion S").addressInterpretations.map(
      (item) => item.streetName,
    ),
    ["MARION S", "MARION"],
  );
  assert.deepEqual(
    parseAddress("15 Marion St N").addressInterpretations.map(
      (item) => item.streetName,
    ),
    ["MARION ST N", "MARION ST", "MARION"],
  );
});

test("multi-word names retain literal prefixes before bounded structural fallbacks", () => {
  assert.deepEqual(
    parseAddress("1 Dr. David-Friesen Dr").addressInterpretations.map(
      (item) => item.streetName,
    ),
    ["DR. DAVID-FRIESEN DR", "DR. DAVID-FRIESEN"],
  );
  assert.deepEqual(
    parseAddress("20 Rue des Meurons St").addressInterpretations.map(
      (item) => item.streetName,
    ),
    ["RUE DES MEURONS ST", "RUE DES MEURONS", "RUE DES"],
  );
});

test("address interpretation generation is bounded at six across ambiguous suffix readings", () => {
  const parsed = parseAddress("3 A Alpha Beta St N");
  assert.equal(parsed.addressInterpretations.length, 6);
  assert.deepEqual(
    parsed.addressInterpretations.map((item) => [
      item.streetNumberSuffix,
      item.streetName,
    ]),
    [
      ["A", "ALPHA BETA ST N"],
      ["A", "ALPHA BETA ST"],
      ["A", "ALPHA BETA"],
      [null, "A ALPHA BETA ST N"],
      [null, "A ALPHA BETA ST"],
      [null, "A ALPHA BETA"],
    ],
  );
});

test("SoQL escaping doubles every apostrophe", () => {
  assert.equal(escapeSoqlLiteral("O'BRIEN'S"), "O''BRIEN''S");
});

test("query has exact numeric number and only the broadest required name prefix", () => {
  const { url, where } = queryParts("1000 Garfield Street N");
  assert.equal(url.origin + url.pathname, API_ENDPOINT);
  assert.match(where, /^street_number = 1000 AND/);
  assert.match(where, /upper\(street_name\) like 'GARFIELD%'/);
  assert.doesNotMatch(where, /street_type|street_direction/);
  assert.doesNotMatch(where, /street_number = '1000'/);
});

test("query separates a combined suffix from the numeric field", () => {
  const { where } = queryParts("3A ELKHORN ST");
  assert.match(where, /street_number = 3/);
  assert.match(where, /upper\(street_number_suffix\) = 'A'/);
  assert.doesNotMatch(where, /3A/);
});

test("query URL-encodes safe apostrophe literals", () => {
  const { url, where } = queryParts("12 O'Brien St");
  assert.match(url.href, /%24where=/);
  assert.match(where, /O''BRIEN%/);
  assert.doesNotMatch(url.search.slice(1), / O'BRIEN/);
});

test("query includes select, where, group, order and excludes forbidden fields", () => {
  const { url } = queryParts("1 Portage");
  for (const key of ["$select", "$where", "$group", "$order"])
    assert.ok(url.searchParams.has(key));
  assert.match(
    url.searchParams.get("$select"),
    /street_address as display_address/,
  );
  assert.match(url.searchParams.get("$group"), /street_number_suffix/);
  const all = [...url.searchParams.values()].join(" ");
  assert.doesNotMatch(all, /full_address/);
  assert.doesNotMatch(all, /(?:^|,)ward(?:,|$)/);
  assert.match(all, /ward_as_of_september_17/);
  assert.equal(url.searchParams.has("$limit"), false);
});

test("ranked address interpretations stay ordered while redundant query predicates are removed", () => {
  const { parsed, where } = queryParts("50 Wildwood E");
  assert.equal(parsed.addressInterpretations.length, 2);
  assert.equal((where.match(/ OR /g) || []).length, 0);
  assert.doesNotMatch(where, /WILDWOOD E%/);
  assert.match(where, /WILDWOOD%/);

  const duplicateUrl = new URL(
    buildQuery([
      parsed.addressInterpretations[0],
      parsed.addressInterpretations[1],
      parsed.addressInterpretations[0],
    ]),
  );
  const duplicateWhere = duplicateUrl.searchParams.get("$where");
  assert.equal((duplicateWhere.match(/ OR /g) || []).length, 0);
  assert.match(duplicateWhere, /WILDWOOD%/);
});

test("six ranked address interpretations collapse to at most two suffix-aware query alternatives", () => {
  const { parsed, where } = queryParts("3 A Alpha Beta St N");
  assert.equal(parsed.addressInterpretations.length, 6);
  assert.equal((where.match(/ OR /g) || []).length, 1);
  assert.match(
    where,
    /upper\(street_name\) like 'ALPHA BETA%'.*street_number_suffix/,
  );
  assert.match(where, /upper\(street_name\) like 'A ALPHA BETA%'/);
  assert.doesNotMatch(where, /ALPHA BETA ST/);
});

test("authoritative row uses the official display alias, not input", () => {
  const row = normalizeAuthoritativeRow(rawRow());
  assert.equal(row.displayAddress, "1 PORTAGE AVE E");
  assert.equal(row.streetNumber, 1);
  assert.equal(row.councilWard, "Fort Rouge - East Fort Garry");
});

test("raw authoritative rows normalize aliases, trimming, and missing values", () => {
  const row = normalizeAuthoritativeRow(
    rawRow({
      display_address: undefined,
      street_address: "  1 PORTAGE AVE E  ",
      street_number: 1,
      street_number_suffix: " ",
      street_name: "  PORTAGE ",
      ward_as_of_september_17: null,
    }),
  );
  assert.deepEqual(row, {
    displayAddress: "1 PORTAGE AVE E",
    streetNumber: 1,
    streetNumberSuffix: null,
    streetName: "PORTAGE",
    streetType: "AVE",
    streetDirection: "E",
    schoolDivision: "Winnipeg",
    schoolDivisionWard: "5",
    councilWard: null,
  });
});

test("authoritative street numbers accept non-negative safe integers and decimal strings", () => {
  const validStreetNumbers = [
    0,
    1,
    Number.MAX_SAFE_INTEGER,
    "0",
    "1",
    "001",
    String(Number.MAX_SAFE_INTEGER),
  ];

  for (const streetNumber of validStreetNumbers) {
    assert.equal(
      normalizeAuthoritativeRow(rawRow({ street_number: streetNumber }))
        .streetNumber,
      Number(streetNumber),
      `expected ${String(streetNumber)} to be accepted`,
    );
  }
});

test("authoritative street numbers reject malformed or unsafe values", () => {
  const invalidStreetNumbers = [
    null,
    undefined,
    "",
    " ",
    -1,
    "-1",
    1.5,
    "1.5",
    "1e3",
    "0x10",
    Infinity,
    -Infinity,
    NaN,
    Number.MAX_SAFE_INTEGER + 1,
    String(Number.MAX_SAFE_INTEGER + 1),
    true,
    {},
    [],
    "not numeric",
  ];

  for (const streetNumber of invalidStreetNumbers) {
    assert.equal(
      normalizeAuthoritativeRow(rawRow({ street_number: streetNumber })),
      null,
      `expected ${String(streetNumber)} to be rejected`,
    );
  }
});

test("an exact completed official address dominates a literal-name collision", () => {
  const parsed = parseAddress("15 Marion St");
  const rawRows = [
    rawRow({
      display_address: "15 MARION ST AVE",
      street_number: "15",
      street_name: "MARION ST",
      street_type: "AVE",
      street_direction: undefined,
    }),
    rawRow({
      display_address: "15 MARION ST",
      street_number: "15",
      street_name: "MARION",
      street_type: "ST",
      street_direction: undefined,
    }),
  ];
  const results = buildAddressResults(
    rawRows,
    parsed.addressInterpretations,
    parsed.normalizedInput,
  );
  assert.deepEqual(
    results.map((row) => row.displayAddress),
    ["15 MARION ST"],
  );
});

test("exact completed civic-suffix address accepts compact and spaced input", () => {
  const rawRows = [
    rawRow({
      display_address: "1000 A BOSTON AVE",
      street_number: "1000",
      street_number_suffix: "A",
      street_name: "BOSTON",
      street_type: "AVE",
      street_direction: undefined,
    }),
    rawRow({
      display_address: "1000 A BOSTON AVE RD",
      street_number: "1000",
      street_number_suffix: "A",
      street_name: "BOSTON AVE",
      street_type: "RD",
      street_direction: undefined,
    }),
  ];
  for (const input of ["1000A Boston Ave", "1000 A Boston Ave"]) {
    const parsed = parseAddress(input);
    const results = buildAddressResults(
      rawRows,
      parsed.addressInterpretations,
      parsed.normalizedInput,
    );
    assert.deepEqual(
      results.map((row) => row.displayAddress),
      ["1000 A BOSTON AVE"],
    );
  }
});

test("exact official-address dominance removes every weaker fallback", () => {
  const parsed = parseAddress("15 Lake Albrin Bay");
  const rawRows = [
    rawRow({
      display_address: "15 LAKE PARK DR",
      street_number: "15",
      street_name: "LAKE PARK",
      street_type: "DR",
      street_direction: undefined,
    }),
    rawRow({
      display_address: "15 LAKE ALBRIN BAY",
      street_number: "15",
      street_name: "LAKE ALBRIN",
      street_type: "BAY",
      street_direction: undefined,
    }),
    rawRow({
      display_address: "15 LAKE FALL PL",
      street_number: "15",
      street_name: "LAKE FALL",
      street_type: "PL",
      street_direction: undefined,
    }),
  ];

  const results = buildAddressResults(
    rawRows,
    parsed.addressInterpretations,
    parsed.normalizedInput,
  );
  assert.deepEqual(
    results.map((row) => row.displayAddress),
    ["15 LAKE ALBRIN BAY"],
  );
});

test("a complete street name suppresses weaker structural fallbacks", () => {
  const parsed = parseAddress("15 Lake Albrin");
  const rawRows = [
    rawRow({
      display_address: "15 LAKE PARK DR",
      street_number: "15",
      street_name: "LAKE PARK",
      street_type: "DR",
      street_direction: undefined,
    }),
    rawRow({
      display_address: "15 LAKE ALBRIN BAY",
      street_number: "15",
      street_name: "LAKE ALBRIN",
      street_type: "BAY",
      street_direction: undefined,
    }),
    rawRow({
      display_address: "15 LAKE FALL PL",
      street_number: "15",
      street_name: "LAKE FALL",
      street_type: "PL",
      street_direction: undefined,
    }),
  ];

  const results = buildAddressResults(
    rawRows,
    parsed.addressInterpretations,
    parsed.normalizedInput,
  );
  assert.deepEqual(
    results.map((row) => row.displayAddress),
    ["15 LAKE ALBRIN BAY"],
  );
});

test("partial type text promotes the best available fallback tier", () => {
  const rawRows = [
    rawRow({
      display_address: "72 EPSOM PL",
      street_number: "72",
      street_name: "EPSOM",
      street_type: "PL",
      street_direction: undefined,
    }),
  ];

  for (const input of ["72 Epsom P", "72 Epsom Pla", "72 Epsom Plac"]) {
    const parsed = parseAddress(input);
    const results = buildAddressResults(
      rawRows,
      parsed.addressInterpretations,
      parsed.normalizedInput,
    );
    assert.deepEqual(
      results.map((row) => row.displayAddress),
      ["72 EPSOM PL"],
    );
  }
});

test("authoritative prefix completions prevent a literal-name collision from hiding a partial type", () => {
  const parsed = parseAddress("10 River R");
  const results = buildAddressResults(
    [
      rawRow({
        display_address: "10 RIVER RD",
        street_number: "10",
        street_name: "RIVER",
        street_type: "RD",
        street_direction: undefined,
      }),
      rawRow({
        display_address: "10 RIVER RIDGE DR",
        street_number: "10",
        street_name: "RIVER RIDGE",
        street_type: "DR",
        street_direction: undefined,
      }),
      rawRow({
        display_address: "10 RIVER PARK DR",
        street_number: "10",
        street_name: "RIVER PARK",
        street_type: "DR",
        street_direction: undefined,
      }),
    ],
    parsed.addressInterpretations,
    parsed.normalizedInput,
  );

  assert.deepEqual(
    results.map((row) => row.displayAddress),
    ["10 RIVER RIDGE DR", "10 RIVER RD"],
  );
});

test("authoritative variants preserve literal-name and omitted-type direction readings", () => {
  const wildwood = parseAddress("50 Wildwood E");
  const wildwoodResults = buildAddressResults(
    [
      rawRow({
        display_address: "50 WILDWOOD ST E",
        street_number: "50",
        street_name: "WILDWOOD",
        street_type: "ST",
        street_direction: "E",
      }),
      rawRow({
        display_address: "50 WILDWOOD E PK",
        street_number: "50",
        street_name: "WILDWOOD E",
        street_type: "PK",
        street_direction: undefined,
      }),
    ],
    wildwood.addressInterpretations,
    wildwood.normalizedInput,
  );
  assert.deepEqual(
    wildwoodResults.map((row) => row.displayAddress),
    ["50 WILDWOOD E PK", "50 WILDWOOD ST E"],
  );
});

test("same-tier civic-suffix ambiguity remains available", () => {
  const suffix = parseAddress("3 A Elkhorn");
  const suffixResults = buildAddressResults(
    [
      rawRow({
        display_address: "3 A ELKHORN ST",
        street_number: "3",
        street_number_suffix: "A",
        street_name: "ELKHORN",
        street_type: "ST",
        street_direction: undefined,
      }),
      rawRow({
        display_address: "3 A ELKHORN RD",
        street_number: "3",
        street_number_suffix: undefined,
        street_name: "A ELKHORN",
        street_type: "RD",
        street_direction: undefined,
      }),
    ],
    suffix.addressInterpretations,
    suffix.normalizedInput,
  );
  assert.equal(suffixResults.length, 2);
});

test("identical displayed addresses collapse to one deterministic suggestion", () => {
  const parsed = parseAddress("1615 Regent Ave W");
  const rawRows = [
    ...REGENT_TRUSTEE_CONFLICT_ROWS,
    rawRow({
      display_address: "1615 REGENT ST",
      street_number: "1615",
      street_name: "REGENT",
      street_type: "ST",
      street_direction: undefined,
    }),
  ];

  const results = buildAddressResults(
    rawRows,
    parsed.addressInterpretations,
    parsed.normalizedInput,
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].displayAddress, "1615 REGENT AVE W");
  assert.equal(results[0].schoolDivisionWard, "1");
});

test("numeric trustee ward gets one Ward prefix and named values stay verbatim", () => {
  assert.equal(formatTrusteeWard("5"), "Ward 5");
  for (const named of ["East Ward", "West Ward", "Centre Ward", "Rosser"]) {
    assert.equal(formatTrusteeWard(named), named);
  }
});

test("missing election values are visibly represented", () => {
  assert.equal(formatCouncilWard(null), "Not available");
  assert.equal(formatTrusteeWard(null), "Not available");
  assert.equal(
    formatSchoolTrustee(null, null),
    "Not available — Not available",
  );
  assert.equal(
    normalizeAuthoritativeRow(rawRow({ ward_as_of_september_17: null }))
      .councilWard,
    null,
  );
});

test("Address Lookup Result status announces the official address and visible election values", () => {
  const selected = normalizeAuthoritativeRow(rawRow());
  assert.equal(
    statusMessage({ phase: "selected", selected }),
    "Election information shown for 1 PORTAGE AVE E. City Council: Fort Rouge - East Fort Garry. School Trustee: Winnipeg — Ward 5.",
  );
});

test("Address Lookup Result status represents missing values like the visible result", () => {
  const selected = normalizeAuthoritativeRow(
    rawRow({
      ward_as_of_september_17: null,
      school_division: null,
      school_division_ward: null,
    }),
  );
  assert.equal(
    statusMessage({ phase: "selected", selected }),
    "Election information shown for 1 PORTAGE AVE E. City Council: Not available. School Trustee: Not available — Not available.",
  );
});

test("header copy, address description, and help markup match the interface", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(html, /<h1 id="page-title">Find Your Candidates<\/h1>/);
  assert.match(html, /aria-describedby="address-status"/);
  assert.doesNotMatch(html, /id="address-help"/);
  assert.doesNotMatch(css.match(/h1\s*{[^}]*}/)?.[0] ?? "", /max-width\s*:/);
  assert.doesNotMatch(
    css.match(/\.lede\s*{[^}]*}/)?.[0] ?? "",
    /max-width\s*:/,
  );
});

test("document roots can shrink when a 320 pixel viewport has a scrollbar", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const htmlRule = css.match(/html\s*{[^}]*}/)?.[0] ?? "";
  const bodyRule = css.match(/body\s*{[^}]*}/)?.[0] ?? "";
  assert.doesNotMatch(htmlRule, /min-width\s*:/);
  assert.doesNotMatch(bodyRule, /min-width\s*:/);
});

test("retry control markup is a hidden native button alongside the single live status", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(
    html,
    /<button class="retry-button" id="retry-button" type="button" hidden>\s*Retry address search\s*<\/button>/,
  );
  assert.equal((html.match(/role="status"/g) || []).length, 1);
});

test("footer preserves the privacy notice and acknowledges the City data licence", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<footer class="page-footer">/);
  assert.match(
    html,
    /<p class="footer-note privacy-note">\s*<strong>Privacy:<\/strong> Your address is not stored by this tool\.\s*Searches go to the\s*<a href="https:\/\/data\.winnipeg\.ca\/City-Planning\/Addresses\/cam2-ii3u"\s*>City of Winnipeg address service<\/a\s*>\./,
  );
  assert.match(
    html,
    /<p class="footer-note attribution-note">\s*<strong>Attribution:<\/strong> This tool uses\s*<a href="https:\/\/en\.wikipedia\.org\/wiki\/Open_data">open data<\/a>\s*licenced under the\s*<a href="https:\/\/data\.winnipeg\.ca\/open-data-licence"\s*>City of Winnipeg Open Government Licence<\/a\s*>\./,
  );
  assert.match(html, /<\/p>\s*<p class="footer-note attribution-note">/);
});

test("visually hidden popup status retains its normal-flow layout space", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const hiddenStatusRule =
    css.match(
      /\.status\.selected-announcement,\s*\.search-area\[data-popup-open="true"\] \.status\s*{[^}]*}/,
    )?.[0] ?? "";
  assert.match(hiddenStatusRule, /clip-path:\s*inset\(50%\)/);
  assert.doesNotMatch(hiddenStatusRule, /position:\s*absolute/);
  assert.doesNotMatch(hiddenStatusRule, /margin:\s*-1px/);
});

test("HTTP outcomes map to distinct phases and user messages", () => {
  assert.equal(errorPhaseForStatus(400), "error400");
  assert.equal(errorPhaseForStatus(429), "error429");
  assert.equal(errorPhaseForStatus(503), "errorServer");
  assert.match(statusMessage({ phase: "error400" }), /could not be searched/);
  assert.match(statusMessage({ phase: "error429" }), /busy/);
  assert.match(
    statusMessage({ phase: "errorServer" }),
    /temporarily unavailable/,
  );
  assert.match(
    statusMessage({ phase: "errorNetwork" }),
    /could not be reached/,
  );
});

test("only transient service, transport, timeout, and payload failures are retryable", () => {
  for (const phase of [
    "error429",
    "errorServer",
    "errorTimeout",
    "errorNetwork",
    "errorUnexpected",
  ]) {
    assert.equal(isRetryablePhase(phase), true, phase);
  }
  for (const phase of [
    "error400",
    "guidance",
    "loading",
    "empty",
    "results",
    "selected",
  ]) {
    assert.equal(isRetryablePhase(phase), false, phase);
  }
});

test("debounce replacement issues only the newest request", async () => {
  const calls = [];
  const { clock, controller } = createController(async (url) => {
    calls.push(url);
    return response(200, []);
  });
  controller.inputChanged("15 Mar");
  clock.tick(200);
  controller.inputChanged("1 Por");
  clock.tick(300);
  await flush();
  assert.equal(calls.length, 1);
  assert.match(
    new URL(calls[0]).searchParams.get("$where"),
    /street_number = 1/,
  );
});

test("input replacement aborts the active request", async () => {
  let signal;
  const pending = deferred();
  const { clock, controller } = createController((url, options) => {
    signal = options.signal;
    return pending.promise;
  });
  controller.inputChanged("15 Mar");
  clock.tick(300);
  assert.equal(signal.aborted, false);
  controller.inputChanged("1 Por");
  assert.equal(signal.aborted, true);
  pending.resolve(response(200, []));
  await flush();
});

test("a stale response cannot render after rapid replacement", async () => {
  const requests = [];
  const { clock, controller } = createController(() => {
    const item = deferred();
    requests.push(item);
    return item.promise;
  });
  controller.inputChanged("15 Mar");
  clock.tick(300);
  controller.inputChanged("1 Por");
  clock.tick(300);
  requests[1].resolve(response(200, [rawRow()]));
  await flush();
  requests[0].resolve(
    response(200, [
      rawRow({
        display_address: "15 MARION ST",
        street_number: "15",
        street_name: "MARION",
        street_type: "ST",
      }),
    ]),
  );
  await flush();
  assert.equal(controller.state.results.length, 1);
  assert.equal(controller.state.results[0].displayAddress, "1 PORTAGE AVE E");
});

test("timeout aborts and exits loading with retry guidance", async () => {
  const { clock, controller } = createController(
    (url, { signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      }),
  );
  controller.inputChanged("1 Por");
  clock.tick(300);
  assert.equal(controller.state.phase, "loading");
  clock.tick(1_000);
  await flush();
  assert.equal(controller.state.phase, "errorTimeout");
  assert.equal(controller.abortController, null);
  assert.match(statusMessage(controller.state), /too long/);
});

test("timeout while reading the response body produces errorTimeout", async () => {
  const { clock, controller } = createController(async (url, { signal }) => ({
    ok: true,
    status: 200,
    json: () =>
      new Promise((resolve, reject) => {
        signal.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      }),
  }));

  controller.inputChanged("1 Por");
  clock.tick(300);
  await flush();
  assert.equal(controller.state.phase, "loading");
  clock.tick(1_000);
  await flush();
  assert.equal(controller.state.phase, "errorTimeout");
  assert.notEqual(controller.state.phase, "errorUnexpected");
});

test("an unsafe civic number stays in guidance and never schedules a request", () => {
  let calls = 0;
  const { clock, controller } = createController(async () => {
    calls += 1;
    return response(200, []);
  });

  controller.inputChanged("99999999999999999999 Main");
  clock.tick(2_000);
  assert.equal(calls, 0);
  assert.equal(controller.state.phase, "guidance");
  assert.equal(isRetryablePhase(controller.state.phase), false);
  assert.equal(controller.retry(), false);
});

test("a successful payload with no valid authoritative rows produces an empty result", async () => {
  const { clock, controller } = createController(async () =>
    response(200, [
      null,
      {},
      rawRow({ display_address: " ", street_address: undefined }),
      rawRow({ street_number: "not numeric" }),
    ]),
  );

  controller.inputChanged("1 Por");
  clock.tick(300);
  await flush();
  assert.equal(controller.state.phase, "empty");
  assert.equal(controller.state.results.length, 0);
  assert.equal(controller.state.popupOpen, false);
});

test("controller exposes and caches only the strongest structural result tier", async () => {
  let calls = 0;
  const payload = [
    rawRow({
      display_address: "15 LAKE PARK DR",
      street_number: "15",
      street_name: "LAKE PARK",
      street_type: "DR",
      street_direction: undefined,
    }),
    rawRow({
      display_address: "15 LAKE ALBRIN BAY",
      street_number: "15",
      street_name: "LAKE ALBRIN",
      street_type: "BAY",
      street_direction: undefined,
    }),
    rawRow({
      display_address: "15 LAKE FALL PL",
      street_number: "15",
      street_name: "LAKE FALL",
      street_type: "PL",
      street_direction: undefined,
    }),
  ];
  const { clock, controller } = createController(async () => {
    calls += 1;
    return response(200, payload);
  });

  controller.inputChanged("15 Lake Albrin");
  clock.tick(300);
  await flush();
  assert.equal(controller.state.results.length, 1);
  assert.equal("primaryResultCount" in controller.state, false);
  assert.equal(
    controller.state.results[0].displayAddress,
    "15 LAKE ALBRIN BAY",
  );

  controller.dismiss();
  assert.equal(controller.activateInput(), true);
  assert.equal(controller.state.results.length, 1);
  assert.equal(calls, 1);
});

for (const [name, fetchFn, expected] of [
  ["HTTP 400", async () => response(400, []), "error400"],
  ["HTTP 429", async () => response(429, []), "error429"],
  ["HTTP 5xx", async () => response(503, []), "errorServer"],
  [
    "network failure",
    async () => {
      throw new TypeError("offline");
    },
    "errorNetwork",
  ],
  [
    "non-array payload",
    async () => response(200, { error: true }),
    "errorUnexpected",
  ],
  [
    "malformed JSON",
    async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("bad json");
      },
    }),
    "errorUnexpected",
  ],
]) {
  test(`${name} produces ${expected} without stale suggestions`, async () => {
    const { clock, controller } = createController(fetchFn);
    controller.inputChanged("1 Por");
    clock.tick(300);
    await flush();
    assert.equal(controller.state.phase, expected);
    assert.equal(controller.state.popupOpen, false);
    assert.equal(controller.state.results.length, 0);
    assert.equal(controller.state.activeIndex, -1);
  });
}

test("activation preserves a retryable error until explicit retry runs exactly once", async () => {
  let calls = 0;
  const { clock, controller, states } = createController(async () => {
    calls += 1;
    return calls === 1 ? response(503, []) : response(200, [rawRow()]);
  });
  controller.inputChanged("1 Por");
  clock.tick(300);
  await flush();
  assert.equal(controller.state.phase, "errorServer");
  const stateCount = states.length;

  assert.equal(controller.activateInput(), false);
  assert.equal(controller.activateInput(), false);
  clock.tick(1_000);
  await flush();
  assert.equal(calls, 1);
  assert.equal(controller.state.phase, "errorServer");
  assert.equal(states.length, stateCount);

  assert.equal(controller.retry(), true);
  assert.equal(controller.state.phase, "loading");
  assert.equal(states.length, stateCount + 1);
  await flush();
  assert.equal(calls, 2);
  assert.equal(controller.state.phase, "results");
  assert.equal(controller.state.results[0].displayAddress, "1 PORTAGE AVE E");
  assert.equal(states.length, stateCount + 2);
});

test("activation preserves non-retryable HTTP 400 without another request", async () => {
  let calls = 0;
  const { clock, controller, states } = createController(async () => {
    calls += 1;
    return response(400, []);
  });
  controller.inputChanged("1 Por");
  clock.tick(300);
  await flush();
  assert.equal(controller.state.phase, "error400");
  const stateCount = states.length;

  assert.equal(controller.activateInput(), false);
  clock.tick(1_000);
  await flush();
  assert.equal(calls, 1);
  assert.equal(controller.state.phase, "error400");
  assert.equal(states.length, stateCount);
  assert.equal(controller.retry(), false);

  controller.inputChanged("15 Mar");
  assert.equal(controller.state.phase, "pending");
  clock.tick(300);
  await flush();
  assert.equal(calls, 2);
});

test("retry refuses non-retryable or no-longer-lookup-ready state", async () => {
  const { clock, controller } = createController(async () => response(400, []));
  controller.inputChanged("1 Por");
  clock.tick(300);
  await flush();
  assert.equal(controller.state.phase, "error400");
  assert.equal(controller.retry(), false);

  controller.state.phase = "errorNetwork";
  controller.state.rawInput = "1 Po";
  controller.state.normalizedInput = "1 PO";
  assert.equal(controller.retry(), false);
});

test("editing during retry aborts it and stale retry completion cannot replace the new query", async () => {
  const retriedRequest = deferred();
  let retriedSignal;
  let calls = 0;
  const { clock, controller } = createController((url, options) => {
    calls += 1;
    if (calls === 1) return Promise.resolve(response(503, []));
    if (calls === 2) {
      retriedSignal = options.signal;
      return retriedRequest.promise;
    }
    return Promise.resolve(response(200, [rawRow()]));
  });

  controller.inputChanged("15 Mar");
  clock.tick(300);
  await flush();
  assert.equal(controller.state.phase, "errorServer");
  controller.retry();
  assert.equal(retriedSignal.aborted, false);

  controller.inputChanged("1 Por");
  assert.equal(retriedSignal.aborted, true);
  clock.tick(300);
  await flush();
  retriedRequest.resolve(
    response(200, [
      rawRow({
        display_address: "15 MARION ST",
        street_number: "15",
        street_name: "MARION",
        street_type: "ST",
      }),
    ]),
  );
  await flush();
  assert.equal(controller.state.results.length, 1);
  assert.equal(controller.state.results[0].displayAddress, "1 PORTAGE AVE E");
});

test("outside dismissal during debounce prevents reopening", () => {
  let calls = 0;
  const { clock, controller } = createController(async () => {
    calls += 1;
    return response(200, []);
  });
  controller.inputChanged("1 Por");
  controller.dismiss();
  clock.tick(500);
  assert.equal(calls, 0);
  assert.equal(controller.state.popupOpen, false);
  assert.equal(statusMessage(controller.state), "");
});

test("outside dismissal during request prevents completion from reopening", async () => {
  const pending = deferred();
  const { clock, controller } = createController(() => pending.promise);
  controller.inputChanged("1 Por");
  clock.tick(300);
  controller.dismiss();
  pending.resolve(response(200, [rawRow()]));
  await flush();
  assert.equal(controller.state.popupOpen, false);
  assert.equal(controller.state.results.length, 0);
});

test("activating an unchanged dismissed result cache reopens it once without fetching", async () => {
  let calls = 0;
  const { clock, controller, states } = createController(async () => {
    calls += 1;
    return response(200, [rawRow()]);
  });
  controller.inputChanged("1 Por");
  clock.tick(300);
  await flush();
  assert.equal(controller.state.popupOpen, true);
  controller.moveActive(1);
  assert.equal(controller.state.activeIndex, 0);
  controller.dismiss();
  assert.equal(controller.state.popupOpen, false);
  const stateCount = states.length;

  assert.equal(controller.activateInput(), true);
  assert.equal(controller.state.popupOpen, true);
  assert.equal(controller.state.phase, "results");
  assert.equal(controller.state.activeIndex, 0);
  assert.match(statusMessage(controller.state), /1 matching official address/);
  assert.equal(calls, 1);
  assert.equal(states.length, stateCount + 1);

  assert.equal(controller.activateInput(), false);
  assert.equal(calls, 1);
  assert.equal(states.length, stateCount + 1);
});

test("activation does not duplicate pending debounce or active request work", async () => {
  const pending = deferred();
  let calls = 0;
  const { clock, controller, states } = createController(() => {
    calls += 1;
    return pending.promise;
  });

  controller.inputChanged("1 Por");
  assert.equal(clock.timers.size, 1);
  const pendingStateCount = states.length;
  assert.equal(controller.activateInput(), false);
  assert.equal(clock.timers.size, 1);
  assert.equal(states.length, pendingStateCount);
  clock.tick(300);
  assert.equal(calls, 1);

  const loadingStateCount = states.length;
  assert.equal(controller.activateInput(), false);
  assert.equal(calls, 1);
  assert.equal(states.length, loadingStateCount);
  pending.resolve(response(200, []));
  await flush();
});

test("activation resumes an idle dismissed search through one normal debounce", async () => {
  let calls = 0;
  const { clock, controller } = createController(async () => {
    calls += 1;
    return response(200, []);
  });
  controller.inputChanged("1 Por");
  controller.dismiss();

  assert.equal(controller.activateInput(), true);
  assert.equal(controller.state.phase, "pending");
  assert.equal(controller.activateInput(), false);
  assert.equal(clock.timers.size, 1);
  clock.tick(300);
  await flush();
  assert.equal(calls, 1);
});

test("emitted controller states remain stable after later transitions", async () => {
  const { clock, controller, states } = createController(async () =>
    response(200, [rawRow()]),
  );

  controller.inputChanged("1 Por");
  const pendingState = states.at(-1);
  clock.tick(300);
  const loadingState = states.at(-1);
  await flush();
  const resultsState = states.at(-1);
  controller.selectActive();

  assert.deepEqual(
    states.map((state) => state.phase),
    ["pending", "loading", "results", "selected"],
  );
  assert.equal(pendingState.phase, "pending");
  assert.equal(loadingState.phase, "loading");
  assert.equal(loadingState.results, pendingState.results);
  assert.equal(resultsState.phase, "results");
  assert.equal(resultsState.popupOpen, true);
  assert.equal(resultsState.results.length, 1);
  assert.notEqual(pendingState, loadingState);
  assert.notEqual(loadingState, resultsState);
});

test("active-option updates replace state while retaining results identity", async () => {
  const second = rawRow({
    display_address: "1 PORTAGE AVE",
    street_direction: undefined,
  });
  const { clock, controller, states } = createController(async () =>
    response(200, [rawRow(), second]),
  );
  controller.inputChanged("1 Por");
  clock.tick(300);
  await flush();

  const resultsState = controller.state;
  const results = resultsState.results;
  controller.moveActive(1);

  assert.notEqual(controller.state, resultsState);
  assert.equal(controller.state.results, results);
  assert.equal(resultsState.activeIndex, 0);
  assert.equal(controller.state.activeIndex, 1);
  assert.equal(states.at(-1), controller.state);
});

test("keyboard navigation starts from the automatic first option, wraps, and selection keeps official row", async () => {
  const second = rawRow({
    display_address: "1 PORTAGE AVE",
    street_direction: undefined,
  });
  const { clock, controller } = createController(async () =>
    response(200, [rawRow(), second]),
  );
  controller.inputChanged("1 Por");
  clock.tick(300);
  await flush();
  assert.equal(controller.state.activeIndex, 0);
  controller.moveActive(-1);
  assert.equal(controller.state.activeIndex, 1);
  controller.moveActive(1);
  assert.equal(controller.state.activeIndex, 0);
  const selected = controller.selectActive();
  assert.equal(controller.state.rawInput, selected.displayAddress);
  assert.equal(controller.state.popupOpen, false);
  assert.equal(controller.state.activeIndex, -1);
  assert.equal(controller.state.results.length, 0);
});

test("Enter selection chooses the automatically active first result", async () => {
  const second = rawRow({
    display_address: "1 PORTAGE AVE",
    street_direction: undefined,
  });
  const { clock, controller } = createController(async () =>
    response(200, [rawRow(), second]),
  );
  controller.inputChanged("1 Por");
  clock.tick(300);
  await flush();

  assert.equal(controller.state.activeIndex, 0);
  const expected = controller.state.results[0];
  const selected = controller.selectActive();
  assert.equal(selected, expected);
  assert.equal(controller.state.selected, expected);
  assert.equal(controller.state.popupOpen, false);
});

test("active selection has no hidden first-result fallback", async () => {
  const { clock, controller } = createController(async () =>
    response(200, [rawRow()]),
  );
  controller.inputChanged("1 Por");
  clock.tick(300);
  await flush();
  controller.updateState({ activeIndex: -1 });

  assert.equal(controller.selectActive(), null);
  assert.equal(controller.state.selected, null);
  assert.equal(controller.state.popupOpen, true);
});

test("Enter selection does nothing when suggestions are not open", () => {
  const { controller } = createController(async () => response(200, []));
  assert.equal(controller.selectActive(), null);
  assert.equal(controller.state.phase, "idle");
  assert.equal(controller.state.selected, null);
});

test("selection remains closed on later input activation", async () => {
  let calls = 0;
  const { clock, controller, states } = createController(async () => {
    calls += 1;
    return response(200, [rawRow()]);
  });
  controller.inputChanged("1 Por");
  clock.tick(300);
  await flush();
  controller.select(0);
  const stateCount = states.length;

  assert.equal(controller.activateInput(), false);
  assert.equal(controller.state.phase, "selected");
  assert.equal(controller.state.popupOpen, false);
  assert.equal(controller.state.results.length, 0);
  assert.equal(calls, 1);
  assert.equal(states.length, stateCount);
});

test("outside dismissal preserves the selected result state", async () => {
  const { clock, controller, states } = createController(async () =>
    response(200, [rawRow()]),
  );
  controller.inputChanged("1 Por");
  clock.tick(300);
  await flush();
  controller.select(0);
  const selectedState = controller.state;
  const stateCount = states.length;

  controller.dismiss();

  assert.equal(controller.state, selectedState);
  assert.equal(controller.state.phase, "selected");
  assert.match(statusMessage(controller.state), /Election information shown/);
  assert.equal(states.length, stateCount);
});

test("dismissal clears active accessibility state", async () => {
  const { clock, controller } = createController(async () =>
    response(200, [rawRow()]),
  );
  controller.inputChanged("1 Por");
  clock.tick(300);
  await flush();
  controller.moveActive(1);
  controller.dismiss();
  assert.equal(controller.state.activeIndex, -1);
  assert.equal(controller.state.popupOpen, false);
});
