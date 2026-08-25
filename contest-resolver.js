const OFFICES = Object.freeze({
  MAYOR: "Mayor",
  COUNCILLOR: "Councillor",
  SCHOOL_TRUSTEE: "School Trustee",
});
const RESOLUTION_STATUS = Object.freeze({
  RESOLVED: "resolved",
  UNRESOLVED: "unresolved",
});
const OFFICE_ORDER = Object.freeze([
  OFFICES.MAYOR,
  OFFICES.COUNCILLOR,
  OFFICES.SCHOOL_TRUSTEE,
]);

function hasAlias(contest, sourceLabel) {
  return Boolean(sourceLabel) && contest.aliases.includes(sourceLabel);
}

function createApplicableContestResolution(office, contest) {
  return contest
    ? { office, status: RESOLUTION_STATUS.RESOLVED, contest }
    : {
        office,
        status: RESOLUTION_STATUS.UNRESOLVED,
        contest: null,
      };
}

export function resolveApplicableContests(address, contests) {
  const mayor = contests.find(
    (contest) =>
      contest.office === OFFICES.MAYOR &&
      contest.electoralArea.kind === "citywide",
  );
  const councillor = contests.find(
    (contest) =>
      contest.office === OFFICES.COUNCILLOR &&
      hasAlias(contest, address.councilWard),
  );
  const schoolSourceLabel =
    address.schoolDivision && address.schoolDivisionWard
      ? `${address.schoolDivision} / ${address.schoolDivisionWard}`
      : null;
  const schoolTrustee = contests.find(
    (contest) =>
      contest.office === OFFICES.SCHOOL_TRUSTEE &&
      hasAlias(contest, schoolSourceLabel),
  );
  const matches = {
    [OFFICES.MAYOR]: mayor,
    [OFFICES.COUNCILLOR]: councillor,
    [OFFICES.SCHOOL_TRUSTEE]: schoolTrustee,
  };

  return OFFICE_ORDER.map((office) =>
    createApplicableContestResolution(office, matches[office])
  );
}
