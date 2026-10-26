# OM0RX-xLog roadmap

Current consolidated planning entry point: [N1MM Next Level master plan](docs/planning/00_N1MM_NEXT_LEVEL_MASTER_PLAN.md).
The award-directory proposal below is retained as historical scope; NL-33 owns its reconciliation and remaining acceptance.

## Award-directory cache

The spot handoff already recognizes and logs structured POTA, SOTA, IOTA, WWFF and castle references. The next reference-data stage will add a local searchable directory cache for each programme so xLog can validate a reference and enrich it with its official name and coordinates.

Acceptance requirements:

- Use only an official programme export or documented API, with the source and redistribution terms recorded.
- Keep each programme independently configurable and optional.
- Refresh automatically on a conservative schedule with conditional HTTP requests.
- Validate schema and minimum record count, write atomically, and retain the last known-good copy after any network or parsing failure.
- Record source, retrieval time and dataset version in the UI.
- Never reject logging because an award service is offline or because a newly issued reference is not in the local cache yet.
- Preserve unrecognized references in the QSO rather than silently discarding them.

The directory cache must cover POTA parks, SOTA summits, IOTA groups, WWFF references and the enabled castle programme(s). Because these programmes have different APIs, licensing and update policies, they will not be treated as interchangeable generic downloads.
