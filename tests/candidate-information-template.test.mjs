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
    office: "Councillor",
    candidateList: { support: "supported", availability: "Published" },
    candidates: [],
  });

  assert.match(html, /<h2 id="candidate-information-heading">No published Candidate Records<\/h2>/);
  assert.match(html, /published, but it contained no Candidate Records when observed/);
  assert.doesNotMatch(html, /Candidate information unavailable|data-candidate-list/);
});

test("an Unavailable Candidate list never renders as a Published empty list", () => {
  const html = renderCandidateInformation({
    office: "School Trustee",
    electoralArea: { schoolDivision: "Fixture School Division" },
    candidateList: { support: "unsupported", availability: "Unavailable" },
    candidates: [],
  });

  assert.match(html, /Candidate list unavailable/);
  assert.match(html, /Fixture School Division runs this election, not the City of Winnipeg/);
  assert.match(html, /does not mean that no Candidates exist/);
  assert.doesNotMatch(html, /No published Candidate Records|data-candidate-list/);
});

test("a populated Contest renders contest-specific Candidate cards and campaign links without email or phone", () => {
  const html = renderCandidateInformation({
    office: "Councillor",
    candidateList: { support: "supported", availability: "Published" },
    candidates: [
      {
        sourcePublishedName: "Alex Example",
        phase: "registration",
        status: { sourceValue: "Registered", value: "Registered" },
        email: "alex@example.test",
        phone: "204-555-0100",
        presentation: {
          acclaimed: false,
          campaignUrl: "https://example.test/campaign",
          displayName: "Alex Example",
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
  assert.match(html, /<p class="candidate-role">Councillor Candidate<\/p>/);
  assert.match(html, /<h2>Alex Example<\/h2>/);
  assert.doesNotMatch(html, /Candidate information|candidate-metadata|Election Phase|Candidate Status|Registration Date/);
  assert.match(html, /href="https:\/\/example\.test\/campaign"/);
  assert.match(html, /Campaign links/);
  assert.doesNotMatch(html, /mailto:|tel:|alex@example\.test|204-555-0100/);
  assert.doesNotMatch(html, /No campaign website or social media listed/);
});

test("missing campaign links render a short City of Winnipeg notice instead of placeholder fields", () => {
  const html = renderCandidateInformation({
    office: "Mayor",
    candidateList: { support: "supported", availability: "Published" },
    candidates: [
      {
        sourcePublishedName: "No Contact Example",
        phase: "nomination",
        status: { sourceValue: "Nominated", value: "Nominated" },
        presentation: {
          acclaimed: false,
          campaignUrl: null,
          displayName: "No Contact Example",
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

  assert.match(html, /<p class="candidate-role">Mayor Candidate<\/p>/);
  assert.doesNotMatch(html, /Not provided|mailto:|tel:/);
  assert.match(html, /No campaign website or social media listed with the City of Winnipeg\./);
});
