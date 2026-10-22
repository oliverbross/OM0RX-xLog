// Logging modes describe the contact, while CAT modes describe demodulation.
// Preserve a chosen digital contact mode when the radio reports its data carrier.
export type FollowedLogMode = { mode: string; submode: string };

export function followedLogMode(observed: string, current: string, currentSubmode = ""): FollowedLogMode {
  const radio = observed.toUpperCase();
  const selected = current.toUpperCase();
  const digital = ["FT8", "FT4", "FT2", "JTTY", "PSK", "PSK31", "PSK63", "JT65", "JT9", "MFSK", "OLIVIA", "RTTY", "DATA", "DIGI"];
  if (["PKTUSB", "PKTLSB", "DIGU", "DIGL", "DATA", "DIGI"].includes(radio)) {
    return digital.includes(selected)
      ? { mode: selected, submode: currentSubmode }
      : { mode: "DIGI", submode: "" };
  }
  const mode = radio === "USB" || radio === "LSB" ? "SSB"
    : radio === "CWR" ? "CW"
    : radio === "RTTYR" ? "RTTY"
    : radio;
  return { mode, submode: mode === selected ? currentSubmode : "" };
}

export function logMode(observed: string, current: string): string {
  return followedLogMode(observed, current).mode;
}
