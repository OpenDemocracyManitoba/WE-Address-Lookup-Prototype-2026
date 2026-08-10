"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildQuery,
  hasEnoughStreetName,
  normalizeInput,
  parseAddress
} = require("../address-search");

function expectedAddress(overrides = {}) {
  return {
    streetNumber: "3",
    streetNumberSuffix: "",
    streetName: "ELKHORN",
    streetType: "ST",
    streetDirection: "",
    ...overrides
  };
}

function queryParamsFor(input) {
  const parsed = parseAddress(input);
  assert.ok(parsed, `Expected "${input}" to parse`);
  return new URL(buildQuery(parsed)).searchParams;
}

test("normalization preserves fractional suffix slashes", () => {
  assert.equal(normalizeInput("  3  1/2a  Elkhorn St. "), "3 1/2A ELKHORN ST");
});

test("parses an ordinary unsuffixed address", () => {
  assert.deepEqual(parseAddress("3 Elkhorn Street"), expectedAddress());
});

test("parses compact and spaced letter suffixes", () => {
  const expected = expectedAddress({ streetNumberSuffix: "A" });

  assert.deepEqual(parseAddress("3A Elkhorn St"), expected);
  assert.deepEqual(parseAddress("3 A Elkhorn St"), expected);
});

test("parses fractional and fractional-letter suffixes", () => {
  assert.deepEqual(
    parseAddress("3 1/2 Elkhorn St"),
    expectedAddress({ streetNumberSuffix: "1/2" })
  );

  const expected = expectedAddress({ streetNumberSuffix: "1/2A" });
  assert.deepEqual(parseAddress("3 1/2A Elkhorn St"), expected);
  assert.deepEqual(parseAddress("3 1/2 A Elkhorn St"), expected);
});

test("does not mistake a street name beginning with a letter for a suffix", () => {
  assert.deepEqual(parseAddress("3 Academy Rd"), {
    streetNumber: "3",
    streetNumberSuffix: "",
    streetName: "ACADEMY",
    streetType: "RD",
    streetDirection: ""
  });
});

test("retains existing type, direction, and minimum-prefix behavior", () => {
  assert.deepEqual(parseAddress("1 Portage Avenue E"), {
    streetNumber: "1",
    streetNumberSuffix: "",
    streetName: "PORTAGE",
    streetType: "AVE",
    streetDirection: "E"
  });
  assert.equal(hasEnoughStreetName("PO"), false);
  assert.equal(hasEnoughStreetName("POR"), true);
});

test("rejects input without a separated street name", () => {
  assert.equal(parseAddress("3A"), null);
  assert.equal(parseAddress("3AELKHORN"), null);
});

test("builds an exact suffixed-address query", () => {
  const params = queryParamsFor("3A Elkhorn St");
  const where = params.get("$where");

  assert.match(where, /(?:^| AND )street_number=3(?: AND |$)/);
  assert.match(where, /(?:^| AND )street_number_suffix='A'(?: AND |$)/);
  assert.match(where, /(?:^| AND )upper\(street_name\) like 'ELKHORN%'(?: AND |$)/);
  assert.match(where, /(?:^| AND )street_type='ST'(?: AND |$)/);
  assert.match(params.get("$select"), /(?:^|,)street_number_suffix(?:,|$)/);
  assert.match(params.get("$group"), /(?:^|,)street_number_suffix(?:,|$)/);
  assert.match(params.get("$select"), /^street_address as display_address,/);
});

test("builds an exact unsuffixed-address query when no suffix is entered", () => {
  const where = queryParamsFor("3 Elkhorn St").get("$where");

  assert.match(where, /(?:^| AND )street_number=3(?: AND |$)/);
  assert.match(where, /(?:^| AND )street_number_suffix is null(?: AND |$)/);
  assert.doesNotMatch(where, /street_number_suffix='/);
});
