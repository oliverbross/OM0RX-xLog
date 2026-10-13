export function contactEditFixture(qso: Record<string, any>) {
  let contact: any = { revision: 1, qso: structuredClone(qso) }, updates = 0;
  const receipts = new Map<string, any>();
  const request = (method: string, params: any = {}) => {
    if (method === "logbook_contact") return { contact: structuredClone(contact) };
    if (method === "logbook_contact_receipt") return { receipt: structuredClone(receipts.get(params.operationID) ?? null) };
    if (method !== "logbook_contact_apply") return undefined;
    if (receipts.has(params.operationID)) return { status: "applied", receipt: structuredClone(receipts.get(params.operationID)) };
    if (!contact || params.contactID !== contact.qso.id || params.expectedRevision !== contact.revision)
      return { status: "conflict", contact: structuredClone(contact) };
    contact = { revision: contact.revision + 1, qso: structuredClone(params.qso) }; updates++;
    const receipt = { mutation: structuredClone(params), contact: structuredClone(contact) };
    receipts.set(params.operationID, receipt);
    return { status: "applied", receipt: structuredClone(receipt) };
  };
  return { request, get contact() { return contact; }, get updates() { return updates; }, remove() { contact = null; } };
}
