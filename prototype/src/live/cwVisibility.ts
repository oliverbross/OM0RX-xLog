/** Provider capability never hides an independent device or an existing release duty. */
export function providerAllowsCWDesk(provider: string, output: string, state: { armed?: boolean; owner?: unknown; lease?: unknown; pending?: boolean }): boolean {
  // Capability/admission belongs to the native session. Keep the workbench and
  // its readiness reason reachable for unsupported/offline TCI routes too.
  return true;
}
