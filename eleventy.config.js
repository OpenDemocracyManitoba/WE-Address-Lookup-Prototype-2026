import {
  displayDate,
  externalUrl,
  loadElectionPresentation,
  phoneHref,
  socialLabel,
} from "./election-presentation.js";

export default function (eleventyConfig) {
  eleventyConfig.addGlobalData("election", loadElectionPresentation);
  eleventyConfig.addFilter("externalUrl", externalUrl);
  eleventyConfig.addFilter("displayDate", displayDate);
  eleventyConfig.addFilter("phoneHref", phoneHref);
  eleventyConfig.addFilter("socialLabel", socialLabel);
  eleventyConfig.addFilter("contestResolutionData", (contests) =>
    contests.map(({ id, office, electoralArea, aliases, candidateList }) => ({
      id,
      office,
      electoralArea,
      aliases,
      candidateList,
    }))
  );
  eleventyConfig.addFilter("jsonForHtml", (value) =>
    JSON.stringify(value).replaceAll("<", "\\u003c")
  );

  eleventyConfig.addPassthroughCopy({
    "address-data.js": "assets/address-data.js",
    "app.js": "assets/app.js",
    "lookup-controller.js": "assets/lookup-controller.js",
    "popup-geometry.js": "assets/popup-geometry.js",
    "candidate-order.js": "assets/candidate-order.js",
    "contest-resolver.js": "assets/contest-resolver.js",
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
