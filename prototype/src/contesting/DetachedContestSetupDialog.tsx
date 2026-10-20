import { useEffect, useState } from "react";
import { ContestSetupPanel } from "./ContestSetupPanel";
import { closeContestSetupDialog, saveContestSetupDialog, setupDialogRequest, type SetupDialogSnapshot } from "./contestSetupDialogs";
import { openContestSetupService } from "./contestSetupServices";
import "./ContestWorkspace.css";
import "./DetachedContestSetupDialog.css";

export function DetachedContestSetupDialog() {
  const kind = new URLSearchParams(window.location.search).get("view") === "contest-setup-station" ? "station" : "configuration";
  const [snapshot, setSnapshot] = useState<SetupDialogSnapshot | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let active = true, retry: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const value = await setupDialogRequest<SetupDialogSnapshot>("snapshot");
        if (active) { setSnapshot(value); setError(""); }
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Contest Setup is unavailable.");
          retry = setTimeout(() => void load(), 250);
        }
      }
    };
    void load();
    return () => { active = false; clearTimeout(retry); };
  }, []);
  return <main className="contest-workspace contest-setup-dialog" aria-label={kind === "station" ? "Station Settings" : "Configuration Settings"}>
    {error && <><p role="alert">{error}</p><button type="button" onClick={() => void closeContestSetupDialog()}>Cancel</button></>}
    {snapshot ? <ContestSetupPanel value={snapshot.document} sessions={[]} catalog={[]} detachedDialog={kind}
      initialTab={kind === "station" ? "Station" : "Lookup"} onCancel={closeContestSetupDialog}
      onSave={async document => { await saveContestSetupDialog(snapshot, document); await closeContestSetupDialog(); }}
      onCreate={async () => { throw new Error("Create contests in Contest Setup."); }}
      onOpen={async () => { throw new Error("Choose contests in Contest Setup."); }} onOpenSettings={openContestSetupService}/>
      : !error && <p role="status">Loading settings…</p>}
  </main>;
}
