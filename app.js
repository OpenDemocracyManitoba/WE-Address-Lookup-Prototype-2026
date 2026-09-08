import {
  isRetryablePhase,
  LookupController,
  statusMessage,
} from "./lookup-controller.js";
import { calculatePopupGeometry } from "./popup-geometry.js";
import { randomizeCandidateLists } from "./candidate-order.js";
import { renderApplicableContests } from "./contest-result-renderer.js";
import { bindContestDisclosureScrolling } from "./contest-disclosure.js";

function positionPopup(input, wrap, list) {
  if (list.hidden) return;
  const viewport = window.visualViewport;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const rect = input.getBoundingClientRect();
  const { side, maxHeight } = calculatePopupGeometry({
    inputTop: rect.top,
    inputBottom: rect.bottom,
    viewportTop,
    viewportHeight,
    preferredSide: wrap.dataset.popupSide || undefined,
  });
  wrap.dataset.popupSide = side;
  list.style.maxHeight = `${maxHeight}px`;
}

function startBrowserApp() {
  const input = document.querySelector("#address-input");
  const wrap = document.querySelector("#combobox-wrap");
  const searchArea = document.querySelector("#search-area");
  const list = document.querySelector("#address-suggestions");
  const status = document.querySelector("#address-status");
  const statusText = document.querySelector("#address-status-message");
  const optionTemplate = document.querySelector("#address-option-template");
  const retryButton = document.querySelector("#retry-button");
  const addressLookupResult = document.querySelector("#address-lookup-result");
  const addressLookupResultAddress = document.querySelector(
    "#address-lookup-result-address",
  );
  const applicableContests = document.querySelector("#applicable-contests");
  bindContestDisclosureScrolling(applicableContests);
  const contestResolutionData = JSON.parse(
    document.querySelector("#contest-resolution-data").textContent,
  );
  const contestTemplates = new Map(
    [...document.querySelectorAll("[data-contest-template]")]
      .map((template) => [template.dataset.contestTemplate, template]),
  );
  let lastResults = null;
  let lastPopupOpen = false;
  let lastSelected = null;

  const render = (state) => {
    if (input.value !== state.rawInput) input.value = state.rawInput;
    const resultsChanged = state.results !== lastResults;
    if (resultsChanged) {
      list.replaceChildren();
      state.results.forEach((row, index) => {
        const option = optionTemplate.content.firstElementChild.cloneNode(true);
        option.id = `address-option-${index}`;
        option.setAttribute("role", "option");
        option.setAttribute(
          "aria-selected",
          String(index === state.activeIndex),
        );
        option.dataset.index = String(index);
        option.querySelector(".suggestion-address").textContent = row.displayAddress;
        list.append(option);
      });
      lastResults = state.results;
    } else {
      [...list.children].forEach((option, index) => {
        option.setAttribute(
          "aria-selected",
          String(index === state.activeIndex),
        );
      });
    }

    list.hidden = !state.popupOpen;
    if (state.selected) delete wrap.dataset.popupSide;
    input.setAttribute("aria-expanded", String(state.popupOpen));
    if (state.popupOpen && state.activeIndex >= 0) {
      const activeId = `address-option-${state.activeIndex}`;
      input.setAttribute("aria-activedescendant", activeId);
      document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
    if (resultsChanged || lastPopupOpen !== state.popupOpen) list.scrollTop = 0;
    lastPopupOpen = state.popupOpen;
    searchArea.dataset.popupOpen = String(state.popupOpen);
    status.classList.toggle(
      "selected-announcement",
      state.phase === "selected",
    );
    const nextStatus = statusMessage(state);
    if (statusText.textContent !== nextStatus) statusText.textContent = nextStatus;
    retryButton.hidden = !isRetryablePhase(state.phase);

    addressLookupResult.hidden = !state.selected;
    renderApplicableContests({
      address: state.selected,
      container: applicableContests,
      contests: contestResolutionData,
      templates: contestTemplates,
    });
    if (state.selected) randomizeCandidateLists(document);
    if (state.selected) {
      addressLookupResultAddress.textContent = state.selected.displayAddress;
    } else {
      addressLookupResultAddress.textContent = "";
    }
    if (state.selected && state.selected !== lastSelected) {
      requestAnimationFrame(() => {
        if (!addressLookupResult.hidden) {
          addressLookupResult.scrollIntoView({ block: "start" });
        }
      });
    }
    lastSelected = state.selected;
    if (state.popupOpen)
      requestAnimationFrame(() => positionPopup(input, wrap, list));
  };

  const controller = new LookupController({ onChange: render });
  render(controller.state);

  const clearPopupSide = () => delete wrap.dataset.popupSide;

  input.addEventListener("input", () => {
    clearPopupSide();
    controller.inputChanged(input.value);
  });
  input.addEventListener("focus", () => controller.activateInput());
  input.addEventListener("click", () => controller.activateInput());
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "ArrowDown" && controller.moveActive(1))
      event.preventDefault();
    else if (event.key === "ArrowUp" && controller.moveActive(-1))
      event.preventDefault();
    else if (event.key === "Enter" && controller.selectActive())
      event.preventDefault();
    else if (event.key === "Escape") {
      event.preventDefault();
      controller.dismiss();
    } else if (event.key === "Tab" && !isRetryablePhase(controller.state.phase))
      controller.dismiss();
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

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!searchArea.contains(event.target)) controller.dismiss();
    },
    true,
  );
  document.addEventListener("focusin", (event) => {
    if (
      event.target !== input &&
      event.target !== retryButton &&
      !list.contains(event.target)
    )
      controller.dismiss();
  });

  const reposition = () => positionPopup(input, wrap, list);
  window.addEventListener("resize", reposition, { passive: true });
  window.addEventListener("scroll", reposition, { passive: true });
  window.visualViewport?.addEventListener("resize", reposition, {
    passive: true,
  });
  window.visualViewport?.addEventListener("scroll", reposition, {
    passive: true,
  });

  const dismissOnOrientationChange = () => {
    clearPopupSide();
    controller.dismiss();
  };
  if (window.screen?.orientation?.addEventListener) {
    window.screen.orientation.addEventListener(
      "change",
      dismissOnOrientationChange,
    );
  } else {
    window.addEventListener("orientationchange", dismissOnOrientationChange, {
      passive: true,
    });
  }
}

if (typeof document !== "undefined") startBrowserApp();
