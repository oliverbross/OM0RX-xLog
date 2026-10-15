export type ReadRadioJournal = { operationId: string; generation: string | null };
const validID = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export function loadReadRadioJournal(key: string): ReadRadioJournal | null {
  try {
    const value = localStorage.getItem(key);
    if (!value) return null;
    try {
      const journal = JSON.parse(value);
      if (journal && validID(journal.operationId)) return { operationId: journal.operationId, generation: validID(journal.generation) ? journal.generation : null };
    } catch { /* Older versions retained only the operation UUID. */ }
    // Invalid/legacy journals can still request an explicit canonical review,
    // but cannot manufacture a generation-bound receipt or replay an effect.
    return { operationId: validID(value) ? value : crypto.randomUUID(), generation: null };
  } catch { return { operationId: "unverified", generation: null }; }
}
