// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BandMapGuideControls, GuideMarkerInspector } from "./BandMapGuideControls";
import { emptyGuideDocument } from "./bandMapGuides";
import { builtinGuides } from "./bandMapBuiltinGuides";
afterEach(cleanup);
it("previews imported attribution before any mutation and requires explicit copy or replacement", () => {
  const profile = { ...builtinGuides[0], origin:"custom" as const, id:"custom-existing",name:"Personal guide" };
  const document = {...emptyGuideDocument(),custom:[profile]};
  const save = vi.fn();
  render(<BandMapGuideControls document={document} save={save} error="" ready compact />);
  fireEvent.change(screen.getByLabelText("Import guide JSON"),{target:{value:JSON.stringify(profile)}});
  fireEvent.click(screen.getByText("Preview import"));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Replace matching custom ID"));
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][0].custom).toEqual([profile]);
  expect(save.mock.calls[0][0].detached).toEqual(document.detached);
});
it("changing visual scope and inspecting a marker never performs a tune", async () => {
  const document=emptyGuideDocument(),save=vi.fn(),tune=vi.fn().mockResolvedValue({confirmed:true});
  render(<BandMapGuideControls document={document} save={save} error="" ready compact={false} />);
  fireEvent.change(screen.getByLabelText("Visual guide"),{target:{value:builtinGuides[1].id}});
  expect(save.mock.calls[0][0].desk).toEqual(document.desk);
  expect(save.mock.calls[0][0].detached.id).toBe(builtinGuides[1].id);
  render(<GuideMarkerInspector marker={{frequencyHz:14100000,label:"Reference",category:"IBP",mode:"CW"}} tune={tune} close={vi.fn()} />);
  expect(tune).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Tune selected radio"));
  expect(tune).toHaveBeenCalledTimes(1);
});
