const OFFICE_ORDER = Object.freeze(["Mayor", "Councillor", "School Trustee"]);

function hasAlias(contest, sourceLabel) {
  return Boolean(sourceLabel) && contest.aliases.includes(sourceLabel);
}

const unresolvedMessages = Object.freeze({
  Mayor:
    "Mayoral Contest information is unavailable because it could not be matched in the reviewed 2026 Contest inventory. No different Contest was selected.",
  Councillor:
    "Council Contest information is unavailable because the selected address's Council Ward could not be matched in the reviewed 2026 Contest inventory. No different Contest was selected.",
  "School Trustee":
      "School Trustee Contest information is unavailable because the selected address's School Division Ward could not be matched in the reviewed 2026 Contest inventory. No different Contest was selected.",
});

function resolvedSlot(office, contest) {
  return contest
    ? { office, status: "resolved", contest }
    : {
        office,
        status: "unresolved",
        contest: null,
        message: unresolvedMessages[office],
      };
}

export function resolveApplicableContests(address, contests) {
  const mayor = contests.find(
    (contest) =>
      contest.office === "Mayor" && contest.electoralArea.kind === "citywide",
  );
  const councillor = contests.find(
    (contest) =>
      contest.office === "Councillor" &&
      hasAlias(contest, address.councilWard),
  );
  const schoolSourceLabel =
    address.schoolDivision && address.schoolDivisionWard
      ? `${address.schoolDivision} / ${address.schoolDivisionWard}`
      : null;
  const schoolTrustee = contests.find(
    (contest) =>
      contest.office === "School Trustee" &&
      hasAlias(contest, schoolSourceLabel),
  );
  const matches = {
    Mayor: mayor,
    Councillor: councillor,
    "School Trustee": schoolTrustee,
  };

  return OFFICE_ORDER.map((office) => resolvedSlot(office, matches[office]));
}
