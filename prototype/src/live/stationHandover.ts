type Invoke = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/** Retire the old owner before allowing a different provider to connect. */
export async function retireStationProvider(provider: string, invoke: Invoke): Promise<void> {
  if (provider === "hamlib") {
    const results = await Promise.allSettled([
      invoke("hamlib_disconnect", { device: "radio" }),
      invoke("hamlib_disconnect", { device: "rotor" }),
    ]);
    if (results.some(result => result.status === "rejected"))
      throw new Error("Local station handover could not be confirmed. Check radio and rotor connections before switching.");
  } else {
    await invoke("station_disconnect", { provider: "direct_agent" });
  }
}
