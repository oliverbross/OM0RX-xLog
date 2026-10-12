type Invoke = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/** Retire the old owner before allowing a different provider to connect. */
export async function retireStationProvider(provider: string, invoke: Invoke): Promise<void> {
  if (provider === "hamlib") {
    try { await invoke("hamlib_disconnect", { device: "radio" }); }
    catch { throw new Error("Local radio handover could not be confirmed. Check its connection before switching."); }
  } else if (provider === "direct_agent" || provider === "direct_flex_lan") {
    await invoke("station_disconnect", { provider });
  } else {
    throw new Error("Unknown station provider; no handover was performed.");
  }
}
