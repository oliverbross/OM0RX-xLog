export type Mode = "SSB" | "CW" | "FT8";
export type Profile = "simulator" | "manual";
export type Spot = {
  id: string;
  call: string;
  mhz: number;
  mode: Mode;
  band: string;
  country: string;
  grid: string;
  lon: number;
  lat: number;
  reporter: string;
  note: string;
  state: "needed" | "worked" | "confirmed";
  // Populated by the integrated xCluster feed. Fixtures can omit these.
  adif?: number | null;
  callStatus?: string;
  statusHex?: string;
  bandHex?: string;
};
export const spots: Spot[] = [
  {
    id: "s1",
    call: "W1AW",
    mhz: 14.24,
    mode: "SSB",
    band: "20m",
    country: "United States",
    grid: "FN31pr",
    lon: -72.727,
    lat: 41.713,
    reporter: "DEMO1",
    note: "Synthetic club station",
    state: "needed",
  },
  {
    id: "s2",
    call: "OH9W",
    mhz: 7.186,
    mode: "SSB",
    band: "40m",
    country: "Finland",
    grid: "KP25",
    lon: 25.74,
    lat: 66.5,
    reporter: "DEMO2",
    note: "Synthetic phone spot",
    state: "worked",
  },
  {
    id: "s3",
    call: "OH7K",
    mhz: 7.151,
    mode: "SSB",
    band: "40m",
    country: "Finland",
    grid: "KP32",
    lon: 28.2,
    lat: 62.8,
    reporter: "DEMO1",
    note: "Synthetic phone spot",
    state: "needed",
  },
  {
    id: "s4",
    call: "OH6DX",
    mhz: 7.13,
    mode: "SSB",
    band: "40m",
    country: "Finland",
    grid: "KP12",
    lon: 21.8,
    lat: 62.3,
    reporter: "DEMO3",
    note: "Synthetic phone spot",
    state: "worked",
  },
  {
    id: "s5",
    call: "AC7A",
    mhz: 7.0467,
    mode: "FT8",
    band: "40m",
    country: "United States",
    grid: "DM42",
    lon: -110.9,
    lat: 32.2,
    reporter: "DEMO2",
    note: "Synthetic digital spot",
    state: "worked",
  },
  {
    id: "s6",
    call: "N7A",
    mhz: 7.0294,
    mode: "CW",
    band: "40m",
    country: "United States",
    grid: "CN87",
    lon: -122.3,
    lat: 47.6,
    reporter: "DEMO3",
    note: "Synthetic CW spot",
    state: "needed",
  },
  {
    id: "s7",
    call: "VK2SOL",
    mhz: 14.327,
    mode: "SSB",
    band: "20m",
    country: "Australia",
    grid: "QF56",
    lon: 151.2,
    lat: -33.87,
    reporter: "DEMO1",
    note: "Synthetic phone spot",
    state: "confirmed",
  },
  {
    id: "s8",
    call: "JA6HP",
    mhz: 21.27,
    mode: "SSB",
    band: "15m",
    country: "Japan",
    grid: "PM53",
    lon: 130.4,
    lat: 33.6,
    reporter: "DEMO2",
    note: "Synthetic phone spot",
    state: "needed",
  },
  {
    id: "s9",
    call: "H49A",
    mhz: 14.091,
    mode: "FT8",
    band: "20m",
    country: "Solomon Islands",
    grid: "RI00",
    lon: 160,
    lat: -9.4,
    reporter: "DEMO3",
    note: "Synthetic digital spot",
    state: "worked",
  },
];
export const bands = {
  "40m": { min: 7, max: 7.3, cw: 7.04, data: 7.1 },
  "20m": { min: 14, max: 14.35, cw: 14.07, data: 14.112 },
  "15m": { min: 21, max: 21.45, cw: 21.07, data: 21.15 },
};
// Fixture classifications only: never inferred from an operator's logbook.
export const opportunityFixtures: Record<string, "NC" | "NB" | "ATNO"> = {
  s1: "NC",
  s2: "NB",
  s3: "ATNO",
  s4: "NC",
  s5: "NB",
  s6: "NC",
  s7: "NB",
  s8: "ATNO",
  s9: "ATNO",
};
export function spotOpportunity(spot: Spot) {
  return opportunityFixtures[spot.id];
}
export function fixtureBounds(
  points: Spot[],
): [[number, number], [number, number]] {
  return [
    [
      Math.min(...points.map((s) => s.lon)),
      Math.min(...points.map((s) => s.lat)),
    ],
    [
      Math.max(...points.map((s) => s.lon)),
      Math.max(...points.map((s) => s.lat)),
    ],
  ];
}
export type Band = keyof typeof bands;
export type Draft = {
  call: string;
  frequency: string;
  mode: Mode;
  name: string;
  comment: string;
  sent: string;
  received: string;
};
export type QSO = Draft & { id: string; time: string; profile: Profile };
// P2 memory-only preview: bounded complete history fits the native IPC envelope.
// Never silently drop older records, which would invent new-call/entity results.
export const MAX_SESSION_QSOS = 128;
export type State = {
  draft: Draft;
  radio: { mhz: number; mode: Mode };
  profile: Profile;
  qsos: QSO[];
  selected: string | null;
  notice: string;
  error: string;
};
export const emptyDraft = (): Draft => ({
  call: "",
  frequency: "14.240000",
  mode: "SSB",
  name: "",
  comment: "",
  sent: "59",
  received: "59",
});
export const initialState: State = {
  draft: emptyDraft(),
  radio: { mhz: 14.24, mode: "SSB" },
  profile: "simulator",
  qsos: [],
  selected: null,
  notice: "Synthetic session · no station connection",
  error: "",
};
export type Action =
  | { type: "field"; field: keyof Draft; value: string }
  | { type: "spot"; spot: Spot }
  | { type: "profile"; profile: Profile }
  | { type: "read" }
  | { type: "log"; id: string; time: string }
  | { type: "clear" };
export function validateDraft(draft: Draft): string {
  if (
    !/^(?=.*[A-Z])(?=.*\d)[A-Z0-9/]{3,20}$/.test(
      draft.call.trim().toUpperCase(),
    )
  )
    return "Enter a valid callsign (for example W1AW).";
  const f = Number(draft.frequency);
  if (!Number.isFinite(f) || f < 0.1 || f > 1300)
    return "Frequency must be between 0.1 and 1300 MHz.";
  if (!/^\d{2,3}$/.test(draft.sent) || !/^\d{2,3}$/.test(draft.received))
    return "Reports must contain two or three digits.";
  return "";
}
export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "field":
      return {
        ...state,
        draft: {
          ...state.draft,
          [action.field]:
            action.field === "call" ? action.value.toUpperCase() : action.value,
        },
        error: "",
      };
    case "spot":
      return {
        ...state,
        draft: {
          ...state.draft,
          call: action.spot.call,
          frequency: action.spot.mhz.toFixed(6),
          mode: action.spot.mode,
          comment: action.spot.note,
          sent: action.spot.mode === "CW" ? "599" : "59",
          received: action.spot.mode === "CW" ? "599" : "59",
        },
        selected: action.spot.id,
        radio:
          state.profile === "simulator"
            ? { mhz: action.spot.mhz, mode: action.spot.mode }
            : state.radio,
        notice:
          state.profile === "simulator"
            ? "Spot loaded · simulator followed frequency and mode"
            : "Spot loaded · manual profile does not tune",
        error: "",
      };
    case "profile":
      return {
        ...state,
        profile: action.profile,
        notice:
          action.profile === "simulator"
            ? "Simulator selected · no hardware IO"
            : "Manual / disconnected selected · draft preserved",
      };
    case "read":
      return state.profile === "simulator"
        ? {
            ...state,
            draft: {
              ...state.draft,
              frequency: state.radio.mhz.toFixed(6),
              mode: state.radio.mode,
            },
            notice: "Read simulated radio snapshot",
            error: "",
          }
        : {
            ...state,
            error: "No radio in manual profile. Enter the frequency directly.",
          };
    case "clear":
      return {
        ...state,
        draft: {
          ...emptyDraft(),
          frequency: state.draft.frequency,
          mode: state.draft.mode,
        },
        selected: null,
        error: "",
        notice: "Draft cleared",
      };
    case "log": {
      if (state.qsos.length >= MAX_SESSION_QSOS) return {
        ...state, error: `Synthetic session limit reached (${MAX_SESSION_QSOS} QSOs). The draft and existing contacts are unchanged.`,
      };
      const error = validateDraft(state.draft);
      if (error) return { ...state, error };
      return {
        ...state,
        qsos: [
          {
            ...state.draft,
            call: state.draft.call.trim().toUpperCase(),
            id: action.id,
            time: action.time,
            profile: state.profile,
          },
          ...state.qsos,
        ],
        draft: {
          ...emptyDraft(),
          frequency: state.draft.frequency,
          mode: state.draft.mode,
        },
        selected: null,
        error: "",
        notice: `${state.draft.call.trim().toUpperCase()} saved to synthetic session memory · no Wavelog sync`,
      };
    }
  }
}
export function bandPosition(mhz: number, band: Band): number {
  const range = bands[band];
  return Math.max(
    0,
    Math.min(100, ((range.max - mhz) / (range.max - range.min)) * 100),
  );
}
