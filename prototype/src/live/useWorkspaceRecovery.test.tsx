// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useWorkspaceRecovery } from "./useWorkspaceRecovery";
afterEach(cleanup);

it("keeps ordinary dirty and pending autosaves hidden but retains an opened recovery through retry", () => {
  const hook = renderHook(({ required, settled }) => useWorkspaceRecovery(required, settled),
    { initialProps: { required: false, settled: true } });
  hook.rerender({ required: false, settled: false }); expect(hook.result.current).toBe(false);
  hook.rerender({ required: false, settled: true }); expect(hook.result.current).toBe(false);
  hook.rerender({ required: true, settled: false }); expect(hook.result.current).toBe(true);
  hook.rerender({ required: false, settled: false }); expect(hook.result.current).toBe(true);
  hook.rerender({ required: false, settled: true }); expect(hook.result.current).toBe(false);
  hook.rerender({ required: false, settled: false }); expect(hook.result.current).toBe(false);
});
