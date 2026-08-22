import { readFileSync } from "node:fs";

const collator = new Intl.Collator("en-CA", { numeric: true, sensitivity: "base" });

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

export default function (eleventyConfig) {
  eleventyConfig.addGlobalData("election", () => {
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
          .sort((left, right) =>
            collator.compare(
              familyNameSortValue(left.sourcePublishedName),
              familyNameSortValue(right.sourcePublishedName),
            ) || collator.compare(left.sourcePublishedName, right.sourcePublishedName),
          ),
      })),
    };
  });
  eleventyConfig.addFilter("externalUrl", externalUrl);
  eleventyConfig.addFilter("displayDate", (value) =>
    new Intl.DateTimeFormat("en-CA", {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
      year: "numeric",
    }).format(new Date(value)),
  );
  eleventyConfig.addFilter("phoneHref", (value) => value.replace(/[^\d+]/gu, ""));
  eleventyConfig.addFilter("socialLabel", (value) => ({
    facebook: "Facebook",
    instagram: "Instagram",
    linkedin: "LinkedIn",
    twitter: "X (formerly Twitter)",
  })[value] ?? value);

  eleventyConfig.addPassthroughCopy({
    "address-data.js": "assets/address-data.js",
    "app.js": "assets/app.js",
    "lookup-controller.js": "assets/lookup-controller.js",
    "popup-geometry.js": "assets/popup-geometry.js",
    "candidate-order.js": "assets/candidate-order.js",
    "styles.css": "assets/styles.css",
  });

  return {
    dir: {
      input: ".",
      includes: "_includes",
      output: "_site",
    },
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
    templateFormats: ["html", "md", "njk"],
  };
}
