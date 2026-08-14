# Winnipeg election ward address lookup

A small, static prototype that maps an official Winnipeg civic street address to its City Council ward, school division, and school trustee ward. It uses only HTML, CSS, JavaScript, browser APIs, and deterministic Node tests.

## Run the prototype

Serve the repository with any basic static HTTP server, then open `index.html` through that server. For example, if Python is available:

```sh
python -m http.server 8000
```

Then visit `http://localhost:8000`. Opening the file directly may be blocked by browser module or cross-origin rules.

Run all deterministic tests with:

```sh
node --test
```

The deterministic suite does not contact the City service. To repeat the live parser and displayed-result audit against the complete current grouped dataset, run:

```sh
node scripts/audit-live-addresses.mjs
```

The audit downloads the complete grouped City dataset and checks the current implementation's recall and displayed results for official addresses, number-and-name input, partial types and directions, long type aliases, and compact, spaced, and split fractional civic-suffix forms. It reports failures, result counts, target ranks, maximum parser candidates, and maximum query length, and exits nonzero if any target is not both recalled and displayed. Run it with `--progressive` to audit every eligible progressive street-name prefix instead of the standard corpora. Because this is a live, exhaustive check, it requires network access and takes substantially longer than `node --test`.

No dependency installation or build step is required.

## City data and field choices

Searches go directly from the browser to the City of Winnipeg Open Data Socrata endpoint:

`https://data.winnipeg.ca/resource/cam2-ii3u.json`

The page footer acknowledges the use of [open data](https://en.wikipedia.org/wiki/Open_data) and links to the [City of Winnipeg Open Government Licence](https://data.winnipeg.ca/open-data-licence).

The query aliases authoritative `street_address` to `display_address`. It does not request `full_address`, because that field includes unit-level apartment and condominium records. It uses `ward_as_of_september_17` for City Council rather than the legacy `ward` field. The school result comes from `school_division` and `school_division_ward`.

Each request selects and groups only these civic and election fields: `street_address`, `street_number`, `street_number_suffix`, `street_name`, `street_type`, `street_direction`, `school_division`, `school_division_ward`, and `ward_as_of_september_17`. Grouping collapses repeated source rows while retaining distinct authoritative tuples for deterministic processing. After normalization and sorting, the client displays only one suggestion per normalized civic address; if multiple City tuples have the same display address, it retains the first deterministic row.

### Known Regent trustee-ward conflict

The City dataset returns two authoritative grouped records for `1615 REGENT AVE W`. Both records have the same municipal ward, but their school trustee values are **Ward 1** and **Ward 2**. The address is a shopping-centre property with zero dwelling units, and its underlying units span the two trustee wards. Because school-trustee voters must reside in the ward, no eligible 2026 voter can live at this address and receive the wrong trustee ward from this conflict.

The prototype shows `1615 REGENT AVE W` once. Its general display-address deduplication retains the first tuple in the normal deterministic sort; there is no Regent-specific resolution code. Because the address has no residential units, choosing between its duplicate trustee records is not useful to this residential lookup. A future conflict affecting an eligible residential address would require an explicit data and product decision.

## Parsing and query behavior

Input is trimmed, internal whitespace is collapsed, common curly apostrophes are normalized, and comparisons are uppercase. Supported periods, apostrophes, hyphens, slashes, letters, and digits remain intact. Unsupported query punctuation and control characters are neutralized. Every SoQL string literal doubles apostrophes, and `URLSearchParams` encodes `$select`, `$where`, `$group`, and `$order`.

A query requires a numeric civic number and at least three alphanumeric street-name characters. Live validation on August 10, 2026 found that the shortest current official street names contain three characters, so the threshold keeps every current street searchable. Punctuation and whitespace do not count toward it.

Civic suffixes are kept separate from the numeric number. Compact `3A` and spaced `3 A` input can query `street_number = 3` and `street_number_suffix = A`; `1/2` and `1/2A` forms are handled the same way. When a spaced token is also a plausible street-name start, the parser creates a bounded suffix reading and literal-name reading. If no suffix is supplied, the query leaves suffix unrestricted.

The parser does not maintain a street-type alias table or direction vocabulary. Instead, it generates a small ordered candidate set by structure alone. For each civic-number and suffix reading, it uses the complete normalized tail first, then removes at most one and two trailing tokens. It keeps only candidates with at least three alphanumeric name characters and removes duplicates. Combined with the two bounded civic-suffix readings, input produces no more than six candidates. Examples:

- `15 MAR` produces `MAR`.
- `15 MARION` produces `MARION`.
- `15 MARION ST` produces `MARION ST`, then `MARION`.
- `15 MARION ST N` produces `MARION ST N`, `MARION ST`, then `MARION`.
- `300 ASSINIBOINE PARK` produces `ASSINIBOINE PARK`, then `ASSINIBOINE`.
- `50 WILDWOOD E` produces `WILDWOOD E`, then `WILDWOOD`.

Each query alternative uses only the exact numeric `street_number`, an optional exact `street_number_suffix`, and a case-insensitive `street_name` prefix. It never constrains `street_type` or `street_direction`. The query builder sends only the shortest required name prefix for each suffix reading, allowing one request to retrieve both literal matches and bounded fallbacks. Candidate order still ranks the most literal and longest interpretation first.

Result presentation keeps broad retrieval from the City service without treating every fallback as an equal suggestion. If normalized input exactly matches an authoritative display address, only that address is shown. Otherwise, authoritative input variants beginning with the complete input are treated as the strongest autocomplete tier; these variants are derived from returned fields and permit a civic suffix or street type to be omitted. This keeps partially entered types, directions, and suffix ambiguity visible without maintaining parser vocabulary. When there are no such completions, only results matching the strongest non-empty structural tier are shown: the fewest trailing-token removals that match any returned row. Weaker fallback tiers are discarded rather than grouped in the interface. For example, `15 LAKE ALBRIN` shows the direct `LAKE ALBRIN%` match without the broader `LAKE%` matches, while `72 EPSOM PLA` still promotes `72 EPSOM PL` because its more literal tiers are empty.

This approach deliberately retains limited civic-suffix parsing. A suffix occurs before the street name and must not be consumed as its prefix; compact and spaced suffix ambiguity can produce bounded alternative readings.

Street suffix, type, and direction fields remain in the selected and grouped City data even though type and direction no longer filter the search. They are part of an official address's identity and support deterministic display. Suggestions are then deduplicated by normalized display address, retaining one deterministic City row when election data contains conflicting tuples for an identical address. Input normalization, SoQL escaping, authoritative-row validation, grouping, deterministic sorting, request cancellation, timeout handling, and combobox accessibility also remain.

The bounded trailing-token fallback assumes the supported input remains a civic street address containing at most a street type and direction after the name. Unit numbers, city or province names, postal codes, intersections, and free-form place names remain out of scope.

The current implementation was audited on August 13, 2026 against 231,369 grouped City records. Final displayed-result recall was complete for official addresses, number-and-name input, partial street types, partial and omitted-type directions, long type aliases, and compact, spaced, and split fractional civic suffixes. Complete official-address input displayed exactly one normalized address in every audited case. Three suffix-omitted inputs intentionally selected an existing exact unsuffixed address instead of also showing a different suffixed address at the same number.

## Autocomplete behavior

Eligible input is debounced for 300 ms. Every edit cancels the debounce, aborts an active Fetch request, clears its timeout, increments the request generation, and removes stale UI. Responses must match both the current generation and normalized input before they can render. Requests time out after 10 seconds, which bounds a slow City service without making normal API latency overly fragile.

Escape, Tab, and deliberate outside interaction cancel pending work, invalidate completion, close the popup, clear the active option, and reset list scrolling. Completed results for unchanged input may remain in a one-input memory cache and reopen when the input receives focus or is clicked while already focused; reopening does not repeat the City request and reactivates the first option while resetting the list scroll position. Selection clears that cache. Nothing is written to cookies, local storage, session storage, analytics, or telemetry.

The input implements the standard combobox/listbox pattern with automatic selection. The first option is visibly and programmatically active whenever non-empty results open, so Enter immediately selects the top result. Arrow keys wrap through options while DOM focus stays on the input; Enter selects only the active option, Escape dismisses, and Tab follows normal focus order. Pointer and touch use native click activation, never `pointerdown`; selecting by pointer blurs the input so a soft keyboard can close. After selection, the existing atomic live status announces the official address, City Council ward, school division, and trustee ward while keyboard focus remains on the combobox. Missing values use the same `Not available` labels as the visible result.

The popup is scrollable with contained overscroll, vertical touch panning, and momentum scrolling where supported. When results first open, it measures usable visual-viewport space above and below the input and chooses the better side. It remembers that side while those results are cached, including after dismissal and reopening, but continues adjusting its maximum height as the visual viewport changes. This prevents keyboard opening or closing from moving the list across the input. New input, selection, or an orientation change clears the remembered side; orientation change also closes the popup. Results, replacement, and closure reset the list to the top. Narrow and short-landscape styles prevent horizontal overflow and preserve room for the list.

## Manual browser accessibility QA

Before a release, serve the prototype as described above and record the browser, device or viewport, screen reader and input method used. Run these checks against the live City service; a check passes when its stated outcome occurs.

- [ ] **Keyboard combobox:** Enter an eligible address query with at least two results. The first option is highlighted as soon as the list opens. Enter selects that option; Up and Down move the highlight and wrap at the ends; Escape closes the list without selecting; and Tab closes the list and follows the browser's normal focus order. Refocus or click the unchanged input to confirm cached results reopen with the first option active.
- [ ] **Screen reader:** With a screen reader running, repeat the keyboard check. The combobox reports that it is expanded, the highlighted option is exposed as the active selected option, and arrowing announces the newly active option. Result-count, error and final election-information status messages are announced once when they change, without duplicate chatter from unchanged state updates.
- [ ] **IME composition:** Enable an IME that uses a composition candidate window and compose text in the address input. Enter and Escape while composition is active affect only the IME; they do not select an address or dismiss the address list. After composition ends, the same keys resume the documented combobox behavior.
- [ ] **Focus visibility and Retry:** Use browser developer tools to block the City request, submit an eligible query and wait for **Retry address search**. Keyboard-focus both the input and Retry button. Each control has a clearly visible focus indicator against the white control surface and the page background; activating Retry returns focus to the input.
- [ ] **Zoom and short landscape:** At 200% and 400% browser zoom, and in a phone-sized landscape viewport no taller than 430 CSS pixels, inspect the page before and after selecting a result. The election eyebrow, heading, instructions, search controls, status/result information and privacy notice remain present, readable and operable; nothing overlaps or is clipped, and vertical page scrolling reaches all substantive content.
- [ ] **Popup during scrolling:** Open a multi-result popup above the input while the on-screen keyboard is visible, then scroll the options so the keyboard closes. The popup remains above the input, its maximum height adjusts to the visual viewport, and scrolling continues normally. Tap an option once and confirm that it is selected and the keyboard closes. Repeat the search, dismiss the popup by tapping elsewhere, then tap the unchanged input while the keyboard opens; cached results reopen on the same side. Rotate the device with the popup open to confirm that the popup closes; tapping the unchanged input reopens cached results with fresh placement.
- [ ] **Notched mobile landscape:** On a notched device or reliable safe-area simulation in landscape, check both orientations with the popup closed and open. With the standard viewport declaration (and no `viewport-fit=cover`), headings, search controls, options, results and the privacy notice remain outside obstructed areas and usable through normal scrolling.
- [ ] **Display-address deduplication:** Search for `1615 REGENT AVE W` and confirm that it appears once even though the City service returns two grouped trustee records for that display address. Select it and confirm that the deterministic retained row produces one complete election result.

## Errors and limitations

The interface distinguishes insufficient input, loading, no results, invalid searches (HTTP 400), a busy service (429), temporary server errors (5xx), timeouts, network/CORS failures, malformed JSON, and unexpected non-array payloads. Superseded or intentionally aborted work is silent.

Transient service, timeout, transport, and unexpected-payload errors display a native **Retry address search** button. Focusing or clicking the input preserves the displayed error without starting another request, including while moving focus between the input and Retry button. Retry immediately reruns the unchanged eligible input through the controller's normal request path, including generation validation, cancellation, timeout, and stale-response protection, then returns focus to the combobox. The control is hidden for HTTP 400, insufficient input, successful results, and all other non-applicable states.

This is a browser-only prototype and depends on City endpoint availability and its CORS policy. It accepts civic street addresses only, not unit numbers, postal codes, intersections, geolocation, or free-form place names. When City records conflict for the same display address, the interface exposes only the first deterministic tuple; it does not explain the conflict or choose a value using domain-specific rules.

## Production-readiness review recommendations

The prototype's parsing, controller, geometry, edge cases, accessibility implementation, and code complexity have already received substantial review. Before producing the final application, prioritize the following additional forms of analysis because they address risks that unit-level correctness review cannot settle.

### 1. Independent election-domain and data audit

Build a reference set that covers every council and trustee ward, boundary properties, civic suffixes, multi-unit properties, missing values, and known conflicts. Have an election-domain expert compare its expected results with an authoritative source independent of the application's normal lookup path.

Turn the current manual schema and vocabulary validation into repeatable checks for required fields, allowed values, dataset freshness, unexpectedly missing election values, and new authoritative conflicts. Define who reviews and resolves an alert before updated data reaches production.

### 2. Production architecture and resilience analysis

Make an explicit choice between direct browser requests, a periodically refreshed static address index, and a caching or proxy service. Compare them on privacy, operational ownership, City-service dependency, CORS exposure, throttling, freshness, latency, and election-day traffic.

Measure representative and worst-case query latency, grouped result counts, and payload sizes. Define synthetic monitoring, alerts, an outage message, and a fallback or recovery policy. Also prove that every eligible grouped query remains below Socrata's documented [default result limit of 1,000](https://dev.socrata.com/docs/paging.html), or implement an explicit limit and paging strategy.

### 3. Privacy, threat-model, and deployment-security review

Document where civic-address query components may be visible or retained, including the City service, browser history and cache, hosting infrastructure, any future proxy, and any future telemetry. Confirm that the visible privacy statement accurately describes the final architecture.

For deployment, review the Content Security Policy, `frame-ancestors`, HSTS, `X-Content-Type-Options`, `Permissions-Policy`, referrer behavior, and cache policy. The current static application has a small attack surface, so a lightweight threat model should be sufficient unless production adds a backend, analytics, administration, or other third-party code.

### 4. Licensing, policy, and election-content review

The footer includes the required City data acknowledgement. A broader policy review should still confirm non-endorsement and official/unofficial presentation, links to authoritative election information, correction and escalation language, applicable bilingual and plain-language expectations, records and privacy requirements, and the response to authoritative data changes during the election period.

### 5. Automated real-browser integration and compatibility testing

Add tests that exercise the actual DOM rendering and event wiring in `app.js`, not only the controller and static source text. Cover Chromium, Firefox, and WebKit behavior for typing, debounce, request cancellation, keyboard and pointer selection, retry, focus transitions, popup positioning, viewport changes, and selected-result rendering.

Keep deterministic mocked browser tests separate from a small live-service smoke test so City-service availability does not make the main suite unreliable.

### 6. Usability and trust testing

Test with representative Winnipeg residents to learn whether people understand "civic address," why unit numbers are excluded, the difference between council and trustee wards, ambiguous autocomplete results, error recovery, and the degree of confidence they place in the result. Include participants using mobile devices and assistive technology.

### Optional supporting analysis

Property-based parser fuzzing, mutation testing, HTML and CSS validation, and static analysis could add useful secondary confidence. They are lower priority than the domain, data, resilience, privacy, policy, browser-integration, and usability work above. Another broad refactoring review, dependency audit, or heavyweight penetration test is unlikely to add comparable value while the application remains a small dependency-free static site.

## Live-service validation context

The schema and source values were checked against the official endpoint on August 13, 2026. `street_number` remained numeric; all required fields existed; suffixes were blank, `1/2`, `1/2A`, and letters `A` through `N`; and street directions were blank, `E`, `N`, `NW`, `S`, `SW`, and `W`. Street-type and direction values are returned for authoritative display and result matching, but the parser does not maintain vocabularies for them.

Earlier live browser validation on August 11, 2026 covered keyboard selection and its complete live announcement, desktop and mobile layouts, constrained list scrolling, and browser console diagnostics. The August 13 dataset audit subsequently validated the current vocabulary-free parser across type-like and direction-like names, partial types and directions, and civic suffix forms. The manual checklist above should be repeated before release against the current result-filtering behavior.
