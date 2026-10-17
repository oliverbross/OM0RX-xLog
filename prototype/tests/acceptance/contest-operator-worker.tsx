import React from "react";
import { createRoot } from "react-dom/client";
import { ContestWorkspace } from "../../src/contesting/ContestWorkspace";
import type { ContestExportSaveAdapter } from "../../src/contesting/contestExportSave";
import type { SCPImport } from "../../src/contesting/contestAssistance";
import type { ContestRequest } from "../../src/contesting/types";

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Acceptance bridge ${path} failed (${response.status}).`);
  return response.json() as Promise<T>;
}

const request: ContestRequest = (method, params = {}) => post("/__acceptance/worker", { method, params });
const exportSave: ContestExportSaveAdapter = prepared => post("/__acceptance/export", prepared);
const scpImport: SCPImport = () => post("/__acceptance/scp-import", {});

createRoot(document.getElementById("root")!).render(<React.StrictMode>
  <ContestWorkspace request={request} exportSave={exportSave}
    scpImport={scpImport}
    simulateContestOutput={entry => post("/__acceptance/simulated-output", entry)} />
</React.StrictMode>);
