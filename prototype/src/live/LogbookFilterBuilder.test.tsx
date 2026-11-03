// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { LogbookFilterBuilder } from "./LogbookFilterBuilder";
import { emptyLogbookQuery, type LogbookQuery } from "./logbookQuery";
afterEach(cleanup);
it("edits an all/any typed condition without applying until the explicit control", () => {
  const apply=vi.fn();
  function Fixture() { const [q,setQ]=useState<LogbookQuery>(emptyLogbookQuery); return <LogbookFilterBuilder value={q} onChange={setQ} onApply={() => apply(q)} />; }
  render(<Fixture />);
  fireEvent.click(screen.getByRole("button",{name:"Add condition"}));
  fireEvent.change(screen.getByLabelText("Condition 1 field"),{target:{value:"band"}});
  fireEvent.change(screen.getByLabelText("Condition 1 operator"),{target:{value:"in"}});
  fireEvent.change(screen.getByLabelText("Condition 1 value"),{target:{value:"80m;160m"}});
  expect((screen.getByLabelText("Condition 1 value") as HTMLInputElement).value).toBe("80m;160m");
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Apply conditions"}));
  expect(apply).toHaveBeenCalledWith({version:1,join:"all",clauses:[{field:"band",op:"in",values:["80m","160m"]}]});
  fireEvent.click(screen.getByRole("button",{name:"Reset conditions"}));
  expect(screen.queryByLabelText("Condition 1 field")).toBeNull();
});
