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
const acclaimedSuffix = /\s+-\s+ACCLAIMED\s*$/iu;

function familyNameSortValue(sourcePublishedName) {
  const publishedName = sourcePublishedName.replace(/\s+-\s+(?:WITHDRAWN|ACCLAIMED)\s*$/iu, "").trim();
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
      acclaimed: acclaimedSuffix.test(candidate.sourcePublishedName),
      campaignUrl: externalUrl(candidate.campaignWebsite),
      displayName: candidate.sourcePublishedName.replace(acclaimedSuffix, "").trim(),
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

// Contests the City does not run (Seine River, Interlake) remain Applicable
// Contests for Address Lookup but are omitted from the Contest Directory.
export function directoryContests(election) {
  return election.contests.filter(
    ({ candidateList }) => candidateList.availability !== "Unavailable",
  );
}

export function loadElectionPresentation() {
  const election = JSON.parse(readFileSync("data/election-2026/contests.json", "utf8"));
  const candidateDocument = JSON.parse(
    readFileSync("data/election-2026/candidates.json", "utf8"),
  );
  return presentElection(election, candidateDocument);
}

// Canadian Press month abbreviations: "Oct. 20", "Sept. 26", "May 4".
const newsMonths = ["Jan.", "Feb.", "March", "April", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
const raceCoverageKinds = new Set(["race_profile", "race_guide"]);

function newsDate(value) {
  if (!value) return null;
  const [, month, day] = value.split("-").map(Number);
  return `${newsMonths[month - 1]} ${day}`;
}

function presentCoverageItem(item) {
  return {
    ...item,
    displayDate: newsDate(item.date),
    publicUrl: externalUrl(item.url),
    video: item.format === "video",
  };
}

// News coverage is keyed by Contest id and links candidates by their City
// dataset record id. Unknown keys fail the build rather than being guessed at.
export function presentContestCoverage(coverageDocument, election) {
  const contestsById = new Map(directoryContests(election).map((contest) => [contest.id, contest]));
  const { compiled } = coverageDocument.meta;
  const coverage = {
    compiled: `${newsDate(compiled)}, ${compiled.slice(0, 4)}`,
    contests: {},
  };
  for (const [contestId, { items }] of Object.entries(coverageDocument.contests)) {
    const contest = contestsById.get(contestId);
    if (!contest) throw new Error(`News coverage names unknown Contest "${contestId}"`);
    const recordIds = new Set(contest.candidates.map((candidate) => candidate.source.recordId));
    const presented = items.map(presentCoverageItem);
    const raceItems = presented.filter((item) => raceCoverageKinds.has(item.kind));
    const candidateItems = {};
    for (const item of presented) {
      if (raceCoverageKinds.has(item.kind) || item.kind === "all_wards_roundup") continue;
      for (const { candidate_id: recordId, name_official: name } of item.candidates) {
        if (!recordIds.has(recordId)) {
          throw new Error(`News coverage names unknown Candidate ${recordId} (${name}) in ${contestId}`);
        }
        (candidateItems[recordId] ??= []).push(item);
      }
    }
    coverage.contests[contestId] = {
      raceItems,
      roundups: raceItems.length ? presented.filter((item) => item.kind === "all_wards_roundup") : [],
      candidateItems,
    };
  }
  return coverage;
}

export function loadContestCoverage() {
  return presentContestCoverage(
    JSON.parse(readFileSync("data/election-2026/contest_coverage.json", "utf8")),
    loadElectionPresentation(),
  );
}
