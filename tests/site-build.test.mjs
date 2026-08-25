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

test("the home page publishes ordered Contest templates from the shared Candidate presentation", () => {
  const home = readBuiltPage("index.html");
  const mayor = home.indexOf('data-contest-template="mayor-winnipeg"');
  const councillor = home.indexOf(
    'data-contest-template="council-fort-rouge-east-fort-garry"',
  );
  const schoolTrustee = home.indexOf(
    'data-contest-template="school-winnipeg-ward-5"',
  );

  assert.match(home, /id="applicable-contests"/);
  assert.match(home, /id="contest-resolution-data" type="application\/json"/);
  assert.ok(mayor >= 0);
  assert.ok(mayor < councillor);
  assert.ok(councillor < schoolTrustee);
  assert.match(home, /href="\/contests\/mayor-winnipeg\/"/);
  assert.match(home, />Scott Gillingham<\/h4>/);
  assert.match(home, /<p class="candidate-role">Prospective Candidate<\/p>/);
  assert.match(home, /<dt>Election Phase<\/dt><dd>Registration<\/dd>/);
  assert.match(home, /<dt>Candidate Status<\/dt><dd>Registered<\/dd>/);
  assert.match(
    home,
    /id="mayor-winnipeg-candidate-order-explanation"[^>]*>Candidates are shown alphabetically by family name\.<\/p>/,
  );
  assert.match(
    home,
    /data-candidate-list aria-describedby="mayor-winnipeg-candidate-order-explanation"/,
  );
  assert.match(home, /href="\/contests\/council-fort-rouge-east-fort-garry\/"/);
  assert.match(home, />Jeff Palmer<\/h4>/);
  assert.match(home, /href="\/contests\/school-winnipeg-ward-5\/"/);
  assert.match(home, />Tim Bigelow<\/h4>/);

  const unresolvedTemplates = {
    Mayor:
      "Mayoral Contest information is unavailable because it could not be matched in the reviewed 2026 Contest inventory. No different Contest was selected.",
    Councillor:
      "Council Contest information is unavailable because the selected address's Council Ward could not be matched in the reviewed 2026 Contest inventory. No different Contest was selected.",
    "School Trustee":
      "School Trustee Contest information is unavailable because the selected address's School Division Ward could not be matched in the reviewed 2026 Contest inventory. No different Contest was selected.",
  };
  for (const [office, message] of Object.entries(unresolvedTemplates)) {
    const start = home.indexOf(`data-contest-template="${office}"`);
    const unresolvedTemplate = home.slice(start, home.indexOf("</template>", start));
    assert.ok(start >= 0);
    assert.match(
      unresolvedTemplate,
      /<article class="applicable-contest unavailable-contest-resolution">/,
    );
    assert.match(unresolvedTemplate, new RegExp(`<p class="candidate-role">${office} Contest<\\/p>`));
    assert.match(unresolvedTemplate, /<h3>Contest information unavailable<\/h3>/);
    assert.ok(unresolvedTemplate.includes(message.replaceAll("'", "&#39;")));
  }

  const unsupportedTemplate = home.slice(
    home.indexOf('data-contest-template="school-seine-river-ward-1"'),
    home.indexOf(
      "</template>",
      home.indexOf('data-contest-template="school-seine-river-ward-1"'),
    ),
  );
  assert.match(unsupportedTemplate, /Candidate information unavailable/);
  assert.match(unsupportedTemplate, /does not mean that no Candidates exist/);
  assert.doesNotMatch(unsupportedTemplate, /No published Candidate Records/);

  const builtApp = readFileSync(
    new URL("../_site/assets/app.js", import.meta.url),
    "utf8",
  );
  assert.match(builtApp, /renderApplicableContests/);
  assert.match(builtApp, /randomizeCandidateLists/);
  assert.match(
    readFileSync(
      new URL("../_site/assets/contest-result-renderer.js", import.meta.url),
      "utf8",
    ),
    /resolveApplicableContests/,
  );
  assert.match(
    readFileSync(
      new URL("../_site/assets/contest-resolver.js", import.meta.url),
      "utf8",
    ),
    /export function resolveApplicableContests/,
  );
});

test("production build publishes the Contest Directory in Office order", () => {
  const directory = readBuiltPage("contests/index.html");
  const inventory = JSON.parse(
    readFileSync(new URL("../data/election-2026/contests.json", import.meta.url), "utf8"),
  );

  const mayorHeading = directory.indexOf(">Mayor</h2>");
  const councillorHeading = directory.indexOf(">Councillor</h2>");
  const trusteeHeading = directory.indexOf(">School Trustee</h2>");
  assert.ok(mayorHeading >= 0);
  assert.ok(mayorHeading < councillorHeading);
  assert.ok(councillorHeading < trusteeHeading);

  for (const contest of inventory.contests) {
    assert.match(directory, new RegExp(`href="/contests/${contest.id}/"`));
  }
});

test("production build publishes accessible Contest pages with alphabetical Candidate Records", () => {
  const inventory = JSON.parse(
    readFileSync(new URL("../data/election-2026/contests.json", import.meta.url), "utf8"),
  );
  for (const contest of inventory.contests) {
    assert.match(readBuiltPage(`contests/${contest.id}/index.html`), /<main class="page-shell">/);
  }

  const page = readBuiltPage("contests/council-elmwood-east-kildonan/index.html");
  assert.match(page, /<dt>Office<\/dt>\s*<dd>Councillor<\/dd>/);
  assert.match(page, /<dt>Electoral Area<\/dt>\s*<dd>Elmwood–East Kildonan<\/dd>/);
  assert.match(page, /<dt>Number to Elect<\/dt>\s*<dd>1<\/dd>/);
  assert.match(page, /<dt>Candidate List Availability<\/dt>\s*<dd>Published<\/dd>/);
  assert.match(page, /<dt>Election Phase<\/dt>\s*<dd>Registration<\/dd>/);
  assert.match(page, /<dt>Candidate Status<\/dt>\s*<dd>Registered<\/dd>/);
  assert.match(page, /href="https:\/\/www\.voteabel\.com\/"/);
  assert.match(page, /href="mailto:abelj18@hotmail\.com"/);
  assert.match(page, />204-960-4744<\/a>/);
  assert.doesNotMatch(page, /Not provided|Official Agent|Auditor/);

  const expectedOrder = ["Adam Dudek", "Emma Durand-Wood", "Abel Gutierrez", "Christian Sweryda", "Jessica Wiebe"];
  let previousIndex = -1;
  for (const name of expectedOrder) {
    const index = page.indexOf(`>${name}</h2>`);
    assert.ok(index > previousIndex, `${name} appears in derived family-name order`);
    previousIndex = index;
  }
  assert.match(page, /Candidates are shown alphabetically by family name\./);
  assert.match(page, /<script type="module" src="\/assets\/candidate-order\.js"><\/script>/);
});

test("Contest browsing distinguishes published, empty, and unavailable Candidate information", () => {
  const directory = readBuiltPage("contests/index.html");
  assert.match(directory, /<nav class="site-navigation" aria-label="Main navigation">[\s\S]*href="\/contests\/"/);

  const publishedEmpty = readBuiltPage("contests/school-winnipeg-ward-2/index.html");
  assert.match(publishedEmpty, /<dd>Published<\/dd>/);
  assert.match(publishedEmpty, /No published Candidate Records/);
  assert.doesNotMatch(publishedEmpty, /does not currently support Candidate data/);

  for (const contestId of ["school-seine-river-ward-1", "school-interlake-ward-1"]) {
    const unavailable = readBuiltPage(`contests/${contestId}/index.html`);
    assert.match(unavailable, /<dd>Unavailable<\/dd>/);
    assert.match(unavailable, /does not currently support Candidate data/);
    assert.match(unavailable, /does not mean that no Candidates exist/);
  }

  const withdrawn = readBuiltPage("contests/council-fort-rouge-east-fort-garry/index.html");
  assert.match(withdrawn, />Jeff Palmer<\/h2>/);
  assert.doesNotMatch(withdrawn, /Sherri Rollins  - WITHDRAWN/);
  assert.doesNotMatch(withdrawn, /Registration Withdrawn/);
});
