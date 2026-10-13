import { describe, expect, it } from "vitest";
import { dxccIdentity } from "./dxccIdentity";

const lookup = { call: "EA7EU", country: "Spain", dxcc: 281, isNewCall: true };
const history = { call: "EA7EU", adif: 281, matrix: [], dxcc_contact_count: 12, dxcc_confirmed_count: 2 };
describe("DXCC identity evidence", () => {
  it.each([[12, 2, "confirmed"], [12, 0, "worked"], [0, 0, "new"]] as const)("classifies actual aggregate counts %s/%s as %s", (worked, confirmed, status) => {
    expect(dxccIdentity(" ea7eu ", lookup, { ...history, dxcc_contact_count: worked, dxcc_confirmed_count: confirmed }))
      .toEqual({ label: "Spain · DXCC 281", status });
  });
  it.each([
    undefined, { ...history, call: "OTHER" }, { ...history, adif: 223 }, { ...history, matrix: null },
    { ...history, dxcc_contact_count: undefined }, { ...history, dxcc_confirmed_count: undefined },
    { ...history, dxcc_contact_count: "0" }, { ...history, dxcc_contact_count: -1 },
    { ...history, dxcc_contact_count: 0.5 }, { ...history, dxcc_confirmed_count: NaN },
    { ...history, dxcc_confirmed_count: 13 },
  ])("keeps missing, stale or incomplete history neutral: %#", evidence => {
    expect(dxccIdentity("EA7EU", lookup, evidence).status).toBe("neutral");
  });
  it("does not apply the old lookup or its country to a newly entered call", () => {
    expect(dxccIdentity("OM0RX", lookup, history)).toEqual({ label: "Country unresolved", status: "neutral" });
  });
  it("never classifies lookup-only isNewCall or unresolved DXCC as new", () => {
    expect(dxccIdentity("EA7EU", lookup).status).toBe("neutral");
    expect(dxccIdentity("EA7EU", { ...lookup, dxcc: null }, history)).toEqual({ label: "Spain", status: "neutral" });
    expect(dxccIdentity("EA7EU", { ...lookup, country: "" }, history)).toEqual({ label: "DXCC 281", status: "neutral" });
  });
});
