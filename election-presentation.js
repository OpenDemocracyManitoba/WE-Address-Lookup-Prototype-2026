import { readFileSync } from "node:fs";

const collator = new Intl.Collator("en-CA", { numeric: true, sensitivity: "base" });

const phaseLabels = {
  nomination: "Nomination",
  registration: "Registration",
};

const roleLabels = {
  Nominated: "Candidate",
  "Not Nominated": "Not nominated",
  Registered: "Prospective Candidate",
  "Needs Review": "Candidate Record needs review",
};

const withdrawnStatuses = new Set(["Nomination Withdrawn", "Registration Withdrawn"]);

function familyNameSortValue(sourcePublishedName) {
  const publishedName = sourcePublishedName.replace(/\s+-\s+WITHDRAWN\s*$/iu, "").trim();
  return publishedName.split(/\s+/u).at(-1);
}

function externalUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//iu.test(value) ? value : `https://${value}`);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function displayDate(value) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-CA", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(value));
}

function phoneHref(value) {
  return value ? value.replace(/[^\d+]/gu, "") : null;
}

function socialLabel(value) {
  return {
    facebook: "Facebook",
    instagram: "Instagram",
    linkedin: "LinkedIn",
    twitter: "X (formerly Twitter)",
  }[value] ?? value;
}

function presentDisclosure(disclosure) {
  return {
    fileName: disclosure?.fileName,
    publicUrl: externalUrl(disclosure?.url),
  };
}

function presentCandidate(candidate) {
  const socialLinks = (candidate.socialLinks ?? [])
    .map((socialLink) => ({
      ...socialLink,
      label: socialLabel(socialLink.platform),
      publicUrl: externalUrl(socialLink.url),
    }))
    .filter((socialLink) => socialLink.publicUrl);
  return {
    ...candidate,
    presentation: {
      campaignUrl: externalUrl(candidate.campaignWebsite),
      financialDisclosure: presentDisclosure(candidate.financialDisclosure),
      imageUrl: externalUrl(candidate.imageUrl),
      phaseLabel: phaseLabels[candidate.phase],
      phoneHref: phoneHref(candidate.phone),
      registrationDate: displayDate(candidate.registrationDate),
      roleLabel: roleLabels[candidate.status.value],
      socialLinks,
      statementOfDisclosure: presentDisclosure(candidate.statementOfDisclosure),
    },
  };
}

export function presentElection(election, candidateDocument) {
  const visibleStatus = election.phase === "nomination" ? "Nominated" : "Registered";
  return {
    ...election,
    contests: election.contests.map((contest) => ({
      ...contest,
      candidates: candidateDocument.candidates
        .filter((candidate) =>
          candidate.contestId === contest.id
          && candidate.status.value === visibleStatus
          && !withdrawnStatuses.has(candidate.status.value)
        )
        .map(presentCandidate)
        .sort((left, right) =>
          collator.compare(
            familyNameSortValue(left.sourcePublishedName),
            familyNameSortValue(right.sourcePublishedName),
          ) || collator.compare(left.sourcePublishedName, right.sourcePublishedName),
        ),
    })),
  };
}

export function loadElectionPresentation() {
  const election = JSON.parse(readFileSync("data/election-2026/contests.json", "utf8"));
  const candidateDocument = JSON.parse(
    readFileSync("data/election-2026/candidates.json", "utf8"),
  );
  return presentElection(election, candidateDocument);
}
