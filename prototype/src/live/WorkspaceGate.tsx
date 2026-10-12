type Workspace = { workspace_exists?: boolean; native_log_exists?: boolean } | null;

/** Unknown is not empty: never offer creation until the worker has checked disk. */
export default function WorkspaceGate({ workspace, pending, busy, retry, create }: {
  workspace: Workspace; pending: boolean; busy: boolean;
  retry: () => void; create: (mode: "copy_native" | "empty") => void;
}) {
  if (!workspace) return <section className="live-onboarding" aria-busy={pending}>
    <h2>{pending ? "Opening your integrated logbook" : "Logbook connection unavailable"}</h2>
    <p role="status">{pending
      ? "Checking your existing workspace. Your contacts and settings have not been replaced."
      : "The logbook service did not finish loading. Reconnect to check your existing workspace; do not create another logbook."}</p>
    {!pending && <button disabled={busy} onClick={retry}>Retry connection</button>}
  </section>;
  return <section className="live-onboarding"><h2>Bring your logbook into the integrated app</h2>
    <p>Create a verified copy of your existing xLog database, or begin with an empty logbook. Your original database, settings and installed apps are not modified. Existing remote sync credentials are not copied.</p>
    <div className="live-actions">
      <button className="primary" disabled={busy || !workspace.native_log_exists} onClick={() => create("copy_native")}>Copy my existing xLog logbook</button>
      <button disabled={busy} onClick={() => create("empty")}>Create empty logbook</button>
      <button disabled={busy} onClick={retry}>Retry connection</button>
    </div><p className="secondary">No sample contacts, spots or station readings are loaded.</p>
  </section>;
}
