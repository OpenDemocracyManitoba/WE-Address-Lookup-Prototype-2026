import test from "node:test";
import assert from "node:assert/strict";

import { bindContestDisclosureScrolling } from "../contest-disclosure.js";

function createHarness({ contestTop, viewportTop = 0, open = true } = {}) {
  const frames = [];
  const scrollCalls = [];
  let currentContestTop = contestTop;
  let toggleListener;
  let useCapture;
  const container = {
    addEventListener(type, listener, capture) {
      assert.equal(type, "toggle");
      toggleListener = listener;
      useCapture = capture;
    },
  };
  const contest = {
    open,
    matches: (selector) => selector === ".applicable-contest",
    getBoundingClientRect: () => ({ top: currentContestTop }),
    scrollIntoView: (options) => scrollCalls.push(options),
  };

  bindContestDisclosureScrolling(container, {
    requestAnimationFrameFn: (callback) => frames.push(callback),
    viewportTopFn: () => viewportTop,
  });

  return {
    contest,
    frames,
    scrollCalls,
    setContestTop(top) {
      currentContestTop = top;
    },
    toggle() {
      toggleListener({ target: contest });
    },
    useCapture: () => useCapture,
  };
}

test("opening a Contest above the viewport restores its top after layout settles", () => {
  const harness = createHarness({ contestTop: 240 });

  harness.toggle();

  assert.equal(harness.useCapture(), true);
  assert.deepEqual(harness.scrollCalls, []);
  assert.equal(harness.frames.length, 1);

  harness.setContestTop(-24);
  harness.frames[0]();

  assert.deepEqual(harness.scrollCalls, [{ block: "start" }]);
});

test("opening a Contest whose top remains visible does not move the viewport", () => {
  for (const contestTop of [0, 180]) {
    const harness = createHarness({ contestTop });

    harness.toggle();
    harness.frames[0]();

    assert.deepEqual(harness.scrollCalls, [], `Contest top ${contestTop}`);
  }
});

test("the visual viewport top determines whether the Contest is still visible", () => {
  const harness = createHarness({ contestTop: 20, viewportTop: 48 });

  harness.toggle();
  harness.frames[0]();

  assert.deepEqual(harness.scrollCalls, [{ block: "start" }]);
});

test("a Contest that closes before the next frame does not cause a stale scroll", () => {
  const harness = createHarness({ contestTop: -24 });

  harness.toggle();
  harness.contest.open = false;
  harness.frames[0]();

  assert.deepEqual(harness.scrollCalls, []);
});

test("closing a Contest does not schedule any scrolling work", () => {
  const harness = createHarness({ contestTop: -24, open: false });

  harness.toggle();

  assert.deepEqual(harness.frames, []);
  assert.deepEqual(harness.scrollCalls, []);
});
