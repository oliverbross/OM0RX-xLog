export type QSOField = { key: string; label: string; kind?: "number" | "textarea" | "enum"; options?: string[] };

export const qsoBands = ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "4m", "2m", "70cm"];
export const qsoModes = ["CW", "SSB", "FT8", "FT4", "FT2", "RTTY", "JTTY", "PSK", "DIGI", "AM", "FM"];

export const qsoFieldGroups: Record<string, QSOField[]> = {
  Station: [
    { key: "stationLocation", label: "Station location" }, { key: "radio", label: "Radio" },
    { key: "receiveFrequencyHz", label: "RX frequency MHz" }, { key: "receiveBand", label: "RX band", kind: "enum", options: qsoBands },
    { key: "txPower", label: "TX power W" }, { key: "operatorCall", label: "Operator" },
  ],
  StationExtra: [{ key: "myCall", label: "Station call" }, { key: "myGrid", label: "Station grid" }],
  General: [
    { key: "name", label: "Name" }, { key: "gridSquare", label: "Gridsquare" },
    { key: "country", label: "Country" }, { key: "dxcc", label: "DXCC", kind: "number" },
    { key: "continent", label: "Continent", kind: "enum", options: ["AF", "AN", "AS", "EU", "NA", "OC", "SA"] },
    { key: "cqZone", label: "CQ zone" }, { key: "ituZone", label: "ITU zone" },
    { key: "state", label: "State" }, { key: "county", label: "County" },
    { key: "qth", label: "Location" }, { key: "email", label: "Email" },
  ],
  References: [
    { key: "potaReference", label: "POTA" }, { key: "sotaReference", label: "SOTA" },
    { key: "iota", label: "IOTA" }, { key: "wwffReference", label: "WWFF" },
    { key: "sig", label: "SIG" }, { key: "sigInfo", label: "SIG info" }, { key: "dok", label: "DOK" },
    { key: "propagationMode", label: "Propagation" }, { key: "antennaPath", label: "Antenna path" },
    { key: "comment", label: "Comment" },
  ],
  Notes: [{ key: "notes", label: "QSO note", kind: "textarea" }],
  QSL: [
    { key: "qslSent", label: "QSL sent", kind: "enum", options: ["Y", "N", "R", "Q", "I", "V"] },
    { key: "qslReceived", label: "QSL received", kind: "enum", options: ["Y", "N", "R", "Q", "I", "V"] },
    { key: "qslMethod", label: "QSL method", kind: "enum", options: ["B", "D", "E", "M"] },
    { key: "qslVia", label: "QSL via" }, { key: "qslMessage", label: "QSL message" },
  ],
  QSLExtra: [{ key: "lotwSent", label: "LoTW sent", kind: "enum", options: ["Y", "N", "Q", "I"] },
    { key: "lotwReceived", label: "LoTW received", kind: "enum", options: ["Y", "N", "V", "I"] }],
};

export const qsoDetailFieldSections = [
  { id: "contact", label: "Contact & location", fields: qsoFieldGroups.General },
  { id: "references", label: "References & notes", fields: [...qsoFieldGroups.References, ...qsoFieldGroups.Notes] },
  { id: "station", label: "Station & QSL", fields: [...qsoFieldGroups.Station, ...qsoFieldGroups.QSL] },
] as const;

export const qsoDetailFieldKeys = qsoDetailFieldSections.flatMap(section => section.fields.map(field => field.key));
