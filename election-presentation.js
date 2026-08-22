import { readFileSync } from "node:fs";

const collator = new Intl.Collator("en-CA", { numeric: true, sensitivity: "base" });

const phaseLabels = {
  nomination: "Nomination",
  registration: "Registration",
};

const roleLabels = {
  Nominated: "Candidate",
  "Nomination Withdrawn": "Nomination withdrawn",
  "Not Nominated": "Not nominated",
  Registered: "Prospective Candidate",
  "Registration Withdrawn": "Registration withdrawn",
  "Needs Review": "Candidate Record needs review",
};

function familyNameSortValue(sourcePublishedName) {
  const publishedName = sourcePublishedName.replace(/\s+-\s+WITHDRAWN\s*$/iu, "").trim();
  return publishedName.split(/\s+/u).at(-1);
}

function presentCandidate(candidate) {
  const socialLinks = (candidate.socialLinks ?? [])
    .map((socialLink) => ({
      ...socialLink,
      publicUrl: externalUrl(socialLink.url),
    }))
    .filter((socialLink) => socialLink.publicUrl);
  return {
    ...candidate,
    presentation: {
      phaseLabel: phaseLabels[candidate.phase],
      roleLabel: roleLabels[candidate.status.value],
      socialLinks,
    },
  };
}

export function loadElectionPresentation() {
  const election = JSON.parse(readFileSync("data/election-2026/contests.json", "utf8"));
  const candidateDocument = JSON.parse(
    readFileSync("data/election-2026/candidates.json", "utf8"),
  );
  return {
    ...election,
    contests: election.contests.map((contest) => ({
      ...contest,
      candidates: candidateDocument.candidates
        .filter((candidate) => candidate.contestId === contest.id)
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

export function externalUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//iu.test(value) ? value : `https://${value}`);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function displayDate(value) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(value));
}

export function phoneHref(value) {
  return value.replace(/[^\d+]/gu, "");
}

export function socialLabel(value) {
  return {
    facebook: "Facebook",
    instagram: "Instagram",
    linkedin: "LinkedIn",
    twitter: "X (formerly Twitter)",
  }[value] ?? value;
}
