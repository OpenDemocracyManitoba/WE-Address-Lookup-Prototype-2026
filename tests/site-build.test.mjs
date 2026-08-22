import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const projectRoot = new URL("../", import.meta.url);

function readBuiltPage(path) {
  return readFileSync(new URL(`../_site/${path}`, import.meta.url), "utf8");
}

test("production build publishes the shared site shell and Address Lookup assets", () => {
  const command = process.platform === "win32"
    ? [process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm run build --silent"]]
    : ["npm", ["run", "build", "--silent"]];
  execFileSync(command[0], command[1], {
    cwd: projectRoot,
    stdio: "pipe",
  });

  const pages = ["index.html", "learn/index.html", "about/index.html", "faq/index.html"]
    .map(readBuiltPage);

  for (const html of pages) {
    assert.match(html, /<nav class="site-navigation" aria-label="Main navigation">/);
    assert.match(html, /href="\/learn\/"/);
    assert.match(html, /href="\/about\/"/);
    assert.match(html, /href="\/faq\/"/);
    assert.match(html, /href="\/assets\/styles\.css"/);
  }

  assert.match(pages[0], /id="address-input"/);
  assert.match(pages[0], /<script type="module" src="\/assets\/app\.js"><\/script>/);
  assert.match(readFileSync(new URL("../_site/assets/app.js", import.meta.url), "utf8"), /LookupController/);
});
