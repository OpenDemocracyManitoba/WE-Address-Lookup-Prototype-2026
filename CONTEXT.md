# Winnipeg Election 2026

Winnipeg Election is a nonpartisan voter resource for the 2026 Municipal Council and School Boards Election. It helps people discover the electoral contests associated with a Winnipeg address and learn about the candidates in those contests.

## Language

### Election

**Election**:
The 2026 Municipal Council and School Boards Election, in which Winnipeg electors elect a Mayor, Councillors, and School Trustees.
_Avoid_: Election cycle, election event

**Office**:
An elected role filled through the Election: Mayor, Councillor, or School Trustee.
_Avoid_: Contest, race, seat

**Contest**:
The election of an Office for an Electoral Area; a Contest may elect one or more people. Race is an accepted synonym, especially in public-facing language.
_Avoid_: Office

**Number to Elect**:
The number of people elected in a Contest.
_Avoid_: Number of candidates, number of offices

**Candidacy**:
A Person's participation in one Contest.
_Avoid_: Person, contest

**Person**:
An individual who may have a Candidacy in a Contest.
_Avoid_: Candidate when referring to the individual independently of a contest

**Prospective Candidate**:
A Person who has registered to seek an Office but whose nomination papers have not been accepted.
_Avoid_: Candidate, registered candidate

**Candidate**:
A Person whose nomination papers for a Contest have been accepted by the Senior Election Official.
_Avoid_: Prospective candidate, registrant

**Candidacy Status**:
Winnipeg Election's normalized state of a Candidacy: Registered, Registration Withdrawn, Nominated, Nomination Withdrawn, Not Nominated, or Needs Review. The raw source status remains separate and does not determine this state without normalization.
_Avoid_: Candidate type, active flag

**Contest Status**:
The official state of a Contest after nominations: Awaiting Official Candidate List, Election Required, Acclaimed, or Needs Review.
_Avoid_: Candidacy status, candidate status

**Election Result**:
The official declared outcome of a Contest after voting or acclamation.
_Avoid_: Address lookup result, candidate list

### Governance

**Municipal Government**:
The City of Winnipeg's system of local government under an elected Mayor and City Council.
_Avoid_: School board, provincial government

**City Council**:
Winnipeg's governing body, composed of the Mayor and 15 Councillors.
_Avoid_: Municipal government, school board

**Mayor**:
The citywide elected head of City Council.
_Avoid_: Councillor, council

**Councillor**:
An elected member of City Council who represents one Council Ward.
_Avoid_: Trustee, mayor

**School Board**:
The elected governing body of a School Division, composed of School Trustees.
_Avoid_: School division, city council

**School Trustee**:
An elected member of a School Board.
_Avoid_: Councillor, school division

### Candidate Data

**Current Official Candidate List**:
The time-stamped set of Candidates currently recognized by official sources for the Election's Contests. It excludes Prospective Candidates and people whose Candidacies are no longer active, but is not considered immutable.
_Avoid_: Final candidate list

**Candidate Publication Mode**:
The visibility policy controlling which Candidacies are public: Registration mode shows published Prospective Candidates and their statuses, while Nominated mode shows only active Candidates. Nominated mode begins only after the post-withdrawal official list has been verified.
_Avoid_: Nomination-complete flag, automatic deadline switch

**Official Candidate Record**:
Information an Authoritative Source publishes to identify a Person's Candidacy, Contest, and Candidacy Status.
_Avoid_: Candidate-provided information, person

**Candidate-Provided Information**:
Contact or campaign information a Person supplies through an Authoritative Source, such as a phone number, email address, website, social account, official agent, or auditor. Publication by an authority does not mean that authority independently verified the information.
_Avoid_: Official candidate record, verified candidate information

**Candidate List Availability**:
The verification state of candidate information for a Contest: Not Published, Published, or Needs Review. A Published list may contain zero Candidates; missing source data never means that no Candidates exist.
_Avoid_: Candidate count, source availability

**Source Snapshot**:
An immutable capture of an Authoritative Source as Winnipeg Election observed it at a particular time, before its records were normalized.
_Avoid_: Current candidate list, normalized data

**Authoritative Source**:
The official source designated to establish a particular kind of election information. Authority is specific to a domain concept rather than granted universally to every City or school-division publication.
_Avoid_: A single source of truth for all election data

### Electoral Geography

**Electoral Area**:
The geographic area for which an Office is elected: Winnipeg as a whole, a Council Ward, or a School Division Ward.
_Avoid_: District, unqualified ward

**2026 Electoral Geography**:
The Council Wards, School Divisions, School Division Wards, Numbers to Elect, and Civic Address assignments applicable to this Election.
_Avoid_: Current boundaries, timeless electoral geography

**Council Ward**:
An area of Winnipeg that elects one Councillor.
_Avoid_: Municipal ward, city ward, unqualified ward

**School Division**:
A named public-education authority, such as Louis Riel School Division or Seven Oaks School Division.
_Avoid_: School district, school ward

**School Division Ward**:
An electoral area within a School Division that elects one or more School Trustees. Its identity requires both the School Division and its numbered or named ward label, such as `Louis Riel — 1` or `St. James - Assiniboia — Centre Ward`.
_Avoid_: Trustee ward, school ward, unqualified ward number or name

**Canonical Name**:
Winnipeg Election's authoritative display name for an electoral entity, independent of the spelling, punctuation, or abbreviations used by any source.
_Avoid_: Source label, normalized source string

**Source Label**:
A name used for an electoral entity by a particular Authoritative Source and explicitly mapped to its Winnipeg Election identity.
_Avoid_: Canonical name, entity identity

### Address Lookup

**Civic Address**:
An official building-level Winnipeg address; it may identify a residential or non-residential property. Unit numbers are not part of a Civic Address for this Election.
_Avoid_: Residence, full address

**Electoral Assignment**:
The Council Ward, School Division, and School Division Ward associated with a Civic Address.
_Avoid_: Ballot, residence

**Address Lookup**:
The use of a Civic Address to identify its Electoral Assignment and associated Contests. It does not establish a visitor's identity, legal eligibility, voter registration, or guaranteed ballot.
_Avoid_: Ballot lookup, eligibility check

**Address Interpretation**:
One possible structural reading of address text entered for an Address Lookup.
_Avoid_: Candidate, parser candidate

**Query Alternative**:
A City address-service query alternative derived from one or more Address Interpretations.
_Avoid_: Candidate, Address Interpretation

**Lookup Ready**:
The state in which entered address text is sufficiently complete to perform an Address Lookup. It does not describe a Visitor's eligibility or the status of an address.
_Avoid_: Eligible, eligibility

**Address Lookup Result**:
The selected Civic Address, its Electoral Assignment, and the Applicable Contests returned by an Address Lookup.
_Avoid_: Election result, ballot

**Applicable Contest**:
A Contest selected by an Electoral Assignment: the citywide Mayoral Contest, the assigned Council Ward's Council Contest, or the assigned School Division Ward's School Trustee Contest.
_Avoid_: Ballot contest, the visitor's contest

**Contest Directory**:
The address-independent way for Visitors to browse every Contest by Office and Electoral Area. It exposes the same Contests and Candidacies used by Address Lookup rather than maintaining a separate candidate list.
_Avoid_: Candidate database, alternate candidate list

### People

**Visitor**:
Any person using Winnipeg Election, whether or not they are eligible or intend to vote.
_Avoid_: User, voter when eligibility or intent is unknown

**Voter**:
A person who votes or intends to vote; also the intended audience of Winnipeg Election in public-facing language.
_Avoid_: Elector when referring specifically to legal eligibility

**Elector**:
A person legally entitled to vote in an election. Winnipeg Election does not determine whether a visitor is an elector.
_Avoid_: Visitor, voter when referring specifically to legal eligibility

### Content and Sources

**Explainer**:
Existing English-language educational content written by Open Democracy Manitoba for its election resources.
_Avoid_: Official guidance, official information

**Official Resource**:
Election information published by the City of Winnipeg, the Province of Manitoba, a school division, or another responsible election authority.
_Avoid_: Explainer, campaign information

**Campaign Source**:
Information controlled by a Candidate, Prospective Candidate, or their campaign, including campaign websites and social-media accounts.
_Avoid_: Official resource, independent source
