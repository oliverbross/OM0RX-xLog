// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { StableFeedbackLayer } from "./StableFeedbackLayer";
import { readFileSync } from "node:fs";

const css = readFileSync("src/live/live.css", "utf8");

afterEach(cleanup);

function Harness() {
  const [message, setMessage] = useState("");
  return <main className="live-feedback-host">
    <StableFeedbackLayer>{message && <p className="live-error" role="alert">{message}</p>}</StableFeedbackLayer>
    <button onClick={() => setMessage("Radio readback unavailable")}>Report</button>
    <section data-testid="workspace">Working surface</section>
  </main>;
}

it("shows feedback outside document flow without remounting the working surface", () => {
  render(<Harness />);
  const workspace = screen.getByTestId("workspace");
  fireEvent.click(screen.getByRole("button", { name: "Report" }));
  expect(screen.getByRole("alert").textContent).toBe("Radio readback unavailable");
  expect(screen.getByTestId("workspace")).toBe(workspace);
  expect(css).toMatch(/\.live-feedback-overlay\s*\{[^}]*position:absolute/);
  expect(css).toMatch(/\.live-feedback-overlay\s*>\s*\*\s*\{[^}]*pointer-events:auto/);
  expect(css).not.toMatch(/\.live-feedback-overlay\s*\{[^}]*(?:transition|animation)\s*:/);
});
