import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { operatingModuleStatus } from "../operatingModule";

/** A hidden normal window can coexist with Contesting. Its draft must remain
 * passive until the native module owner authorizes Normal Logging. */
export function useNormalLoggingAccess() {
  const [state, setState] = useState({ active: !isTauri(), error: "" });
  useEffect(() => {
    if (!isTauri()) return;
    let current = true;
    void operatingModuleStatus(true).then(status => {
      if (!current) return;
      if (!status || !["normal_logging", "contesting"].includes(status.selected) || typeof status.transitioning !== "boolean") {
        setState({ active: false, error: "The active operating module could not be verified. Reopen the main window before editing its normal draft." });
      } else setState({ active: status.selected === "normal_logging" && !status.transitioning, error: "" });
    }).catch(() => {
      if (current) setState({ active: false, error: "The active operating module could not be verified. Reopen the main window before editing its normal draft." });
    });
    return () => { current = false; };
  }, []);
  return state;
}
