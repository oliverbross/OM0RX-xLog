import { useEffect, useState } from "react";
import { workerRequest } from "../worker";
import AwardsPanel from "./AwardsPanel";
import { connectLogbookChanges } from "./logbookWindows";

async function request(method: string, params: Record<string, unknown> = {}) {
  return (await workerRequest(method, params)).result;
}
export function DetachedAwardsSurface() {
  const [refresh, setRefresh] = useState(0), [error, setError] = useState("");
  useEffect(() => connectLogbookChanges(() => setRefresh(value => value + 1), setError), []);
  return <div className="app live monitor-app detached-awards-app"><main aria-label="Detached Awards">
    {error && <p className="live-error" role="alert">{error}</p>}
    <AwardsPanel taskOnly request={request} refresh={refresh} />
  </main></div>;
}
