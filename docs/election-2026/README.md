# 2026 Election evidence and Contest proposal

This directory records the reviewed design evidence for Issue #5. It is deliberately limited to documentation, representative raw fixtures, inspectable inventories, and one deterministic offline contract check.

## Artifacts

- [Source register](source-register.md): which official publication establishes each concept, how it was observed, and the limits of its authority.
- [Candidate shape](candidate-shape.md): the minimal Contest-scoped public record proposed for later normalization.
- [`data/election-2026/contests.json`](../../data/election-2026/contests.json): 43 proposed canonical Contests with Number to Elect, aliases, provenance, and Candidate-list coverage.
- [`data/election-2026/source-label-mappings.json`](../../data/election-2026/source-label-mappings.json): every distinct supported Candidate and address Source Label observed on 2026-08-22, mapped to exactly one Contest.
- [`tests/fixtures/election-2026/city-candidates.json`](../../tests/fixtures/election-2026/city-candidates.json): representative unmodified City Candidate rows plus the complete observed Candidate-label inventory.
- [`tests/fixtures/election-2026/city-addresses.json`](../../tests/fixtures/election-2026/city-addresses.json): representative unmodified City address rows plus the complete observed Electoral Assignment label inventory.
- [`tests/election-inventory-contract.test.mjs`](../../tests/election-inventory-contract.test.mjs): the deterministic acceptance check over those complete artifacts.

## Reviewed findings

- Candidate and address sources use different punctuation, spacing, division names, and ward wording. The mapping file preserves both labels while targeting one canonical Contest.
- A School Division Ward mapping always uses the division and ward together. Repeated labels such as `1` and `Ward 1` are not identities by themselves.
- The address dataset exposes 27 School Division Ward Contests: 25 run by the City plus Seine River Ward 1 and the Rosser portion of Interlake Ward 1.
- Candidate data is supported from the City publication for the Mayor, all Council Wards, and the City's six school divisions. Seine River and Interlake Candidate data is unsupported for the initial implementation and has `availability: "unavailable"` with a `null` count.
- The City Candidate publication was available and contained no Winnipeg School Division Ward 2 records when observed. That is recorded as a published list with a verified count of zero, which is intentionally different from unsupported coverage.
- The grouped address evidence included 200 rows without a complete school assignment, including 10 rows without any electoral labels. These remain explicit unresolved evidence and do not map to invented Contests.

No source fetching, normalization, reconciliation UI, publication flow, site generation, or Address Lookup integration is implemented here.
