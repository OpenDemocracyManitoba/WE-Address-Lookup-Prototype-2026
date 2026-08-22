export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({
    "address-data.js": "assets/address-data.js",
    "app.js": "assets/app.js",
    "lookup-controller.js": "assets/lookup-controller.js",
    "popup-geometry.js": "assets/popup-geometry.js",
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
    templateFormats: ["html", "md"],
  };
}
