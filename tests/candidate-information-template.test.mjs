import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import nunjucks from "nunjucks";

const templates = nunjucks.configure(
  fileURLToPath(new URL("../_includes", import.meta.url)),
  { autoescape: true, noCache: true },
);
const template = `
{% from "macros/candidate-information.njk" import candidateInformation %}
{{ candidateInformation(contest) }}
`;

function renderCandidateInformation(contest) {
  return templates.renderString(template, { contest });
}

test("a Published Contest with zero Candidate Records renders an empty-list notice", () => {
  const html = renderCandidateInformation({
    candidateList: { support: "supported", availability: "Published" },
    candidates: [],
  });

  assert.match(html, /<h2 id="candidate-information-heading">No published Candidate Records<\/h2>/);
  assert.match(html, /published, but it contained no Candidate Records when observed/);
  assert.doesNotMatch(html, /Candidate information unavailable|data-candidate-list/);
});

test("an Unavailable Candidate list never renders as a Published empty list", () => {
  const html = renderCandidateInformation({
    candidateList: { support: "unsupported", availability: "Unavailable" },
    candidates: [],
  });

  assert.match(html, /Candidate information unavailable/);
  assert.match(html, /does not mean that no Candidates exist/);
  assert.doesNotMatch(html, /No published Candidate Records|data-candidate-list/);
});

test("a populated Contest renders Candidate metadata and optional contact fields", () => {
  const html = renderCandidateInformation({
    candidateList: { support: "supported", availability: "Published" },
    candidates: [
      {
        sourcePublishedName: "Alex Example",
        phase: "registration",
        status: { sourceValue: "Registered", value: "Registered" },
        email: "alex@example.test",
        phone: "204-555-0100",
        presentation: {
          campaignUrl: "https://example.test/campaign",
          financialDisclosure: { fileName: undefined, publicUrl: null },
          imageUrl: null,
          phaseLabel: "Registration",
          phoneHref: "2045550100",
          registrationDate: "September 1, 2026",
          roleLabel: "Prospective Candidate",
          socialLinks: [],
          statementOfDisclosure: { fileName: undefined, publicUrl: null },
        },
      },
    ],
  });

  assert.match(html, /data-candidate-list/);
  assert.match(html, /<p class="candidate-role">Prospective Candidate<\/p>/);
  assert.match(html, /<h2>Alex Example<\/h2>/);
  assert.match(html, /<dt>Election Phase<\/dt><dd>Registration<\/dd>/);
  assert.match(html, /<dt>Candidate Status<\/dt><dd>Registered<\/dd>/);
  assert.match(html, /href="https:\/\/example\.test\/campaign"/);
  assert.match(html, /href="mailto:alex@example\.test"/);
  assert.match(html, /href="tel:2045550100"/);
});

test("missing optional Candidate fields do not create placeholder markup", () => {
  const html = renderCandidateInformation({
    candidateList: { support: "supported", availability: "Published" },
    candidates: [
      {
        sourcePublishedName: "No Contact Example",
        phase: "nomination",
        status: { sourceValue: "Nominated", value: "Nominated" },
        presentation: {
          campaignUrl: null,
          financialDisclosure: { fileName: undefined, publicUrl: null },
          imageUrl: null,
          phaseLabel: "Nomination",
          phoneHref: null,
          registrationDate: null,
          roleLabel: "Candidate",
          socialLinks: [],
          statementOfDisclosure: { fileName: undefined, publicUrl: null },
        },
      },
    ],
  });

  assert.match(html, /<p class="candidate-role">Candidate<\/p>/);
  assert.doesNotMatch(html, /candidate-contact|Not provided|mailto:|tel:/);
});
