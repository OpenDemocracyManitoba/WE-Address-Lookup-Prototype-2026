"use strict";

const API_URL = "https://data.winnipeg.ca/resource/cam2-ii3u.json";
const DISPLAY_LIMIT = 10;
const QUERY_LIMIT = DISPLAY_LIMIT + 1;
const DEBOUNCE_DELAY = 300;
const MIN_STREET_NAME_LENGTH = 3;

// `street_address` is the City's official civic address without apartment or
// condo units. Alias it so the rest of the prototype can consistently use the
// requested `display_address` property.
const SELECT_FIELDS = [
  "street_address as display_address",
  "street_number",
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

const input = document.querySelector("#address-input");
const listbox = document.querySelector("#address-listbox");
const status = document.querySelector("#search-status");
const result = document.querySelector("#result");
const resultAddress = document.querySelector("#result-address");
const councilWard = document.querySelector("#council-ward");
const schoolWard = document.querySelector("#school-ward");

let suggestions = [];
let activeIndex = -1;
let debounceTimer;
let activeRequest;
let requestSequence = 0;
let selectedDisplayAddress = "";
let pointerStart = null;
let pointerMoved = false;

function normalizeInput(value) {
  return value
    .normalize("NFKD")
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, "-")
    .toUpperCase()
    .replace(/[^A-Z0-9' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAddress(value) {
  const normalized = normalizeInput(value);
  const match = normalized.match(/^(\d+[A-Z]?)\s+(.+)$/);

  if (!match) {
    return null;
  }

  const streetNumber = match[1];
  const parts = match[2].split(" ").filter(Boolean);
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

  return { streetNumber, streetName, streetType, streetDirection };
}

function escapeSoqlLiteral(value) {
  return value.replace(/'/g, "''");
}

function hasEnoughStreetName(streetName) {
  return streetName.replace(/[^A-Z0-9]/g, "").length >= MIN_STREET_NAME_LENGTH;
}

function buildQuery(parsed) {
  const clauses = [
    `street_number='${escapeSoqlLiteral(parsed.streetNumber)}'`,
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
    "$limit": String(QUERY_LIMIT),
    "$order": "street_name,street_type,street_direction,street_address"
  });

  return `${API_URL}?${params.toString()}`;
}

function setStatus(message, state = "") {
  status.textContent = message;
  if (state) {
    status.dataset.state = state;
  } else {
    delete status.dataset.state;
  }
}

function closeSuggestions() {
  suggestions = [];
  activeIndex = -1;
  listbox.replaceChildren();
  listbox.hidden = true;
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
}

function setActiveIndex(nextIndex) {
  if (!suggestions.length) {
    return;
  }

  activeIndex = (nextIndex + suggestions.length) % suggestions.length;
  const options = listbox.querySelectorAll('[role="option"]');

  options.forEach((option, index) => {
    option.setAttribute("aria-selected", String(index === activeIndex));
  });

  const activeOption = options[activeIndex];
  input.setAttribute("aria-activedescendant", activeOption.id);
  activeOption.scrollIntoView({ block: "nearest" });
}

function renderSuggestions(addresses) {
  closeSuggestions();
  suggestions = addresses;

  const fragment = document.createDocumentFragment();
  addresses.forEach((address, index) => {
    const option = document.createElement("li");
    option.id = `address-option-${index}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    option.textContent = address.display_address;
    option.addEventListener("click", () => {
      if (pointerMoved) {
        return;
      }

      selectAddress(address);
    });
    fragment.append(option);
  });

  listbox.append(fragment);
  listbox.hidden = false;
  input.setAttribute("aria-expanded", "true");
}

function displayValue(value) {
  return value?.trim() || "Not available";
}

function selectAddress(address) {
  selectedDisplayAddress = address.display_address;
  input.value = address.display_address;
  closeSuggestions();
  setStatus("");

  resultAddress.textContent = address.display_address;
  councilWard.textContent = displayValue(address.ward_as_of_september_17);

  const division = displayValue(address.school_division);
  const trusteeWard = address.school_division_ward?.trim();
  schoolWard.textContent = trusteeWard && division !== "Not available"
    ? `${division} — Ward ${trusteeWard.replace(/^WARD\s+/i, "")}`
    : division;

  result.hidden = false;
}

async function searchAddresses(parsed) {
  activeRequest?.abort();
  activeRequest = new AbortController();
  const sequence = ++requestSequence;
  setStatus("Looking up official City addresses…");

  try {
    const response = await fetch(buildQuery(parsed), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: activeRequest.signal
    });

    if (!response.ok) {
      throw new Error(`City API returned ${response.status}`);
    }

    const addresses = await response.json();
    if (sequence !== requestSequence) {
      return;
    }

    if (!addresses.length) {
      closeSuggestions();
      setStatus("No matching Winnipeg addresses found. Try omitting the street type or entering less of the street name.");
      return;
    }

    const hasMoreMatches = addresses.length > DISPLAY_LIMIT;
    const visibleAddresses = addresses.slice(0, DISPLAY_LIMIT);
    renderSuggestions(visibleAddresses);

    if (hasMoreMatches) {
      setStatus(`Showing the first ${DISPLAY_LIMIT} matching addresses. More matches are available; keep typing to narrow the list.`);
    } else {
      setStatus(`${visibleAddresses.length} matching ${visibleAddresses.length === 1 ? "address" : "addresses"} found. Use the arrow keys or choose one below.`);
    }
  } catch (error) {
    if (error.name === "AbortError" || sequence !== requestSequence) {
      return;
    }

    closeSuggestions();
    setStatus("The City address service could not be reached. Check your connection and try again.", "error");
  }
}

function queueSearch() {
  window.clearTimeout(debounceTimer);
  activeRequest?.abort();
  requestSequence += 1;
  closeSuggestions();

  if (input.value.trim() !== selectedDisplayAddress) {
    selectedDisplayAddress = "";
    result.hidden = true;
  }

  const parsed = parseAddress(input.value);
  if (!parsed) {
    setStatus(input.value.trim() ? "Keep typing: include a street number and the start of a street name." : "");
    return;
  }

  if (!hasEnoughStreetName(parsed.streetName)) {
    setStatus("Keep typing: enter at least three letters of the street name.");
    return;
  }

  setStatus("Waiting for more typing…");
  debounceTimer = window.setTimeout(() => searchAddresses(parsed), DEBOUNCE_DELAY);
}

input.addEventListener("input", queueSearch);

input.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" && suggestions.length) {
    event.preventDefault();
    setActiveIndex(activeIndex + 1);
  } else if (event.key === "ArrowUp" && suggestions.length) {
    event.preventDefault();
    setActiveIndex(activeIndex < 0 ? suggestions.length - 1 : activeIndex - 1);
  } else if (event.key === "Enter" && activeIndex >= 0) {
    event.preventDefault();
    selectAddress(suggestions[activeIndex]);
  } else if (event.key === "Escape") {
    window.clearTimeout(debounceTimer);
    activeRequest?.abort();
    requestSequence += 1;
    closeSuggestions();
    setStatus("");
  }
});

listbox.addEventListener("pointerdown", (event) => {
  pointerStart = { x: event.clientX, y: event.clientY };
  pointerMoved = false;
});

listbox.addEventListener("pointermove", (event) => {
  if (!pointerStart) {
    return;
  }

  const horizontalMove = Math.abs(event.clientX - pointerStart.x);
  const verticalMove = Math.abs(event.clientY - pointerStart.y);
  pointerMoved = pointerMoved || horizontalMove > 8 || verticalMove > 8;
});

function finishPointerGesture() {
  // Keep the movement flag through the click event that follows pointerup.
  window.setTimeout(() => {
    pointerStart = null;
    pointerMoved = false;
  }, 0);
}

listbox.addEventListener("pointerup", finishPointerGesture);
listbox.addEventListener("pointercancel", finishPointerGesture);

document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".combobox-wrap")) {
    closeSuggestions();
  }
});
