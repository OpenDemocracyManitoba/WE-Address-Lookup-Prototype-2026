# Winnipeg election ward lookup prototype

A small, dependency-free address autocomplete for finding a Winnipeg property's City Council ward, school division, and school trustee ward.

## Run it

The files are plain HTML, CSS, and JavaScript. Open `index.html` directly, or serve this directory with any static file server. For example, if Python is available:

```text
python -m http.server 8000
```

Then open `http://localhost:8000`.

## How the lookup works

After the user enters a street number and at least three street-name characters, the page waits 300 ms and calls the City of Winnipeg [Addresses dataset](https://data.winnipeg.ca/resource/cam2-ii3u.json) directly with `fetch()`. Three characters is also the length of the shortest street names currently present in the dataset. Selecting one of the returned official addresses displays:

- the official City-formatted address;
- `ward_as_of_september_17` as the City Council ward;
- `school_division` and `school_division_ward` as the school trustee result.

The older `ward` field is neither requested nor displayed.

## Socrata query strategy

Every request uses `$select`, `$where`, `$group`, `$limit=11`, and `$order`. The filter requires an exact `street_number` plus a prefix match on `street_name`. It adds exact street-type and direction filters only when the user supplied those optional parts. Grouping collapses apartment and condo units that share one civic address. The eleventh result is used only to detect that more than 10 addresses match; the interface then asks the user to keep typing rather than silently implying the list is complete.

The current live dataset exposes the unit-free official civic address as `street_address`, although the original prototype brief referred to `display_address`. The query uses Socrata's `street_address as display_address` alias. The displayed value therefore still comes from the City's official field and is never copied from the user's input. Unit-level `full_address` values are intentionally not used because election wards are determined by the civic address.

Requests are debounced. An `AbortController` cancels superseded calls, and a sequence check prevents a stale response from replacing newer suggestions. User text is normalized to a restricted address-character set and apostrophes are escaped before values are placed in the SoQL expression. `URLSearchParams` handles URL encoding.

## Forgiving address parsing

Input is case-insensitive and repeated whitespace is collapsed. The parser separates:

1. a required street number;
2. a required street-name prefix;
3. an optional street type;
4. an optional `N`, `S`, `E`, or `W` direction.

All street types and aliases specified in the brief are normalized to City abbreviations. For example, `place` becomes `PL`, `boulevard` becomes `BLVD`, `parc` becomes `PK`, and `terrasse` becomes `TERR`. If the type is omitted, no type condition is added, so `1 Portage`, `1 Portage Ave`, and `1 Portage Avenue` can find the same record.

A lone letter after the number is treated as the beginning of a street name rather than as a direction, but the API request waits until three street-name characters are entered. For example, `1 Po` does not query yet, while `1 Por` searches for streets beginning with POR.

## Privacy

The browser sends the parsed address terms only to the City of Winnipeg Open Data API. The prototype has no backend, analytics, cookies, local storage, or third-party application dependencies, and it does not retain the address.

## Prototype limitations

- Availability and accuracy depend on the City dataset and Socrata service.
- Up to 10 alphabetical prefix matches are displayed for one exact street number. When more matches exist, the interface explicitly asks the user to keep typing.
- Unit or apartment numbers are intentionally not parsed; the civic street address is what determines the displayed wards.
- The City API may omit ward information for some records. The interface reports missing values as `Not available`.
