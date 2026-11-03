// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BandMapGuideEditor } from "./BandMapGuideEditor";
import type { BandMapGuide } from "./bandMapGuides";
afterEach(cleanup);
const initial: BandMapGuide = {version:1,units:"Hz",id:"custom-1",name:"Personal",region:"Custom",origin:"custom",sourceURL:"https://example.invalid/reference",reviewed:"2026-11-03",supportedBands:["20m"],ranges:[],markers:[]};
it("edits labels, ranges and personal markers without JSON and preserves attribution",()=>{
  const save=vi.fn();render(<BandMapGuideEditor initial={initial} busy={false} save={save} cancel={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Guide name"),{target:{value:"Portable CW"}});
  fireEvent.click(screen.getByText("Add range"));fireEvent.click(screen.getByText("Add personal marker"));
  fireEvent.click(screen.getByText(/1. Personal range/));fireEvent.click(screen.getByText(/1. Personal marker/));
  fireEvent.change(screen.getByLabelText("Marker 1 label"),{target:{value:"My listening frequency"}});
  fireEvent.change(screen.getByLabelText("Marker 1 frequency Hz"),{target:{value:"14060000"}});
  fireEvent.click(screen.getByText("Save custom guide"));
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][0]).toMatchObject({name:"Portable CW",sourceURL:initial.sourceURL,markers:[{label:"My listening frequency",frequencyHz:14060000}]});
  expect(save.mock.calls[0][0].markers[0].mode).toBeUndefined();
});
it("rejects inverted ranges before saving and Cancel preserves the original profile",()=>{
  const save=vi.fn(),cancel=vi.fn();render(<BandMapGuideEditor initial={initial} busy={false} save={save} cancel={cancel} />);
  fireEvent.click(screen.getByText("Add range"));fireEvent.click(screen.getByText(/1. Personal range/));
  fireEvent.change(screen.getByLabelText("Range 1 end Hz"),{target:{value:"13900000"}});
  fireEvent.click(screen.getByText("Save custom guide"));expect(save).not.toHaveBeenCalled();expect(screen.getByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByText("Cancel editing"));expect(cancel).toHaveBeenCalledTimes(1);expect(initial.ranges).toEqual([]);
});
