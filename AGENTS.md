# Winnipeg Election 2026

Small static Eleventy site for helping Winnipeg residents find their 2026 municipal and school-board election contests from a civic address.

## Stack

- Eleventy 3 + Nunjucks
- Vanilla JavaScript and CSS
- No application framework
- `npm start` — local development
- `npm test` — deterministic tests
- `npm run build` — production build

## Working style

Prefer the smallest change that solves the requested problem. Do not introduce new abstractions, dependencies, workflows, documentation, or architecture unless the task actually requires them.

Run relevant tests after code changes. Run the full suite when the change could affect multiple areas.

Never edit `_site/`; it is generated output.

## Where to look

- `index.html` — root page template and primary site markup
- `_includes/` — shared Eleventy templates, layouts, and reusable partials
- `contests/` — contest-specific pages and templates
- `app.js` — browser UI/event wiring
- `lookup-controller.js` — address lookup coordination
- `contest-resolver.js` — applicable election contests
- `election-presentation.js` — election presentation logic
- `styles.css` — site styling
- `scripts/import-candidates.mjs` — Candidate data import
- `data/election-2026/` — election data and preserved source evidence
- `about/`, `faq/`, `learn/` — placeholder sections for now; do not assume their current content or structure is final

## Domain and election data

For ordinary UI, styling, accessibility, or isolated implementation work, do not read the election domain documentation unless it becomes relevant.

When changing election concepts, Candidate data, Contest identities, authoritative-source handling, address semantics, or other domain behaviour, read `CONTEXT.md` and the relevant ADRs in `docs/adr/`.

Use the domain terminology defined in `CONTEXT.md` rather than introducing alternate names for established concepts. If a proposed change conflicts with an existing ADR, surface the conflict rather than silently overriding the decision.

For 2026 election source/data work, consult `docs/election-2026/`.

Preserve the project's nonpartisan presentation, source provenance, and rule that entered visitor addresses are not retained.

## GitHub CLI

The GitHub CLI (`gh`) is available at:

`C:\Users\kgeske\AppData\Local\Programs\GitHubCLI\2.98.0\bin\gh.exe`

Use it when GitHub-specific information or actions are needed, such as inspecting or creating issues and pull requests, checking repository metadata, or reviewing CI status.
