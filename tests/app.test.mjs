import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  API_ENDPOINT,
  buildQuery,
  dedupeAndSortNormalizedRows,
  escapeSoqlLiteral,
  formatCouncilWard,
  formatSchoolTrustee,
  formatTrusteeWard,
  isSearchEligible,
  normalizeAuthoritativeRow,
  normalizeRawAuthoritativeRows,
  normalizeInput,
  parseAddress,
} from "../address-data.js";
import {
  LookupController,
  errorPhaseForStatus,
  isRetryablePhase,
  statusMessage,
} from "../lookup-controller.js";

function candidate(input, index = 0) {
  const parsed = parseAddress(input);
  assert.equal(parsed.eligible, true, `${input} should be eligible`);
  return parsed.candidates[index];
}

function queryParts(input) {
  const parsed = parseAddress(input);
  const url = new URL(buildQuery(parsed.candidates));
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
  Object.freeze(rawRow({
    display_address: "1615 REGENT AVE W",
    street_number: "1615",
    street_name: "REGENT",
    street_type: "AVE",
    street_direction: "W",
    school_division: "River East - Transcona",
    school_division_ward: "1",
    ward_as_of_september_17: "Elmwood - East Kildonan",
  })),
  Object.freeze(rawRow({
    display_address: "1615 REGENT AVE W",
    street_number: "1615",
    street_name: "REGENT",
    street_type: "AVE",
    street_direction: "W",
    school_division: "River East - Transcona",
    school_division_ward: "2",
    ward_as_of_september_17: "Elmwood - East Kildonan",
  })),
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
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
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

test("normalization trims, collapses whitespace, uppercases, and normalizes apostrophes", () => {
  assert.equal(normalizeInput("  12   d’Arcy  "), "12 D'ARCY");
  assert.equal(normalizeInput("1 o‘connor"), "1 O'CONNOR");
});

test("normalization preserves supported hyphens, slashes, apostrophes, and periods", () => {
  assert.equal(normalizeInput("1 Dr. David-Friesen 1/2"), "1 DR. DAVID-FRIESEN 1/2");
});

test("normalization neutralizes controls and unsupported query punctuation", () => {
  assert.equal(normalizeInput("1 POR%\u0000_TA;GE"), "1 POR TA GE");
});

test("eligibility enforces a number and three alphanumeric street-name characters", () => {
  for (const value of ["1", "1 ", "1 P", "1 Po", "1 .-'", "Portage"]) {
    assert.equal(isSearchEligible(value), false, value);
  }
  assert.equal(isSearchEligible("1 Por"), true);
  assert.equal(isSearchEligible("1 P-O-R"), true);
});

test("eligibility accepts the safe-integer boundary and rejects larger civic numbers", () => {
  const largestSafe = parseAddress("9007199254740991 Main");
  assert.equal(largestSafe.eligible, true);
  assert.equal(largestSafe.streetNumber, Number.MAX_SAFE_INTEGER);

  for (const input of ["9007199254740992 Main", "99999999999999999999 Main"]) {
    const parsed = parseAddress(input);
    assert.equal(parsed.eligible, false, input);
    assert.equal(parsed.streetNumber, null, input);
    assert.deepEqual(parsed.candidates, [], input);
  }
});

test("ordinary addresses parse into exact structured fields", () => {
  assert.deepEqual(candidate("1 Portage"), {
    streetNumber: 1, streetNumberSuffix: null, streetName: "PORTAGE",
    streetType: null, streetDirection: null,
  });
  assert.deepEqual(candidate("510 Main St"), {
    streetNumber: 510, streetNumberSuffix: null, streetName: "MAIN",
    streetType: "ST", streetDirection: null,
  });
  assert.deepEqual(candidate("510 Main Street"), candidate("510 Main St"));
  assert.deepEqual(candidate("1 Portage Avenue"), candidate("1 Portage Ave"));
});

test("recognized trailing types preserve one bounded literal street-name fallback", () => {
  const parsed = parseAddress("300 Assiniboine Park");
  assert.equal(parsed.candidates.length, 2);
  assert.deepEqual(parsed.candidates.map((item) => ({
    streetName: item.streetName,
    streetType: item.streetType,
    streetDirection: item.streetDirection,
  })), [
    { streetName: "ASSINIBOINE", streetType: "PK", streetDirection: null },
    { streetName: "ASSINIBOINE PARK", streetType: null, streetDirection: null },
  ]);
  assert.equal(Object.isFrozen(parsed.candidates), true);
  assert.equal(parsed.candidates.every(Object.isFrozen), true);
});

test("confirmed PARK and COURT partial, ambiguous, and explicit-type inputs stay eligible", () => {
  for (const input of [
    "300 Ass",
    "300 Assiniboine Park",
    "300 Assiniboine Park Dr",
    "1021 Cou",
    "1021 Court",
    "1021 Court Ave",
  ]) {
    assert.equal(parseAddress(input).eligible, true, input);
  }
  assert.deepEqual(parseAddress("1021 Court").candidates.map((item) => [
    item.streetName, item.streetType,
  ]), [["COURT", null]]);

  const parkWhere = queryParts("300 Assiniboine Park").where;
  assert.match(parkWhere, /upper\(street_name\) like 'ASSINIBOINE%'.*upper\(street_type\) = 'PK'/);
  assert.match(parkWhere, /upper\(street_name\) like 'ASSINIBOINE PARK%'/);
});

test("explicit street type and direction are parsed only from trailing positions", () => {
  assert.deepEqual(parseAddress("1000 Garfield Street N").candidates.map((item) => [
    item.streetName, item.streetType, item.streetDirection,
  ]), [
    ["GARFIELD", "ST", "N"],
    ["GARFIELD STREET N", null, null],
  ]);
  assert.equal(candidate("1 Dr. David Friesen Dr").streetName, "DR. DAVID FRIESEN");
  assert.equal(candidate("1 Dr. David Friesen Dr").streetType, "DR");
  assert.equal(candidate("1 Portage Ave.").streetType, "AVE");
});

test("current ALLEY, BEND, and NW grammar fixtures parse", () => {
  assert.equal(candidate("10 ADARA ALLEY").streetType, "ALLEY");
  assert.equal(candidate("100 BRIXHAM BEND").streetType, "BEND");
  assert.deepEqual(candidate("29 SERVICE 3 ST NW"), {
    streetNumber: 29, streetNumberSuffix: null, streetName: "SERVICE 3",
    streetType: "ST", streetDirection: "NW",
  });
});

test("compact civic suffix is separated from numeric street number", () => {
  const parsed = parseAddress("3A ELKHORN ST");
  assert.equal(parsed.candidates[0].streetNumber, 3);
  assert.equal(parsed.candidates[0].streetNumberSuffix, "A");
  assert.equal(parsed.candidates[0].streetName, "ELKHORN");
});

test("spaced letter suffix produces bounded suffix and street-name readings", () => {
  const parsed = parseAddress("3 A ELKHORN ST");
  assert.deepEqual(parsed.candidates.map((item) => [
    item.streetNumberSuffix, item.streetName, item.streetType,
  ]), [
    ["A", "ELKHORN", "ST"],
    ["A", "ELKHORN ST", null],
    [null, "A ELKHORN", "ST"],
    [null, "A ELKHORN ST", null],
  ]);
});

test("1/2 and 1/2A suffix forms parse in compact and spaced forms", () => {
  assert.equal(candidate("371/2 LIPTON ST").streetNumberSuffix, "1/2");
  assert.equal(candidate("891/2A BRAEMAR AVE").streetNumberSuffix, "1/2A");
  assert.equal(candidate("891/2A BRAEMAR AVE").streetNumber, 89);
  assert.deepEqual(parseAddress("37 1/2 LIPTON ST").candidates.map((item) => [
    item.streetNumberSuffix, item.streetName, item.streetType,
  ]), [
    ["1/2", "LIPTON", "ST"],
    ["1/2", "LIPTON ST", null],
    [null, "1/2 LIPTON", "ST"],
    [null, "1/2 LIPTON ST", null],
  ]);
  assert.deepEqual(parseAddress("89 1/2 A BRAEMAR AVE").candidates.map((item) => [
    item.streetNumberSuffix, item.streetName, item.streetType,
  ]), [
    ["1/2A", "BRAEMAR", "AVE"],
    ["1/2A", "BRAEMAR AVE", null],
    [null, "1/2 A BRAEMAR", "AVE"],
    [null, "1/2 A BRAEMAR AVE", null],
  ]);
});

test("omitted suffix adds no suffix restriction", () => {
  const { where } = queryParts("3 Elkhorn");
  assert.doesNotMatch(where, /street_number_suffix/);
});

test("direction-like trailing token without type yields literal-first ambiguity", () => {
  const parsed = parseAddress("50 Wildwood E");
  assert.equal(parsed.candidates.length, 2);
  assert.deepEqual(parsed.candidates.map((item) => [item.streetName, item.streetDirection]), [
    ["WILDWOOD E", null], ["WILDWOOD", "E"],
  ]);
  const garfield = parseAddress("1000 Garfield N");
  assert.deepEqual(garfield.candidates.map((item) => [item.streetName, item.streetDirection]), [
    ["GARFIELD N", null], ["GARFIELD", "N"],
  ]);
});

test("direction remains in street name when an explicit trailing type follows", () => {
  assert.deepEqual(candidate("50 Wildwood E Park"), {
    streetNumber: 50, streetNumberSuffix: null, streetName: "WILDWOOD E",
    streetType: "PK", streetDirection: null,
  });
});

test("SoQL escaping doubles every apostrophe", () => {
  assert.equal(escapeSoqlLiteral("O'BRIEN'S"), "O''BRIEN''S");
});

test("query has exact numeric number, prefix match, and optional filters", () => {
  const { url, where } = queryParts("1000 Garfield Street N");
  assert.equal(url.origin + url.pathname, API_ENDPOINT);
  assert.match(where, /^street_number = 1000 AND/);
  assert.match(where, /upper\(street_name\) like 'GARFIELD%'/);
  assert.match(where, /upper\(street_type\) = 'ST'/);
  assert.match(where, /upper\(street_direction\) = 'N'/);
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
  for (const key of ["$select", "$where", "$group", "$order"]) assert.ok(url.searchParams.has(key));
  assert.match(url.searchParams.get("$select"), /street_address as display_address/);
  assert.match(url.searchParams.get("$group"), /street_number_suffix/);
  const all = [...url.searchParams.values()].join(" ");
  assert.doesNotMatch(all, /full_address/);
  assert.doesNotMatch(all, /(?:^|,)ward(?:,|$)/);
  assert.match(all, /ward_as_of_september_17/);
  assert.equal(url.searchParams.has("$limit"), false);
});

test("ambiguous candidates are combined in candidate order with duplicates removed", () => {
  const { parsed, where } = queryParts("50 Wildwood E");
  assert.equal(parsed.candidates.length, 2);
  assert.equal((where.match(/ OR /g) || []).length, 1);
  assert.match(where, /WILDWOOD E%/);
  assert.match(where, /street_direction\) = 'E'/);
  assert.ok(where.indexOf("WILDWOOD E%") < where.indexOf("WILDWOOD%"));

  const duplicateUrl = new URL(buildQuery([
    parsed.candidates[0],
    parsed.candidates[1],
    parsed.candidates[0],
  ]));
  const duplicateWhere = duplicateUrl.searchParams.get("$where");
  assert.equal((duplicateWhere.match(/ OR /g) || []).length, 1);
  assert.ok(duplicateWhere.indexOf("WILDWOOD E%") < duplicateWhere.indexOf("WILDWOOD%"));
});

test("authoritative row uses the official display alias, not input", () => {
  const row = normalizeAuthoritativeRow(rawRow());
  assert.equal(row.displayAddress, "1 PORTAGE AVE E");
  assert.equal(row.streetNumber, 1);
  assert.equal(row.councilWard, "Fort Rouge - East Fort Garry");
});

test("raw authoritative rows normalize aliases, trimming, and missing values", () => {
  const row = normalizeAuthoritativeRow(rawRow({
    display_address: undefined,
    street_address: "  1 PORTAGE AVE E  ",
    street_number: 1,
    street_number_suffix: " ",
    street_name: "  PORTAGE ",
    ward_as_of_september_17: null,
  }));
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

test("malformed raw authoritative rows are rejected", () => {
  assert.deepEqual(normalizeRawAuthoritativeRows([
    null,
    [],
    {},
    rawRow({ display_address: " ", street_address: undefined }),
    rawRow({ street_number: "not numeric" }),
    rawRow(),
  ]), [normalizeAuthoritativeRow(rawRow())]);
});

test("identical grouped rows collapse but conflicting election tuples remain", () => {
  const first = normalizeAuthoritativeRow(rawRow());
  const conflict = normalizeAuthoritativeRow(rawRow({ school_division_ward: "6" }));
  const rows = dedupeAndSortNormalizedRows([first, { ...first }, conflict]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.schoolDivisionWard), ["5", "6"]);
});

test("1615 REGENT AVE W intentionally retains both trustee wards in deterministic order", () => {
  const normalized = REGENT_TRUSTEE_CONFLICT_ROWS.map(normalizeAuthoritativeRow);
  assert.equal(normalized.every(Boolean), true);

  const rows = dedupeAndSortNormalizedRows([normalized[1], normalized[0], { ...normalized[0] }]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.displayAddress), [
    "1615 REGENT AVE W",
    "1615 REGENT AVE W",
  ]);
  assert.deepEqual(rows.map((row) => row.councilWard), [
    "Elmwood - East Kildonan",
    "Elmwood - East Kildonan",
  ]);
  assert.deepEqual(rows.map((row) => row.schoolDivisionWard), ["1", "2"]);
  // This zero-dwelling shopping-centre address cannot house an eligible trustee voter,
  // so preserving both City tuples is more accurate than inventing a resolution.
});

test("merged ambiguous results sort literal interpretation first and remain stable", () => {
  const candidates = parseAddress("50 Wildwood E").candidates;
  const normalizedRows = normalizeRawAuthoritativeRows([
    rawRow({ display_address: "50 WILDWOOD ST E", street_number: "50", street_name: "WILDWOOD", street_type: "ST", street_direction: "E" }),
    rawRow({ display_address: "50 WILDWOOD E PK", street_number: "50", street_name: "WILDWOOD E", street_type: "PK", street_direction: undefined }),
  ]);
  const rows = dedupeAndSortNormalizedRows(normalizedRows, candidates);
  assert.deepEqual(rows.map((row) => row.displayAddress), ["50 WILDWOOD E PK", "50 WILDWOOD ST E"]);
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
  assert.equal(formatSchoolTrustee(null, null), "Not available — Not available");
  assert.equal(normalizeAuthoritativeRow(rawRow({ ward_as_of_september_17: null })).councilWard, null);
});

test("selected-result status announces the official address and visible election values", () => {
  const selected = normalizeAuthoritativeRow(rawRow());
  assert.equal(
    statusMessage({ phase: "selected", selected }),
    "Election information shown for 1 PORTAGE AVE E. City Council: Fort Rouge - East Fort Garry. School Trustee: Winnipeg — Ward 5.",
  );
});

test("selected-result status represents missing values like the visible result", () => {
  const selected = normalizeAuthoritativeRow(rawRow({
    ward_as_of_september_17: null,
    school_division: null,
    school_division_ward: null,
  }));
  assert.equal(
    statusMessage({ phase: "selected", selected }),
    "Election information shown for 1 PORTAGE AVE E. City Council: Not available. School Trustee: Not available — Not available.",
  );
});

test("header copy, address description, and help markup match the interface", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(html, /<p class="eyebrow">Winnipeg 2026 Civic and School Trustee Election<\/p>/);
  assert.match(html, /<h1 id="page-title">Find Your Election Wards<\/h1>/);
  assert.match(html, /aria-describedby="address-status"/);
  assert.doesNotMatch(html, /id="address-help"/);
  assert.doesNotMatch(css.match(/h1\s*{[^}]*}/)?.[0] ?? "", /max-width\s*:/);
  assert.doesNotMatch(css.match(/\.lede\s*{[^}]*}/)?.[0] ?? "", /max-width\s*:/);
});

test("retry control markup is a hidden native button alongside the single live status", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<button class="retry-button" id="retry-button" type="button" hidden>\s*Retry address search\s*<\/button>/);
  assert.equal((html.match(/role="status"/g) || []).length, 1);
});

test("HTTP outcomes map to distinct phases and user messages", () => {
  assert.equal(errorPhaseForStatus(400), "error400");
  assert.equal(errorPhaseForStatus(429), "error429");
  assert.equal(errorPhaseForStatus(503), "errorServer");
  assert.match(statusMessage({ phase: "error400" }), /could not be searched/);
  assert.match(statusMessage({ phase: "error429" }), /busy/);
  assert.match(statusMessage({ phase: "errorServer" }), /temporarily unavailable/);
  assert.match(statusMessage({ phase: "errorNetwork" }), /could not be reached/);
});

test("only transient service, transport, timeout, and payload failures are retryable", () => {
  for (const phase of ["error429", "errorServer", "errorTimeout", "errorNetwork", "errorUnexpected"]) {
    assert.equal(isRetryablePhase(phase), true, phase);
  }
  for (const phase of ["error400", "guidance", "loading", "empty", "results", "selected"]) {
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
  assert.match(new URL(calls[0]).searchParams.get("$where"), /street_number = 1/);
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
  requests[0].resolve(response(200, [rawRow({ display_address: "15 MARION ST", street_number: "15", street_name: "MARION", street_type: "ST" })]));
  await flush();
  assert.equal(controller.state.results.length, 1);
  assert.equal(controller.state.results[0].displayAddress, "1 PORTAGE AVE E");
});

test("timeout aborts and exits loading with retry guidance", async () => {
  const { clock, controller } = createController((url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }));
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
    json: () => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
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
  const { clock, controller } = createController(async () => response(200, [
    null,
    {},
    rawRow({ display_address: " ", street_address: undefined }),
    rawRow({ street_number: "not numeric" }),
  ]));

  controller.inputChanged("1 Por");
  clock.tick(300);
  await flush();
  assert.equal(controller.state.phase, "empty");
  assert.equal(controller.state.results.length, 0);
  assert.equal(controller.state.popupOpen, false);
});

for (const [name, fetchFn, expected] of [
  ["HTTP 400", async () => response(400, []), "error400"],
  ["HTTP 429", async () => response(429, []), "error429"],
  ["HTTP 5xx", async () => response(503, []), "errorServer"],
  ["network failure", async () => { throw new TypeError("offline"); }, "errorNetwork"],
  ["non-array payload", async () => response(200, { error: true }), "errorUnexpected"],
  ["malformed JSON", async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } }), "errorUnexpected"],
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

test("retry refuses non-retryable or no-longer-eligible state", async () => {
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
  retriedRequest.resolve(response(200, [rawRow({
    display_address: "15 MARION ST",
    street_number: "15",
    street_name: "MARION",
    street_type: "ST",
  })]));
  await flush();
  assert.equal(controller.state.results.length, 1);
  assert.equal(controller.state.results[0].displayAddress, "1 PORTAGE AVE E");
});

test("outside dismissal during debounce prevents reopening", () => {
  let calls = 0;
  const { clock, controller } = createController(async () => { calls += 1; return response(200, []); });
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
  assert.equal(controller.state.activeIndex, -1);
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
  controller.selectActiveOrFirst();

  assert.deepEqual(states.map((state) => state.phase), [
    "pending",
    "loading",
    "results",
    "selected",
  ]);
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
  assert.equal(resultsState.activeIndex, -1);
  assert.equal(controller.state.activeIndex, 0);
  assert.equal(states.at(-1), controller.state);
});

test("keyboard navigation starts only on demand, wraps, and selection keeps official row", async () => {
  const second = rawRow({ display_address: "1 PORTAGE AVE", street_direction: undefined });
  const { clock, controller } = createController(async () => response(200, [rawRow(), second]));
  controller.inputChanged("1 Por");
  clock.tick(300);
  await flush();
  assert.equal(controller.state.activeIndex, -1);
  controller.moveActive(-1);
  assert.equal(controller.state.activeIndex, 1);
  controller.moveActive(1);
  assert.equal(controller.state.activeIndex, 0);
  const selected = controller.selectActiveOrFirst();
  assert.equal(controller.state.rawInput, selected.displayAddress);
  assert.equal(controller.state.popupOpen, false);
  assert.equal(controller.state.activeIndex, -1);
  assert.equal(controller.state.results.length, 0);
});

test("Enter selection chooses the first result when no option is active", async () => {
  const second = rawRow({ display_address: "1 PORTAGE AVE", street_direction: undefined });
  const { clock, controller } = createController(async () => response(200, [rawRow(), second]));
  controller.inputChanged("1 Por");
  clock.tick(300);
  await flush();

  assert.equal(controller.state.activeIndex, -1);
  const expected = controller.state.results[0];
  const selected = controller.selectActiveOrFirst();
  assert.equal(selected, expected);
  assert.equal(controller.state.selected, expected);
  assert.equal(controller.state.popupOpen, false);
});

test("Enter selection does nothing when suggestions are not open", () => {
  const { controller } = createController(async () => response(200, []));
  assert.equal(controller.selectActiveOrFirst(), null);
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

test("dismissal clears active accessibility state", async () => {
  const { clock, controller } = createController(async () => response(200, [rawRow()]));
  controller.inputChanged("1 Por");
  clock.tick(300);
  await flush();
  controller.moveActive(1);
  controller.dismiss();
  assert.equal(controller.state.activeIndex, -1);
  assert.equal(controller.state.popupOpen, false);
});
