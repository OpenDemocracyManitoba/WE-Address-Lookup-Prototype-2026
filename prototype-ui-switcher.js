// Prototype question: compare the preserved current UI with Atlas, Mosaic, and Signal via ?variant= before keeping one direction.

const VARIANTS = Object.freeze([
  Object.freeze({ key: "current", label: "Current" }),
  Object.freeze({ key: "atlas", label: "Atlas" }),
  Object.freeze({ key: "mosaic", label: "Mosaic" }),
  Object.freeze({ key: "signal", label: "Signal" }),
]);

const variantByKey = new Map(VARIANTS.map((variant) => [variant.key, variant]));

function requestedVariant(url = new URL(window.location.href)) {
  return url.searchParams.get("variant");
}

function normalizedVariant(key) {
  return variantByKey.has(key) ? key : "current";
}

function variantUrl(key, url = new URL(window.location.href)) {
  url.searchParams.set("variant", normalizedVariant(key));
  return url;
}

function isEditing(target) {
  return target instanceof Element && Boolean(
    target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"),
  );
}

function decorateInternalLinks(key) {
  document.querySelectorAll("a[href]").forEach((link) => {
    const rawHref = link.getAttribute("href");
    if (!rawHref || rawHref.startsWith("#")) return;

    const url = new URL(link.href, window.location.href);
    if (
      url.origin !== window.location.origin ||
      !["http:", "https:"].includes(url.protocol)
    ) return;

    link.href = variantUrl(key, url).href;
  });
}

function startPrototypeUiSwitcher() {
  const switcher = document.querySelector(".prototype-ui-switcher");
  if (!switcher) return;

  const requested = requestedVariant();
  let currentKey = normalizedVariant(requested);

  if (requested !== null && requested !== currentKey) {
    window.history.replaceState(null, "", variantUrl(currentKey));
  }

  const render = () => {
    const current = variantByKey.get(currentKey);
    document.documentElement.dataset.uiVariant = currentKey;
    document.body.dataset.uiVariant = currentKey;
    document.querySelector("#prototype-ui-current-label").textContent = current.label;
    switcher.querySelectorAll("[data-prototype-variant]").forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.prototypeVariant === currentKey),
      );
    });
    decorateInternalLinks(currentKey);
  };

  const select = (key) => {
    currentKey = normalizedVariant(key);
    window.history.replaceState(null, "", variantUrl(currentKey));
    render();
  };

  const cycle = (offset) => {
    const currentIndex = VARIANTS.findIndex(({ key }) => key === currentKey);
    select(VARIANTS[(currentIndex + offset + VARIANTS.length) % VARIANTS.length].key);
  };

  switcher.addEventListener("click", (event) => {
    const variantButton = event.target.closest("[data-prototype-variant]");
    if (variantButton) select(variantButton.dataset.prototypeVariant);

    const directionButton = event.target.closest("[data-prototype-direction]");
    if (directionButton) {
      cycle(directionButton.dataset.prototypeDirection === "next" ? 1 : -1);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.isComposing || isEditing(event.target)) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      cycle(event.key === "ArrowRight" ? 1 : -1);
    }
  });

  render();
}

if (typeof document !== "undefined") startPrototypeUiSwitcher();

export { normalizedVariant, VARIANTS, variantUrl };
