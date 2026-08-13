import {
  buildAddressResults,
  buildQuery,
  formatCouncilWard,
  formatSchoolTrustee,
  normalizeInput,
  parseAddress,
} from "./address-data.js";

const REQUEST_TIMEOUT_MS = 10_000;
const DEBOUNCE_MS = 300;
const RETRYABLE_ERROR_PHASES = new Set([
  "error429",
  "errorServer",
  "errorTimeout",
  "errorNetwork",
  "errorUnexpected",
]);

export function errorPhaseForStatus(status) {
  if (status === 400) return "error400";
  if (status === 429) return "error429";
  if (status >= 500) return "errorServer";
  return "errorNetwork";
}

export function isRetryablePhase(phase) {
  return RETRYABLE_ERROR_PHASES.has(phase);
}

const STATUS_MESSAGES = Object.freeze({
  guidance:
    "Keep typing: enter a civic number and at least three letters of the street name.",
  pending: "Looking up official City addresses…",
  loading: "Looking up official City addresses…",
  empty:
    "No matching Winnipeg addresses found. Try omitting the street type or entering less of the street name.",
  error400:
    "That address could not be searched. Check the civic number and street name, then try again.",
  error429:
    "The City address service is busy. Wait a moment, then try again.",
  errorServer:
    "The City address service is temporarily unavailable. Try again shortly.",
  errorTimeout:
    "The City address service took too long to respond. Try again.",
  errorNetwork:
    "The City address service could not be reached. Check your connection and try again.",
  errorUnexpected:
    "The City address service returned an unexpected response. Try again.",
});

export function statusMessage(state) {
  if (state.phase === "results" && state.popupOpen) {
    return `${state.results.length} matching official ${state.results.length === 1 ? "address" : "addresses"}. Use the arrow keys or choose an address.`;
  }
  if (state.phase === "selected" && state.selected) {
    return `Election information shown for ${state.selected.displayAddress}. City Council: ${formatCouncilWard(state.selected.councilWard)}. School Trustee: ${formatSchoolTrustee(state.selected.schoolDivision, state.selected.schoolDivisionWard)}.`;
  }
  return STATUS_MESSAGES[state.phase] ?? "";
}

function clearedSuggestions() {
  return {
    results: [],
    popupOpen: false,
    activeIndex: -1,
  };
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
      rawInput: "",
      normalizedInput: "",
      ...clearedSuggestions(),
      phase: "idle",
      selected: null,
    };
  }

  emit() {
    this.onChange(this.state);
  }

  updateState(patch) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  cancelWork() {
    if (this.pendingTimer !== null) this.clearTimeoutFn(this.pendingTimer);
    if (this.requestTimer !== null) this.clearTimeoutFn(this.requestTimer);
    this.pendingTimer = null;
    this.requestTimer = null;
    if (this.abortController) this.abortController.abort();
    this.abortController = null;
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
    const generation = this.generation;
    if (parsed.eligible) {
      this.pendingTimer = this.setTimeoutFn(() => {
        this.pendingTimer = null;
        void this.startSearch(
          generation,
          parsed.normalizedInput,
          parsed.candidates,
        );
      }, this.debounceMs);
    }
    this.updateState({
      rawInput,
      normalizedInput: parsed.normalizedInput,
      ...clearedSuggestions(),
      selected: null,
      phase: parsed.eligible ? "pending" : "guidance",
    });
  }

  async startSearch(
    generation,
    normalizedInput,
    candidates,
    resetSuggestions = false,
  ) {
    if (
      generation !== this.generation ||
      normalizedInput !== this.state.normalizedInput
    )
      return;
    const abortController = new AbortController();
    this.abortController = abortController;
    const loadingState = resetSuggestions
      ? { ...clearedSuggestions(), selected: null, phase: "loading" }
      : { phase: "loading" };
    this.updateState(loadingState);
    let timedOut = false;
    this.requestTimer = this.setTimeoutFn(() => {
      timedOut = true;
      abortController.abort();
    }, this.timeoutMs);

    try {
      const response = await this.fetchFn(buildQuery(candidates), {
        signal: abortController.signal,
      });
      if (!this.isCurrent(generation, normalizedInput, abortController)) return;
      if (!response.ok) {
        this.finishError(errorPhaseForStatus(response.status));
        return;
      }
      let payload;
      try {
        payload = await response.json();
      } catch {
        if (this.isCurrent(generation, normalizedInput, abortController)) {
          this.finishError(timedOut ? "errorTimeout" : "errorUnexpected");
        }
        return;
      }
      if (!this.isCurrent(generation, normalizedInput, abortController)) return;
      if (!Array.isArray(payload)) {
        this.finishError("errorUnexpected");
        return;
      }
      const results = buildAddressResults(
        payload,
        candidates,
        normalizedInput,
      );
      this.clearRequestTimer();
      this.abortController = null;
      this.cache = { normalizedInput, results };
      this.updateState({
        results,
        popupOpen: results.length > 0,
        activeIndex: results.length ? 0 : -1,
        phase: results.length ? "results" : "empty",
      });
    } catch (error) {
      if (!this.isCurrent(generation, normalizedInput, abortController)) return;
      if (timedOut) this.finishError("errorTimeout");
      else if (error?.name !== "AbortError") this.finishError("errorNetwork");
    }
  }

  retry() {
    if (!isRetryablePhase(this.state.phase)) return false;
    const parsed = parseAddress(this.state.rawInput);
    if (
      !parsed.eligible ||
      parsed.normalizedInput !== this.state.normalizedInput
    )
      return false;

    this.invalidate();
    this.cache = null;
    void this.startSearch(
      this.generation,
      parsed.normalizedInput,
      parsed.candidates,
      true,
    );
    return true;
  }

  isCurrent(generation, normalizedInput, abortController) {
    return (
      generation === this.generation &&
      normalizedInput === this.state.normalizedInput &&
      abortController === this.abortController
    );
  }

  clearRequestTimer() {
    if (this.requestTimer !== null) this.clearTimeoutFn(this.requestTimer);
    this.requestTimer = null;
  }

  finishError(phase) {
    this.clearRequestTimer();
    this.abortController = null;
    this.updateState({ ...clearedSuggestions(), phase });
  }

  dismiss() {
    if (this.state.phase === "selected") return;
    this.invalidate();
    this.updateState({ ...clearedSuggestions(), phase: "idle" });
  }

  activateInput() {
    if (
      this.state.selected ||
      this.abortController !== null ||
      this.pendingTimer !== null ||
      this.state.popupOpen ||
      this.state.phase !== "idle"
    )
      return false;
    if (this.cache?.normalizedInput === this.state.normalizedInput) {
      this.updateState({
        results: this.cache.results,
        popupOpen: this.cache.results.length > 0,
        activeIndex: this.cache.results.length ? 0 : -1,
        phase: this.cache.results.length ? "results" : "empty",
      });
      return true;
    }
    this.inputChanged(this.state.rawInput);
    return true;
  }

  moveActive(delta) {
    if (!this.state.popupOpen || !this.state.results.length) return false;
    const count = this.state.results.length;
    let activeIndex;
    if (this.state.activeIndex < 0)
      activeIndex = delta > 0 ? 0 : count - 1;
    else activeIndex = (this.state.activeIndex + delta + count) % count;
    this.updateState({ activeIndex });
    return true;
  }

  selectActive() {
    if (!this.state.popupOpen || this.state.activeIndex < 0) return null;
    return this.select(this.state.activeIndex);
  }

  select(index) {
    const selected = this.state.results[index];
    if (!selected) return null;
    this.invalidate();
    this.cache = null;
    this.updateState({
      rawInput: selected.displayAddress,
      normalizedInput: normalizeInput(selected.displayAddress),
      ...clearedSuggestions(),
      selected,
      phase: "selected",
    });
    return selected;
  }
}

export {
  DEBOUNCE_MS,
  REQUEST_TIMEOUT_MS,
  RETRYABLE_ERROR_PHASES,
};
