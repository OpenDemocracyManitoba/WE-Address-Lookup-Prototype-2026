import { resolveApplicableContests } from "./contest-resolver.js";

export function renderApplicableContests({
  address,
  container,
  contests,
  templates,
}) {
  if (!address) {
    container.replaceChildren();
    return;
  }

  const nodes = resolveApplicableContests(address, contests).map(
    (applicableContestResolution) => {
      const templateKey = applicableContestResolution.contest?.id ??
        applicableContestResolution.office;
      return templates.get(templateKey).content.cloneNode(true);
    },
  );
  container.replaceChildren(...nodes);
}
