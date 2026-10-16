// Wavelog band-map defaults. Operator settings take precedence.
export const clusterStatusColors: Record<string, string> = {
  "New Callsign": "#CC372D", "New DXCC": "#CC372D", Worked: "#E5A50A",
  Confirmed: "#90EE90", Unknown: "#777F8C",
};

export const clusterBandColors: Record<string, string> = {
  "160m": "#B794F4", "80m": "#A78BFA", "60m": "#818CF8", "40m": "#4A9EFF",
  "30m": "#22D3EE", "20m": "#12D6A0", "17m": "#4ADE80", "15m": "#F3B23C",
  "12m": "#FB923C", "10m": "#FF6B5E", "6m": "#F472B6", "2m": "#E879F9",
  "70cm": "#C084FC", Unknown: "#B0B0B0",
};

export const clusterModeColors: Record<string, string> = {
  CW: "#F3B23C", SSB: "#35C8F5", AM: "#FFD166", FM: "#4A9EFF",
  RTTY: "#FB923C", FT8: "#A78BFA", FT4: "#F472B6", FT2: "#E879F9",
  PSK: "#4ADE80", OLIVIA: "#2DD4BF", JT65: "#818CF8", JT9: "#60A5FA",
  HELL: "#F59E0B", MFSK: "#34D399", SSTV: "#F87171", DIGI: "#8B9CFF",
  Unknown: "#B0B0B0",
};

export function paletteColor(name: string, configured: Record<string, string> | undefined,
  defaults: Record<string, string>): string {
  const value = configured?.[name] ?? defaults[name] ?? defaults.Unknown;
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : defaults[name] ?? defaults.Unknown;
}

const specialColors: Record<string, [string, string, string]> = {
  POTA: ["#5F3F2A", "#FFD4B0", "#A56F4A"], SOTA: ["#3F5F2A", "#D4FFB0", "#6FA54A"],
  IOTA: ["#5F2A5F", "#FFD4FF", "#A54AA5"], WWFF: ["#2A5F5F", "#B0FFFF", "#4AA5A5"],
  CASTLE: ["#5F5F2A", "#FFFFD4", "#A5A54A"], LIGHTHOUSE: ["#4A5F2A", "#D4FF94", "#7AA54A"],
  CONTEST: ["#5F3A2A", "#FFC5A0", "#A56A4A"], IARU: ["#2A3A5F", "#A0D4FF", "#4A6AA5"],
};

export function specialTagColors(tag: string) {
  const [backgroundColor, color, borderColor] = specialColors[tag.toUpperCase()] ?? ["#2A3F5F", "#B0D4FF", "#4A6FA5"];
  return { backgroundColor, color, borderColor };
}
