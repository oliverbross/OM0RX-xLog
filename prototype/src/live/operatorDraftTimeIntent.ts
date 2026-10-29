import { sameDraftValue, type DraftSessionState } from "./operatorDraftSession";

/** Mirror native Replace's time provenance before a debounced edit is acknowledged. */
export function effectiveDraftAutomaticStart({ base, draft }: Pick<DraftSessionState, "base" | "draft">): boolean {
  return base?.automaticStart === true && !!draft &&
    sameDraftValue({ id: draft.id, start: draft.start, end: draft.end }, { id: base.qso.id, start: base.qso.start, end: base.qso.end });
}
