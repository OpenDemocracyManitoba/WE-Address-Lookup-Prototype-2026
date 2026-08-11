const API_ENDPOINT = "https://data.winnipeg.ca/resource/cam2-ii3u.json";
const REQUEST_TIMEOUT_MS = 10_000;
const DEBOUNCE_MS = 300;

const RESULT_FIELDS = Object.freeze([
  "street_address",
  "street_number",
  "street_number_suffix",
  "street_name",
  "street_type",
  "street_direction",
  "school_division",
  "school_division_ward",
  "ward_as_of_september_17",
]);

const STREET_TYPES = Object.freeze({
  ALLEY: ["ALLEY"], AVE: ["AVE", "AVENUE"], BAY: ["BAY"], BEND: ["BEND"],
  BLVD: ["BLVD", "BOULEVARD"], CIR: ["CIR", "CIRCLE"], CLOSE: ["CLOSE"],
  COMMON: ["COMMON"], COVE: ["COVE"], CRES: ["CRES", "CRESCENT"],
  CROSS: ["CROSS"], CRT: ["CRT", "COURT"], DR: ["DR", "DRIVE"],
  FWY: ["FWY", "FREEWAY"], GATE: ["GATE"], GDN: ["GDN", "GARDEN"],
  GDNS: ["GDNS", "GARDENS"], GROVE: ["GROVE"], HWY: ["HWY", "HIGHWAY"],
  KEY: ["KEY"], LANE: ["LANE"], MEWS: ["MEWS"], PATH: ["PATH"],
  PK: ["PK", "PARK", "PARC"], PKY: ["PKY", "PARKWAY"],
  PL: ["PL", "PLACE"], PROM: ["PROM", "PROMENADE"],
  PT: ["PT", "POINT", "POINTE"], RD: ["RD", "ROAD"], RIDGE: ["RIDGE"],
  ROW: ["ROW"], RUN: ["RUN"], SQ: ["SQ", "SQUARE", "SQUARES"],
  ST: ["ST", "STREET"], TERR: ["TERR", "TERRACE", "TERRASSE"],
  TRAIL: ["TRAIL"], WALK: ["WALK", "WALKWAY"], WAY: ["WAY"],
});

const TYPE_LOOKUP = new Map(
  Object.entries(STREET_TYPES).flatMap(([cityValue, aliases]) =>
    aliases.map((alias) => [alias, cityValue]),
  ),
);
const DIRECTIONS = new Set(["N", "S", "E", "W", "NW", "SW"]);
const SUFFIXES = new Set(["1/2", "1/2A", ..."ABCDEFGHIJKLMN"]);
const RETRYABLE_ERROR_PHASES = new Set([
  "error429",
  "errorServer",
  "errorTimeout",
  "errorNetwork",
  "errorUnexpected",
]);

function alphanumericCount(value) {
  return (value.match(/[\p{L}\p{N}]/gu) || []).length;
}

export function normalizeInput(value) {
  return String(value ?? "")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/[^\p{L}\p{N}\s.'\-/]/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("en-CA");
}

export function normalizeStreetType(token) {
  const cleaned = String(token ?? "").replace(/\.+$/g, "").toUpperCase();
  return TYPE_LOOKUP.get(cleaned) ?? null;
}

function normalizeSuffix(value) {
  const compact = String(value ?? "").replace(/\s+/g, "").toUpperCase();
  return SUFFIXES.has(compact) ? compact : null;
}

function makeCandidate(streetNumber, suffix, nameTokens, {
  streetType = null,
  streetDirection = null,
  preference = 0,
} = {}) {
  const streetName = nameTokens.join(" ");
  if (alphanumericCount(streetName) < 3) return null;
  return Object.freeze({
    streetNumber,
    streetNumberSuffix: suffix,
    streetName,
    streetType,
    streetDirection,
    preference,
  });
}

function interpretedTail(tokens) {
  const finalDirection = DIRECTIONS.has(tokens.at(-1)) ? tokens.at(-1) : null;
  const finalType = normalizeStreetType(tokens.at(-1));
  const typeBeforeDirection = finalDirection ? normalizeStreetType(tokens.at(-2)) : null;

  if (finalDirection && typeBeforeDirection) {
    return {
      nameTokens: tokens.slice(0, -2),
      streetType: typeBeforeDirection,
      streetDirection: finalDirection,
      preferInterpretation: true,
    };
  }
  if (finalType) {
    return {
      nameTokens: tokens.slice(0, -1),
      streetType: finalType,
      streetDirection: null,
      preferInterpretation: true,
    };
  }
  if (finalDirection) {
    return {
      nameTokens: tokens.slice(0, -1),
      streetType: null,
      streetDirection: finalDirection,
      preferInterpretation: false,
    };
  }
  return null;
}

function generateTailCandidates(streetNumber, suffix, tail, preferenceBase = 0) {
  const tokens = Object.freeze(tail.split(" ").filter(Boolean));
  if (!tokens.length) return Object.freeze([]);

  const interpretation = interpretedTail(tokens);
  const interpreted = interpretation
    ? makeCandidate(streetNumber, suffix, interpretation.nameTokens, {
      streetType: interpretation.streetType,
      streetDirection: interpretation.streetDirection,
      preference: preferenceBase + (interpretation.preferInterpretation ? 0 : 1),
    })
    : null;
  const literal = makeCandidate(streetNumber, suffix, tokens, {
    preference: preferenceBase + (interpretation?.preferInterpretation && interpreted ? 1 : 0),
  });
  const unique = new Map();
  for (const candidate of [literal, interpreted]) {
    if (candidate) unique.set(candidateKey(candidate), candidate);
  }
  return Object.freeze([...unique.values()]);
}

function candidateKey(candidate) {
  return [candidate.streetNumber, candidate.streetNumberSuffix, candidate.streetName,
    candidate.streetType, candidate.streetDirection].map((value) => value ?? "").join("\u001f");
}

export function parseAddress(value) {
  const normalizedInput = normalizeInput(value);
  const numberMatch = normalizedInput.match(/^(\d+)(1\/2[A-N]?|[A-N])(?:\s+|$)(.*)$/u);
  let streetNumber;
  let tail;
  const readings = [];

  if (numberMatch) {
    streetNumber = Number(numberMatch[1]);
    const suffix = normalizeSuffix(numberMatch[2]);
    tail = numberMatch[3];
    if (suffix && tail) readings.push({ suffix, tail, preference: 0 });
  } else {
    const plainMatch = normalizedInput.match(/^(\d+)(?:\s+(.*))?$/u);
    if (!plainMatch) return { normalizedInput, streetNumber: null, candidates: [], eligible: false };
    streetNumber = Number(plainMatch[1]);
    tail = plainMatch[2] ?? "";
    if (tail) {
      const tokens = tail.split(" ");
      const twoTokenSuffix = tokens.length > 2 ? normalizeSuffix(`${tokens[0]}${tokens[1]}`) : null;
      const oneTokenSuffix = normalizeSuffix(tokens[0]);
      if (twoTokenSuffix && tokens.slice(2).length) {
        readings.push({ suffix: twoTokenSuffix, tail: tokens.slice(2).join(" "), preference: 0 });
      } else if (oneTokenSuffix && tokens.slice(1).length) {
        readings.push({ suffix: oneTokenSuffix, tail: tokens.slice(1).join(" "), preference: 0 });
      }
      readings.push({ suffix: null, tail, preference: readings.length ? 10 : 0 });
    }
  }

  const unique = new Map();
  for (const reading of readings) {
    for (const candidate of generateTailCandidates(streetNumber, reading.suffix, reading.tail, reading.preference)) {
      const key = candidateKey(candidate);
      const existing = unique.get(key);
      if (!existing || candidate.preference < existing.preference) unique.set(key, candidate);
    }
  }
  const candidates = Object.freeze([...unique.values()].sort((a, b) => a.preference - b.preference));
  return { normalizedInput, streetNumber, candidates, eligible: candidates.length > 0 };
}

export function isSearchEligible(value) {
  return parseAddress(value).eligible;
}

export function escapeSoqlLiteral(value) {
  return String(value).replace(/'/g, "''");
}

function candidatePredicate(candidate) {
  const predicates = [
    `upper(street_name) like '${escapeSoqlLiteral(candidate.streetName)}%'`,
  ];
  if (candidate.streetNumberSuffix) {
    predicates.push(`upper(street_number_suffix) = '${escapeSoqlLiteral(candidate.streetNumberSuffix)}'`);
  }
  if (candidate.streetType) {
    predicates.push(`upper(street_type) = '${escapeSoqlLiteral(candidate.streetType)}'`);
  }
  if (candidate.streetDirection) {
    predicates.push(`upper(street_direction) = '${escapeSoqlLiteral(candidate.streetDirection)}'`);
  }
  return `(${predicates.join(" AND ")})`;
}

export function buildQuery(candidates, endpoint = API_ENDPOINT) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new TypeError("At least one parsed candidate is required.");
  }
  const streetNumber = candidates[0].streetNumber;
  if (!Number.isSafeInteger(streetNumber) || streetNumber < 0 || candidates.some((item) => item.streetNumber !== streetNumber)) {
    throw new TypeError("Candidates must share one numeric civic number.");
  }
  const alternatives = [...new Map(candidates.map((item) => [candidateKey(item), item])).values()];
  const where = `street_number = ${streetNumber} AND (${alternatives.map(candidatePredicate).join(" OR ")})`;
  const params = new URLSearchParams();
  params.set("$select", `street_address as display_address,${RESULT_FIELDS.slice(1).join(",")}`);
  params.set("$where", where);
  params.set("$group", RESULT_FIELDS.join(","));
  params.set("$order", RESULT_FIELDS.slice(1).concat("street_address").join(","));
  return `${endpoint}?${params.toString()}`;
}

function cleanApiString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeAuthoritativeRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const displayAddress = cleanApiString(row.display_address ?? row.street_address);
  const streetNumberValue = typeof row.street_number === "number" ? row.street_number : Number(row.street_number);
  if (!displayAddress || !Number.isFinite(streetNumberValue)) return null;
  return {
    displayAddress,
    streetNumber: streetNumberValue,
    streetNumberSuffix: cleanApiString(row.street_number_suffix),
    streetName: cleanApiString(row.street_name),
    streetType: cleanApiString(row.street_type),
    streetDirection: cleanApiString(row.street_direction),
    schoolDivision: cleanApiString(row.school_division),
    schoolDivisionWard: cleanApiString(row.school_division_ward),
    councilWard: cleanApiString(row.ward_as_of_september_17),
  };
}

function rowKey(row) {
  return [row.displayAddress, row.streetNumber, row.streetNumberSuffix, row.streetName,
    row.streetType, row.streetDirection, row.schoolDivision, row.schoolDivisionWard,
    row.councilWard].map((value) => value ?? "").join("\u001f");
}

function candidateMatchRank(row, candidates) {
  let best = Number.MAX_SAFE_INTEGER;
  for (const candidate of candidates ?? []) {
    if (row.streetNumber !== candidate.streetNumber) continue;
    if (!String(row.streetName ?? "").toUpperCase().startsWith(candidate.streetName)) continue;
    if (candidate.streetNumberSuffix && row.streetNumberSuffix?.toUpperCase() !== candidate.streetNumberSuffix) continue;
    if (candidate.streetType && row.streetType?.toUpperCase() !== candidate.streetType) continue;
    if (candidate.streetDirection && row.streetDirection?.toUpperCase() !== candidate.streetDirection) continue;
    best = Math.min(best, candidate.preference);
  }
  return best;
}

export function dedupeAndSortRows(rows, candidates = []) {
  const unique = new Map();
  for (const raw of rows ?? []) {
    const row = raw?.displayAddress ? raw : normalizeAuthoritativeRow(raw);
    if (row) unique.set(rowKey(row), row);
  }
  const collator = new Intl.Collator("en-CA", { numeric: true, sensitivity: "base" });
  return [...unique.values()].sort((a, b) => {
    const rankDifference = candidateMatchRank(a, candidates) - candidateMatchRank(b, candidates);
    if (rankDifference) return rankDifference;
    for (const key of ["streetNumber", "streetNumberSuffix", "streetName", "streetType", "streetDirection",
      "displayAddress", "councilWard", "schoolDivision", "schoolDivisionWard"]) {
      const difference = collator.compare(String(a[key] ?? ""), String(b[key] ?? ""));
      if (difference) return difference;
    }
    return 0;
  });
}

export function formatTrusteeWard(value) {
  const cleaned = cleanApiString(value);
  if (!cleaned) return "Not available";
  return /^\d+$/.test(cleaned) ? `Ward ${cleaned}` : cleaned;
}

export function formatCouncilWard(value) {
  return cleanApiString(value) ?? "Not available";
}

export function formatSchoolTrustee(division, ward) {
  const divisionLabel = cleanApiString(division) ?? "Not available";
  const wardLabel = formatTrusteeWard(ward);
  return `${divisionLabel} — ${wardLabel}`;
}

export function errorPhaseForStatus(status) {
  if (status === 400) return "error400";
  if (status === 429) return "error429";
  if (status >= 500) return "errorServer";
  return "errorNetwork";
}

export function isRetryablePhase(phase) {
  return RETRYABLE_ERROR_PHASES.has(phase);
}

export function selectedResultStatus(selected) {
  if (!selected) return "";
  return `Election information shown for ${selected.displayAddress}. City Council: ${formatCouncilWard(selected.councilWard)}. School Trustee: ${formatSchoolTrustee(selected.schoolDivision, selected.schoolDivisionWard)}.`;
}

export function statusMessage(state) {
  const messages = {
    guidance: "Keep typing: enter a civic number and at least three letters of the street name.",
    pending: "Looking up official City addresses…",
    loading: "Looking up official City addresses…",
    empty: "No matching Winnipeg addresses found. Try omitting the street type or entering less of the street name.",
    error400: "That address could not be searched. Check the civic number and street name, then try again.",
    error429: "The City address service is busy. Wait a moment, then try again.",
    errorServer: "The City address service is temporarily unavailable. Try again shortly.",
    errorTimeout: "The City address service took too long to respond. Try again.",
    errorNetwork: "The City address service could not be reached. Check your connection and try again.",
    errorUnexpected: "The City address service returned an unexpected response. Try again.",
  };
  if (state.phase === "results" && state.popupOpen) {
    return `${state.results.length} matching official ${state.results.length === 1 ? "address" : "addresses"}. Use the arrow keys or choose an address.`;
  }
  if (state.phase === "selected" && state.selected) return selectedResultStatus(state.selected);
  return messages[state.phase] ?? "";
}

export class LookupController {
  constructor({
    fetchFn = globalThis.fetch?.bind(globalThis),
    onChange = () => {},
    debounceMs = DEBOUNCE_MS,
    timeoutMs = REQUEST_TIMEOUT_MS,
    setTimeoutFn = globalThis.setTimeout.bind(globalThis),
    clearTimeoutFn = globalThis.clearTimeout.bind(globalThis),
  } = {}) {
    if (!fetchFn) throw new TypeError("A fetch implementation is required.");
    this.fetchFn = fetchFn;
    this.onChange = onChange;
    this.debounceMs = debounceMs;
    this.timeoutMs = timeoutMs;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.pendingTimer = null;
    this.requestTimer = null;
    this.abortController = null;
    this.generation = 0;
    this.cache = null;
    this.state = {
      rawInput: "", normalizedInput: "", candidates: [], results: [], popupOpen: false,
      activeIndex: -1, phase: "idle", selected: null, requestActive: false, scrollRevision: 0,
    };
  }

  emit() {
    this.onChange(this.state);
  }

  cancelWork() {
    if (this.pendingTimer !== null) this.clearTimeoutFn(this.pendingTimer);
    if (this.requestTimer !== null) this.clearTimeoutFn(this.requestTimer);
    this.pendingTimer = null;
    this.requestTimer = null;
    if (this.abortController) this.abortController.abort();
    this.abortController = null;
    this.state.requestActive = false;
  }

  invalidate() {
    this.cancelWork();
    this.generation += 1;
  }

  inputChanged(rawInput) {
    const previousNormalized = this.state.normalizedInput;
    this.invalidate();
    const parsed = parseAddress(rawInput);
    if (parsed.normalizedInput !== previousNormalized) this.cache = null;
    this.state = {
      ...this.state,
      rawInput,
      normalizedInput: parsed.normalizedInput,
      candidates: parsed.candidates,
      results: [],
      popupOpen: false,
      activeIndex: -1,
      selected: null,
      phase: parsed.eligible ? "pending" : "guidance",
      requestActive: false,
      scrollRevision: this.state.scrollRevision + 1,
    };
    const generation = this.generation;
    if (parsed.eligible) {
      this.pendingTimer = this.setTimeoutFn(() => {
        this.pendingTimer = null;
        void this.startSearch(generation, parsed.normalizedInput, parsed.candidates);
      }, this.debounceMs);
    }
    this.emit();
  }

  async startSearch(generation, normalizedInput, candidates) {
    if (generation !== this.generation || normalizedInput !== this.state.normalizedInput) return;
    const abortController = new AbortController();
    this.abortController = abortController;
    this.state.phase = "loading";
    this.state.requestActive = true;
    this.emit();
    let timedOut = false;
    this.requestTimer = this.setTimeoutFn(() => {
      timedOut = true;
      abortController.abort();
    }, this.timeoutMs);

    try {
      const response = await this.fetchFn(buildQuery(candidates), { signal: abortController.signal });
      if (!this.isCurrent(generation, normalizedInput, abortController)) return;
      if (!response.ok) {
        this.finishError(errorPhaseForStatus(response.status));
        return;
      }
      let payload;
      try {
        payload = await response.json();
      } catch {
        if (this.isCurrent(generation, normalizedInput, abortController)) this.finishError("errorUnexpected");
        return;
      }
      if (!this.isCurrent(generation, normalizedInput, abortController)) return;
      if (!Array.isArray(payload)) {
        this.finishError("errorUnexpected");
        return;
      }
      const results = dedupeAndSortRows(payload, candidates);
      this.clearRequestTimer();
      this.abortController = null;
      this.cache = { normalizedInput, results };
      this.state.results = results;
      this.state.popupOpen = results.length > 0;
      this.state.activeIndex = -1;
      this.state.phase = results.length ? "results" : "empty";
      this.state.requestActive = false;
      this.state.scrollRevision += 1;
      this.emit();
    } catch (error) {
      if (!this.isCurrent(generation, normalizedInput, abortController)) return;
      if (timedOut) this.finishError("errorTimeout");
      else if (error?.name !== "AbortError") this.finishError("errorNetwork");
    }
  }

  retry() {
    if (!isRetryablePhase(this.state.phase)) return false;
    const parsed = parseAddress(this.state.rawInput);
    if (!parsed.eligible || parsed.normalizedInput !== this.state.normalizedInput) return false;

    this.invalidate();
    this.cache = null;
    this.state = {
      ...this.state,
      candidates: parsed.candidates,
      results: [],
      popupOpen: false,
      activeIndex: -1,
      selected: null,
      requestActive: false,
      scrollRevision: this.state.scrollRevision + 1,
    };
    void this.startSearch(this.generation, parsed.normalizedInput, parsed.candidates);
    return true;
  }

  isCurrent(generation, normalizedInput, abortController) {
    return generation === this.generation
      && normalizedInput === this.state.normalizedInput
      && abortController === this.abortController;
  }

  clearRequestTimer() {
    if (this.requestTimer !== null) this.clearTimeoutFn(this.requestTimer);
    this.requestTimer = null;
  }

  finishError(phase) {
    this.clearRequestTimer();
    this.abortController = null;
    this.state.results = [];
    this.state.popupOpen = false;
    this.state.activeIndex = -1;
    this.state.phase = phase;
    this.state.requestActive = false;
    this.state.scrollRevision += 1;
    this.emit();
  }

  dismiss() {
    this.invalidate();
    this.state.results = [];
    this.state.popupOpen = false;
    this.state.activeIndex = -1;
    this.state.phase = "idle";
    this.state.scrollRevision += 1;
    this.emit();
  }

  refocus() {
    if (this.state.selected) return;
    if (this.state.requestActive || this.pendingTimer !== null) return;
    if (this.cache?.normalizedInput === this.state.normalizedInput) {
      this.state.results = this.cache.results;
      this.state.popupOpen = this.cache.results.length > 0;
      this.state.activeIndex = -1;
      this.state.phase = this.cache.results.length ? "results" : "empty";
      this.state.scrollRevision += 1;
      this.emit();
      return;
    }
    this.inputChanged(this.state.rawInput);
  }

  moveActive(delta) {
    if (!this.state.popupOpen || !this.state.results.length) return false;
    const count = this.state.results.length;
    if (this.state.activeIndex < 0) this.state.activeIndex = delta > 0 ? 0 : count - 1;
    else this.state.activeIndex = (this.state.activeIndex + delta + count) % count;
    this.emit();
    return true;
  }

  select(index) {
    const selected = this.state.results[index];
    if (!selected) return null;
    this.invalidate();
    this.cache = null;
    this.state.rawInput = selected.displayAddress;
    this.state.normalizedInput = normalizeInput(selected.displayAddress);
    this.state.results = [];
    this.state.popupOpen = false;
    this.state.activeIndex = -1;
    this.state.selected = selected;
    this.state.phase = "selected";
    this.state.scrollRevision += 1;
    this.emit();
    return selected;
  }
}

function positionPopup(input, wrap, list) {
  if (list.hidden) return;
  const viewport = window.visualViewport;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const viewportBottom = viewportTop + viewportHeight;
  const rect = input.getBoundingClientRect();
  const margin = 10;
  const below = Math.max(0, viewportBottom - rect.bottom - margin);
  const above = Math.max(0, rect.top - viewportTop - margin);
  const preferredMinimum = Math.min(240, viewportHeight * 0.42);
  const side = below >= preferredMinimum || below >= above ? "below" : "above";
  const available = side === "below" ? below : above;
  wrap.dataset.popupSide = side;
  list.style.maxHeight = `${Math.max(48, Math.floor(available - 6))}px`;
}

function startBrowserApp() {
  const input = document.querySelector("#address-input");
  const wrap = document.querySelector("#combobox-wrap");
  const searchArea = document.querySelector("#search-area");
  const list = document.querySelector("#address-suggestions");
  const status = document.querySelector("#address-status");
  const retryButton = document.querySelector("#retry-button");
  const result = document.querySelector("#election-result");
  const resultAddress = document.querySelector("#result-address");
  const councilWard = document.querySelector("#council-ward");
  const trusteeWard = document.querySelector("#trustee-ward");
  let lastResults = null;
  let lastPopupOpen = false;
  let lastScrollRevision = -1;

  const render = (state) => {
    if (input.value !== state.rawInput) input.value = state.rawInput;
    const resultsChanged = state.results !== lastResults;
    if (resultsChanged) {
      list.replaceChildren();
      state.results.forEach((row, index) => {
        const option = document.createElement("li");
        option.id = `address-option-${index}`;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(index === state.activeIndex));
        option.dataset.index = String(index);
        option.textContent = row.displayAddress;
        list.append(option);
      });
      lastResults = state.results;
    } else {
      [...list.children].forEach((option, index) => {
        option.setAttribute("aria-selected", String(index === state.activeIndex));
      });
    }

    list.hidden = !state.popupOpen;
    input.setAttribute("aria-expanded", String(state.popupOpen));
    if (state.popupOpen && state.activeIndex >= 0) {
      const activeId = `address-option-${state.activeIndex}`;
      input.setAttribute("aria-activedescendant", activeId);
      document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
    if (state.scrollRevision !== lastScrollRevision || lastPopupOpen !== state.popupOpen) {
      list.scrollTop = 0;
      lastScrollRevision = state.scrollRevision;
    }
    lastPopupOpen = state.popupOpen;
    searchArea.dataset.popupOpen = String(state.popupOpen);
    status.textContent = statusMessage(state);
    retryButton.hidden = !isRetryablePhase(state.phase);

    result.hidden = !state.selected;
    if (state.selected) {
      resultAddress.textContent = state.selected.displayAddress;
      councilWard.textContent = formatCouncilWard(state.selected.councilWard);
      trusteeWard.textContent = formatSchoolTrustee(state.selected.schoolDivision, state.selected.schoolDivisionWard);
    } else {
      resultAddress.textContent = "";
      councilWard.textContent = "";
      trusteeWard.textContent = "";
    }
    if (state.popupOpen) requestAnimationFrame(() => positionPopup(input, wrap, list));
  };

  const controller = new LookupController({ onChange: render });
  render(controller.state);

  input.addEventListener("input", () => controller.inputChanged(input.value));
  input.addEventListener("focus", () => controller.refocus());
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && controller.moveActive(1)) event.preventDefault();
    else if (event.key === "ArrowUp" && controller.moveActive(-1)) event.preventDefault();
    else if (event.key === "Enter" && controller.state.activeIndex >= 0) {
      event.preventDefault();
      controller.select(controller.state.activeIndex);
    } else if (event.key === "Escape") {
      event.preventDefault();
      controller.dismiss();
    } else if (event.key === "Tab" && !isRetryablePhase(controller.state.phase)) controller.dismiss();
  });

  retryButton.addEventListener("click", () => {
    if (controller.retry()) input.focus({ preventScroll: true });
  });

  list.addEventListener("click", (event) => {
    const option = event.target.closest('[role="option"]');
    if (!option) return;
    controller.select(Number(option.dataset.index));
    input.blur();
  });

  document.addEventListener("pointerdown", (event) => {
    if (!searchArea.contains(event.target)) controller.dismiss();
  }, true);
  document.addEventListener("focusin", (event) => {
    if (event.target !== input && event.target !== retryButton && !list.contains(event.target)) controller.dismiss();
  });

  const reposition = () => positionPopup(input, wrap, list);
  window.addEventListener("resize", reposition, { passive: true });
  window.visualViewport?.addEventListener("resize", reposition, { passive: true });
  window.visualViewport?.addEventListener("scroll", reposition, { passive: true });
}

if (typeof document !== "undefined") startBrowserApp();

export {
  API_ENDPOINT,
  DEBOUNCE_MS,
  REQUEST_TIMEOUT_MS,
  RESULT_FIELDS,
  STREET_TYPES,
  DIRECTIONS,
  SUFFIXES,
  RETRYABLE_ERROR_PHASES,
};
