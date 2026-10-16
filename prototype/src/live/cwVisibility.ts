/** Provider capability never hides an independent device or an existing release duty. */
export function providerAllowsCWDesk(provider: string, output: string, state: { armed?: boolean; owner?: unknown; lease?: unknown; pending?: boolean }): boolean {
  return provider !== "direct_tci" || output === "winkeyer" || !!(state.armed || state.owner || state.lease || state.pending);
}
