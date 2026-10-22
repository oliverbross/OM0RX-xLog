const startupReadRetryDelays = [100, 250, 500, 1_000, 2_000, 4_000] as const;

const startupReadAdmissionFailures = new Set([
  "Prototype worker is busy; try again",
  "Station service is busy; try again.",
  "Station service unavailable; retry the request",
  "Station service unavailable",
  "Station service is not responding. Finish any macOS Keychain prompt, then retry.",
  "Operation failed",
  "Operation failed. Check the connection or configuration; no success has been confirmed.",
]);

export function serviceErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
}

export function isTransientStartupReadFailure(cause: unknown): boolean {
  return startupReadAdmissionFailures.has(serviceErrorMessage(cause));
}

export async function retryStartupRead<T>(read: () => Promise<T>, active: () => boolean = () => true): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    if (!active()) throw new Error("Startup read cancelled");
    try { return await read(); }
    catch (cause) {
      if (!isTransientStartupReadFailure(cause) || attempt >= startupReadRetryDelays.length) throw cause;
      await new Promise(resolve => setTimeout(resolve, startupReadRetryDelays[attempt]));
    }
  }
}

export function startupReadFailureMessage(cause: unknown, noun: string): string {
  const message = serviceErrorMessage(cause);
  return isTransientStartupReadFailure(cause)
    ? `${noun} did not finish loading. Retry after the station service is ready.`
    : message || `${noun} could not be loaded.`;
}
