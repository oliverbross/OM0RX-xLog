import { useEffect, useState } from "react";

/** Once recovery is visible, keep it available while its explicit retry is in
 * flight. Ordinary autosaves do not open recovery just because they are busy. */
export function useWorkspaceRecovery(required: boolean, settled: boolean) {
  const [retained, setRetained] = useState(false);
  const visible = required || retained && !settled;
  useEffect(() => { setRetained(visible); }, [visible]);
  return visible;
}
