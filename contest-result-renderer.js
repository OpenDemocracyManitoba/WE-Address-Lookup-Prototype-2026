import { resolveApplicableContests } from "./contest-resolver.js";

export function renderApplicableContests({
  address,
  container,
  contests,
  templates,
  unresolvedContestNode,
  randomize,
}) {
  if (!address) {
    container.replaceChildren();
    return;
  }

  const nodes = resolveApplicableContests(address, contests).map(
    (applicableContestResolution) => {
      const template = applicableContestResolution.contest
        ? templates.get(applicableContestResolution.contest.id)
        : null;
      if (template) return template.content.cloneNode(true);
      return unresolvedContestNode({
        ...applicableContestResolution,
        message:
          applicableContestResolution.message ??
          "Contest information could not be loaded. No different Contest was selected.",
      });
    },
  );
  container.replaceChildren(...nodes);
  randomize();
}
