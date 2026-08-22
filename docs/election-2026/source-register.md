# Authoritative Source register

Observed 2026-08-22. Authority is concept-specific: no source below is a universal source of truth.

| Source ID | Official source and retrieval | Format | Authority and supported scope | Candidate support |
| --- | --- | --- | --- | --- |
| `city-election-page` | [2026 Municipal Council and School Boards Election](https://www.winnipeg.ca/city-governance/wards-elections/2026-election), browser GET | HTML | Election identity and Election Day, October 28, 2026. | Not a Candidate record source. |
| `city-candidate-publication` | [Registered candidates](https://www.winnipeg.ca/city-governance/wards-elections/2026-election/information-voters/registered-candidates), browser GET and page-script inspection | HTML with client-side JavaScript | The official public presentation and its 2026 dataset query/visibility rule. The page calls registrants “registered candidates”; Winnipeg Election describes them as Prospective Candidates before nominations. | Supported for City-run Mayor, Councillor, and School Trustee Contests. |
| `city-candidate-dataset` | [Election Candidate dataset](https://data.winnipeg.ca/resource/9gi9-dauz.json), Socrata JSON API using the official page's 2026 date and visibility filter | JSON | Official Candidate Record fields, Candidate-provided fields, raw status, Candidate Source Labels, and source record ID. 133 visible 2026 records were observed. | Supported for Mayor, all 15 Council Wards, and the 25 wards in the six school divisions whose elections the City runs. Not authoritative for Seine River or Interlake Candidate availability. |
| `city-address-dataset` | [Addresses dataset](https://data.winnipeg.ca/City-Planning/Addresses/cam2-ii3u/about_data) and [`cam2-ii3u` JSON API](https://data.winnipeg.ca/resource/cam2-ii3u.json), grouped Socrata query | JSON | Electoral Assignments for Civic Addresses: `ward_as_of_september_17`, `school_division`, and `school_division_ward`. 65 distinct combinations were observed. | Not a Candidate source. It establishes that Seine River and Interlake Contests can be applicable without establishing Candidate availability. |
| `city-ward-boundaries` | [Council Ward boundaries](https://www.winnipeg.ca/city-governance/wards-elections/2026-election/ward-boundaries), browser GET | HTML and linked PDFs | The 15 2026 Council Ward names and structure; the page states one Councillor is elected per ward. | Not a Candidate source. |
| `city-school-ward-boundaries` | [School Division Ward boundaries](https://www.winnipeg.ca/city-governance/wards-elections/2026-election/school-division-ward-boundaries), browser GET | HTML and linked maps | The ward structure and Number to Elect for the six school divisions whose elections the City runs. | Not a Candidate record source. Its 25 Contests are covered by the City Candidate publication. |
| `seine-river-governance` | [Seine River governance](https://www.srsd.ca/Governance), browser GET | HTML | Seine River has three wards and three trustees per ward, establishing Number to Elect for Ward 1 returned by Winnipeg addresses. | Unsupported for the initial implementation. The division's separate Candidate source is out of scope. |
| `interlake-ward-boundaries` | [Interlake Division profile and ward map](https://www.interlakesd.ca/about/division-profile/), browser GET and linked PDF | HTML and PDF | The official Interlake ward structure; Rosser is within Ward 1. | Unsupported for the initial implementation. |
| `interlake-board-record` | [Interlake 2026–2027 budget record](https://www.interlakesd.ca/wp-content/uploads/2026/03/2026-2027-FINAL-Budget-at-a-Glance-.pdf), browser GET | PDF | The current board record lists two Ward 1 trustees, used as the proposed Number to Elect together with the official ward map. | Unsupported for the initial implementation; no Interlake Candidate list is claimed. |

## Candidate-source observations

The City Candidate dataset exposed all three record shapes (`Mayor`, `Councillor`, and `School Trustee`) and only the raw status `Registered` on the observation date. At least one withdrawn registration still used `candidate_status: "Registered"` and appended `- WITHDRAWN` to `name`; later normalization must preserve both raw values and interpret the conflict explicitly.

The schema publishes `phone`, `email`, `website`, `facebook`, `twitter`, `linkedin`, `instagram`, `biography`, `biography_francais`, `image`, and two disclosure file/link pairs. The current 133 rows populated contact, campaign, and social fields, but populated no biography, image, or disclosure fields. Their absence in this observation is not evidence that the schema or later nominated data will omit them.

The schema also publishes `official_agent` and `auditor`. Those administrative fields appeared in 62 records and are source evidence, but Issue #2 excludes them from the public Candidate shape.

## Coverage and unresolved evidence

Candidate-list availability is independent of Candidate count. The City registered-candidates publication is treated as Published coverage for every Contest the City runs, including a verified zero current records for Winnipeg School Division Ward 2. Seine River Ward 1 and Interlake Ward 1 are unsupported and Unavailable; their Candidate count is unknown, not zero.

Address rows missing one or more Electoral Assignment fields remain visible in the address fixture's `unresolvedFindings`. No blank, unknown, or conflicting label is guessed into a Contest.
