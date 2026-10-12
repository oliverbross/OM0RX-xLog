// Logging modes describe the contact, while CAT modes describe demodulation.
// Preserve a chosen digital contact mode when the radio reports its data carrier.
export function logMode(observed: string, current: string): string {
  const radio = observed.toUpperCase();
  const digital = ["FT8", "FT4", "FT2", "PSK", "PSK31", "PSK63", "JT65", "JT9", "MFSK", "OLIVIA", "DATA", "DIGI"];
  if (["PKTUSB", "PKTLSB", "DIGU", "DIGL", "DATA", "DIGI"].includes(radio)) {
    return digital.includes(current.toUpperCase()) ? current.toUpperCase() : "DIGI";
  }
  if (["USB", "LSB"].includes(radio)) return "SSB";
  if (radio === "CWR") return "CW";
  if (radio === "RTTYR") return "RTTY";
  return radio;
}
