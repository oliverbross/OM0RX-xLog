// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { defaultQSOFieldPreferences, qsoDetailsFieldsKey, readQSOFieldPreferences, storeQSOFieldPreferences } from "./qsoEditorPreferences";

beforeEach(() => localStorage.clear());

describe("QSO detail field preferences", () => {
  it("uses every known field when storage is absent or damaged", () => {
    expect(readQSOFieldPreferences(null)).toEqual(defaultQSOFieldPreferences());
    expect(readQSOFieldPreferences("not-json")).toEqual(defaultQSOFieldPreferences());
  });

  it("accepts an intentional empty choice and removes unknown or duplicate fields", () => {
    expect(readQSOFieldPreferences(JSON.stringify({ version: 1, fields: [] })).fields).toEqual([]);
    expect(readQSOFieldPreferences(JSON.stringify({ version: 1, fields: ["name", "unknown", "name", "potaReference"] })).fields).toEqual(["name", "potaReference"]);
  });

  it("persists only validated field identifiers", () => {
    expect(storeQSOFieldPreferences(["email", "unknown", "email"]).fields).toEqual(["email"]);
    expect(JSON.parse(localStorage.getItem(qsoDetailsFieldsKey)!)).toEqual({ version: 1, fields: ["email"] });
  });
});
