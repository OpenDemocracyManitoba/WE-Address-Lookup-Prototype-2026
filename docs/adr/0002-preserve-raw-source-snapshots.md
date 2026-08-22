# Preserve raw source snapshots

Authoritative election sources can mutate or remove records without retaining dependable candidate-level history, while Winnipeg Election must retain former and withdrawn Candidate Records and explain imported changes. Every successful import therefore preserves an immutable, time-stamped Source Snapshot before normalization. This adds modest storage and ingestion complexity but prevents source history from being irretrievably lost.
