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

No dependency installation or build step is required.

## City data and field choices

Searches go directly from the browser to the City of Winnipeg Open Data Socrata endpoint:

`https://data.winnipeg.ca/resource/cam2-ii3u.json`

The query aliases authoritative `street_address` to `display_address`. It does not request `full_address`, because that field includes unit-level apartment and condominium records. It uses `ward_as_of_september_17` for City Council rather than the legacy `ward` field. The school result comes from `school_division` and `school_division_ward`.

Each request selects and groups only these civic and election fields: `street_address`, `street_number`, `street_number_suffix`, `street_name`, `street_type`, `street_direction`, `school_division`, `school_division_ward`, and `ward_as_of_september_17`. Grouping the complete tuple collapses duplicate unit rows into one civic suggestion while preserving rows whose official election values conflict. The client deduplicates only identical authoritative tuples and applies a stable final sort.

### Known Regent trustee-ward conflict

The City dataset returns two authoritative grouped records for `1615 REGENT AVE W`. Both records have the same municipal ward, but their school trustee values are **Ward 1** and **Ward 2**. The address is a shopping-centre property with zero dwelling units, and its underlying units span the two trustee wards. Because school-trustee voters must reside in the ward, no eligible 2026 voter can live at this address and receive the wrong trustee ward from this conflict.

The prototype intentionally preserves both City records in deterministic order. It does not invent a preferred record or add address-specific resolution logic. Unique-address grouping or a dedicated conflict presentation remains a possible future product enhancement if a conflict with consequences for eligible voters is discovered.

## Parsing and query behavior

Input is trimmed, internal whitespace is collapsed, common curly apostrophes are normalized, and comparisons are uppercase. Supported periods, apostrophes, hyphens, slashes, letters, and digits remain intact. Unsupported query punctuation and control characters are neutralized. Every SoQL string literal doubles apostrophes, and `URLSearchParams` encodes `$select`, `$where`, `$group`, and `$order`.

A query requires a numeric civic number and at least three alphanumeric street-name characters. Live validation on August 10, 2026 found that the shortest current official street names contain three characters, so the threshold keeps every current street searchable. Punctuation and whitespace do not count toward it.

Civic suffixes are kept separate from the numeric number. Compact `3A` and spaced `3 A` input can query `street_number = 3` and `street_number_suffix = A`; `1/2` and `1/2A` forms are handled the same way. When a spaced token is also a plausible street-name start, the parser creates a bounded suffix reading and literal-name reading. If no suffix is supplied, the query leaves suffix unrestricted.

All current official street types are recognized in trailing position, with conservative long-form aliases such as `avenue` to `AVE`, `street` to `ST`, `park`/`parc` to `PK`, and `terrace`/`terrasse` to `TERR`. A period on a trailing type such as `Ave.` is ignored, while periods in names such as `DR. DAVID FRIESEN` are preserved. Current directions are `N`, `S`, `E`, `W`, `NW`, and `SW`.

Tail parsing generates a small immutable candidate set instead of destructively removing tokens. A recognized trailing type, or type plus direction, keeps the established structured interpretation first and adds at most one literal full-tail street-name fallback. This allows names ending in type-like words, such as `ASSINIBOINE PARK` and `COURT`, without adding address-specific exceptions. Identical candidates are deduplicated. Combined with the two bounded civic-suffix readings, any input produces at most four candidates.

A direction after an explicit type is unambiguous. A trailing direction-like token without a type produces at most two direction interpretations: literal street name first, then a direction-filtered reading. This lets `50 Wildwood E` find the literal `WILDWOOD E` name while `1000 Garfield N` can find `GARFIELD ST N`. With `50 Wildwood E Park`, `E` remains part of the name and `Park` maps to `PK`.

The SoQL predicate holds `street_number` as an exact numeric comparison outside the bounded alternatives. Each alternative uses a case-insensitive `street_name` prefix and only adds exact suffix, type, or direction filters when supplied. Results are grouped by every selected source field and deterministically ordered. No result limit is imposed, so every grouped result from the complete exact-number/prefix query is displayed.

## Autocomplete behavior

Eligible input is debounced for 300 ms. Every edit cancels the debounce, aborts an active Fetch request, clears its timeout, increments the request generation, and removes stale UI. Responses must match both the current generation and normalized input before they can render. Requests time out after 10 seconds, which bounds a slow City service without making normal API latency overly fragile.

Escape, Tab, and deliberate outside interaction cancel pending work, invalidate completion, close the popup, clear the active option, and reset list scrolling. Completed results for unchanged input may remain in a one-input memory cache and reopen on refocus; selection clears that cache. Nothing is written to cookies, local storage, session storage, analytics, or telemetry.

The input implements the standard combobox/listbox pattern. Arrow keys wrap through options while DOM focus stays on the input; Enter selects the active option, Escape dismisses, and Tab follows normal focus order. No option is active until keyboard navigation begins. Pointer and touch use native click activation, never `pointerdown`; selecting by pointer blurs the input so a soft keyboard can close. After selection, the existing atomic live status announces the official address, City Council ward, school division, and trustee ward while keyboard focus remains on the combobox. Missing values use the same `Not available` labels as the visible result.

The popup is scrollable with contained overscroll, vertical touch panning, and momentum scrolling where supported. It measures usable visual-viewport space above and below the input, opens on the better side, and constrains its height to that space. Results, replacement, and closure reset the list to the top. Narrow and short-landscape styles prevent horizontal overflow and preserve room for the list.

## Errors and limitations

The interface distinguishes insufficient input, loading, no results, invalid searches (HTTP 400), a busy service (429), temporary server errors (5xx), timeouts, network/CORS failures, malformed JSON, and unexpected non-array payloads. Superseded or intentionally aborted work is silent.

Transient service, timeout, transport, and unexpected-payload errors display a native **Retry address search** button. Retry immediately reruns the unchanged eligible input through the controller's normal request path, including generation validation, cancellation, timeout, and stale-response protection, then returns focus to the combobox. The control is hidden for HTTP 400, insufficient input, successful results, and all other non-applicable states.

This is a browser-only prototype and depends on City endpoint availability and its CORS policy. It accepts civic street addresses only, not unit numbers, postal codes, intersections, geolocation, or free-form place names. It displays the official election values as supplied and does not resolve conflicting grouped records.

## Live-service validation context

The schema and vocabularies were checked against the official endpoint on August 10, 2026. `street_number` remained numeric; all required fields existed; suffixes were blank, `1/2`, `1/2A`, and letters `A` through `N`; street directions were blank, `E`, `N`, `NW`, `S`, `SW`, and `W`; and the official nonblank street types matched the supported type table in `app.js`.

Live browser validation on August 11, 2026 covered the confirmed `ASSINIBOINE PARK` and `COURT` ambiguity cases, established type/direction regressions, compact and spaced suffix parsing, keyboard selection and its complete live announcement, desktop and mobile layouts, constrained list scrolling, and browser console diagnostics.
