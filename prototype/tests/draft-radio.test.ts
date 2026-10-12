import { expect, it } from "vitest";
import { logMode } from "../src/live/draftRadio";
it("retains contact-mode intent through data-carrier observations", () => {
  expect(logMode("PKTUSB", "FT8")).toBe("FT8");
  expect(logMode("DIGU", "FT4")).toBe("FT4");
  expect(logMode("PKTLSB", "CW")).toBe("DIGI");
});
it("follows actual radio changes without logging CAT-only mode tokens", () => {
  expect(logMode("USB", "CW")).toBe("SSB");
  expect(logMode("CW", "FT8")).toBe("CW");
  expect(logMode("CWR", "SSB")).toBe("CW");
  expect(logMode("RTTYR", "CW")).toBe("RTTY");
});
