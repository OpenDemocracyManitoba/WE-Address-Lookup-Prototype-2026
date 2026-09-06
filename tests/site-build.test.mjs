import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { loadElectionPresentation } from "../election-presentation.js";

const projectRoot = new URL("../", import.meta.url);
const election = loadElectionPresentation();
const candidateDocument = JSON.parse(
  readFileSync(new URL("../data/election-2026/candidates.json", import.meta.url), "utf8"),
);

function readBuiltPage(path) {
  return readFileSync(new URL(`../_site/${path}`, import.meta.url), "utf8");
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function templateFor(html, key) {
  const start = html.indexOf(`data-contest-template="${key}"`);
  assert.ok(start >= 0, `${key} has a home-page Contest template`);
  return html.slice(start, html.indexOf("</template>", start));
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

  assert.match(home, /id="applicable-contests"/);
  assert.match(home, /id="contest-resolution-data" type="application\/json"/);
  let previousTemplateIndex = -1;
  for (const contest of election.contests) {
    const marker = `data-contest-template="${contest.id}"`;
    const templateIndex = home.indexOf(marker);
    assert.ok(templateIndex > previousTemplateIndex, `${contest.id} preserves inventory order`);
    previousTemplateIndex = templateIndex;

    const template = templateFor(home, contest.id);
    assert.ok(template.includes(`href="/contests/${contest.id}/"`));
    for (const candidate of contest.candidates) {
      assert.ok(
        template.includes(`>${escapeHtml(candidate.sourcePublishedName)}</h4>`),
        `${candidate.sourcePublishedName} appears in the ${contest.id} home-page template`,
      );
    }
  }

  const populated = election.contests.find((contest) => contest.candidates.length > 0);
  if (populated) {
    const populatedTemplate = templateFor(home, populated.id);
    assert.match(populatedTemplate, /<p class="candidate-role">(?:Prospective Candidate|Candidate)<\/p>/);
    assert.match(populatedTemplate, /<dt>Election Phase<\/dt><dd>(?:Registration|Nomination)<\/dd>/);
    assert.match(populatedTemplate, /<dt>Candidate Status<\/dt><dd>/);
    assert.match(
      populatedTemplate,
      new RegExp(`id="${populated.id}-candidate-order-explanation"[^>]*>Candidates are shown alphabetically by family name\\.<\\/p>`),
    );
    assert.match(
      populatedTemplate,
      new RegExp(`data-candidate-list aria-describedby="${populated.id}-candidate-order-explanation"`),
    );
  }

  const unresolvedTemplates = {
    Mayor:
      "Mayoral Contest information is unavailable because it could not be matched in the reviewed 2026 Contest inventory. No different Contest was selected.",
    Councillor:
      "Council Contest information is unavailable because the selected address's Council Ward could not be matched in the reviewed 2026 Contest inventory. No different Contest was selected.",
    "School Trustee":
      "School Trustee Contest information is unavailable because the selected address's School Division Ward could not be matched in the reviewed 2026 Contest inventory. No different Contest was selected.",
  };
  for (const [office, message] of Object.entries(unresolvedTemplates)) {
    const unresolvedTemplate = templateFor(home, office);
    assert.match(
      unresolvedTemplate,
      /<article class="applicable-contest unavailable-contest-resolution">/,
    );
    assert.match(unresolvedTemplate, new RegExp(`<p class="candidate-role">${office} Contest<\\/p>`));
    assert.match(unresolvedTemplate, /<h3>Contest information unavailable<\/h3>/);
    assert.ok(unresolvedTemplate.includes(message.replaceAll("'", "&#39;")));
  }

  for (const contest of election.contests.filter(
    ({ candidateList }) => candidateList.availability === "Unavailable",
  )) {
    const unsupportedTemplate = templateFor(home, contest.id);
    assert.match(unsupportedTemplate, /Candidate information unavailable/);
    assert.match(unsupportedTemplate, /does not mean that no Candidates exist/);
    assert.doesNotMatch(unsupportedTemplate, /No published Candidate Records/);
  }

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

  const mayorHeading = directory.indexOf(">Mayor</h2>");
  const councillorHeading = directory.indexOf(">Councillor</h2>");
  const trusteeHeading = directory.indexOf(">School Trustee</h2>");
  assert.ok(mayorHeading >= 0);
  assert.ok(mayorHeading < councillorHeading);
  assert.ok(councillorHeading < trusteeHeading);

  for (const contest of election.contests) {
    assert.match(directory, new RegExp(`href="/contests/${contest.id}/"`));
  }
});

test("production build publishes every current Candidate Record through the shared presentation", () => {
  for (const contest of election.contests) {
    const page = readBuiltPage(`contests/${contest.id}/index.html`);
    assert.match(page, /<main class="page-shell">/);
    assert.ok(page.includes(`<dd>${escapeHtml(contest.office)}</dd>`));
    assert.ok(page.includes(`<dd>${escapeHtml(contest.electoralArea.canonicalName)}</dd>`));
    assert.ok(page.includes(`<dd>${contest.numberToElect}</dd>`));
    assert.ok(page.includes(`<dd>${contest.candidateList.availability}</dd>`));

    let previousCandidateIndex = -1;
    for (const candidate of contest.candidates) {
      const heading = `>${escapeHtml(candidate.sourcePublishedName)}</h2>`;
      const candidateIndex = page.indexOf(heading);
      assert.ok(
        candidateIndex > previousCandidateIndex,
        `${candidate.sourcePublishedName} appears in presentation order on ${contest.id}`,
      );
      previousCandidateIndex = candidateIndex;
    }

    const renderedCandidateCount = page.match(/data-candidate-record/g)?.length ?? 0;
    assert.equal(
      renderedCandidateCount,
      contest.candidates.length,
      `${contest.id} renders exactly its presented Candidate Records`,
    );
    if (contest.candidates.length > 0) {
      assert.match(page, /Candidates are shown alphabetically by family name\./);
      assert.match(page, /<script type="module" src="\/assets\/candidate-order\.js"><\/script>/);
    }
  }
});

test("production Candidate markup reflects current optional fields and excludes withdrawn records", () => {
  for (const contest of election.contests) {
    const page = readBuiltPage(`contests/${contest.id}/index.html`);
    assert.doesNotMatch(page, /Not provided|Official Agent|Auditor/);
    for (const candidate of contest.candidates) {
      if (candidate.presentation.campaignUrl) {
        assert.ok(page.includes(`href="${escapeHtml(candidate.presentation.campaignUrl)}"`));
      }
      if (candidate.email) {
        assert.ok(page.includes(`href="mailto:${escapeHtml(candidate.email)}"`));
      }
      if (candidate.phone) {
        assert.ok(page.includes(`href="tel:${escapeHtml(candidate.presentation.phoneHref)}"`));
        assert.ok(page.includes(`>${escapeHtml(candidate.phone)}</a>`));
      }
      for (const socialLink of candidate.presentation.socialLinks) {
        assert.ok(page.includes(`href="${escapeHtml(socialLink.publicUrl)}"`));
        assert.ok(page.includes(`>${escapeHtml(socialLink.label)}</a>`));
      }
    }
  }

  const presentedNamesByContest = new Map(
    election.contests.map((contest) => [
      contest.id,
      new Set(contest.candidates.map(({ sourcePublishedName }) => sourcePublishedName)),
    ]),
  );
  const withdrawn = candidateDocument.candidates.filter(({ status }) =>
    ["Nomination Withdrawn", "Registration Withdrawn"].includes(status.value)
  );
  for (const candidate of withdrawn) {
    assert.equal(presentedNamesByContest.get(candidate.contestId)?.has(candidate.sourcePublishedName), false);
    assert.ok(
      !readBuiltPage(`contests/${candidate.contestId}/index.html`).includes(
        escapeHtml(candidate.sourcePublishedName),
      ),
      `${candidate.sourcePublishedName} is excluded from its Contest page`,
    );
  }
});

test("Contest browsing keeps unavailable Candidate information distinct from published lists", () => {
  const directory = readBuiltPage("contests/index.html");
  assert.match(directory, /<nav class="site-navigation" aria-label="Main navigation">[\s\S]*href="\/contests\/"/);

  for (const contest of election.contests.filter(
    ({ candidateList }) => candidateList.availability === "Unavailable",
  )) {
    const unavailable = readBuiltPage(`contests/${contest.id}/index.html`);
    assert.match(unavailable, /<dd>Unavailable<\/dd>/);
    assert.match(unavailable, /does not currently support Candidate data/);
    assert.match(unavailable, /does not mean that no Candidates exist/);
    assert.doesNotMatch(unavailable, /No published Candidate Records/);
  }
});
