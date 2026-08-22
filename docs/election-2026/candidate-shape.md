# Minimal Candidate Record proposal

A Candidate Record belongs directly to one Contest. It does not introduce a Person, Candidacy, Person ID, Candidacy ID, hand-authored given name, or hand-authored family name.

## Required fields

| Field | Meaning |
| --- | --- |
| `contestId` | The one canonical Contest selected through a reviewed Source Label mapping. |
| `source.sourceId` | The Authoritative Source that published the record. |
| `source.observedAt` | When the source evidence was observed. |
| `sourcePublishedName` | The name exactly as published, including spacing, accents, and any raw withdrawal marker. |
| `phase` | `registration` or `nomination`, so the site can say Prospective Candidate or Candidate accurately. |
| `status.sourceValue` | The unmodified source status. |
| `status.value` | The reviewed normalized status, such as `Registered`, `Registration Withdrawn`, `Nominated`, `Nomination Withdrawn`, `Not Nominated`, or `Needs Review`. |

The required fields are the minimum needed to assign the record correctly, describe its phase honestly, and trace it back to evidence. A missing required field prevents normalization of that record.

## Optional voter-facing fields

| Group | Proposed field | City raw field(s) |
| --- | --- | --- |
| Registration evidence | `registrationDate` | `registration_date` |
| Source provenance | `source.recordId` | `id`, when the source publishes one |
| Biography | `biography`, `biographyFrench` | `biography`, `biography_francais` |
| Image | `imageUrl` | `image` |
| Campaign | `campaignWebsite` | `website` |
| Contact | `email`, `phone` | `email`, `phone` |
| Social | `socialLinks[]` | `facebook`, `twitter`, `linkedin`, `instagram` |
| Disclosure | `financialDisclosure`, `statementOfDisclosure` | each file-name/link pair |

Optional values are omitted when unavailable; they do not receive empty strings, placeholder images, invented biographies, or “not provided” rows. Candidate-provided biography text remains verbatim and is labelled Candidate-provided information. Source URLs and strings are retained before any later display cleanup.

The City schema contained biography, image, and disclosure fields on 2026-08-22 but none were populated in the current pre-nomination records. The shape includes them because they are observed official schema and page-display fields, not because fixture values were invented.

## Explicit exclusions

`official_agent` and `auditor` remain in raw Source Snapshots as administrative evidence but are excluded from normalized public Candidate Records. Address, postal code, fax, signatures, and other registration-form administration are also excluded unless a later issue establishes a voter-facing requirement.

No canonical name parts are required. A later static alphabetical presentation may derive a sort value while retaining `sourcePublishedName`, but that derivation is outside Issue #5.
