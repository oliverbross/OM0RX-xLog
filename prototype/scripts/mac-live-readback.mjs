// Explicitly read-only acceptance. Never sends commands or accesses credentials.
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const binary = process.argv[2];
assert.ok(binary, "Pass the installed worker path");
const child = spawn(binary, [], { stdio: ["pipe", "pipe", "ignore"] });
const methods = ["health", "workspace_status", "cluster_snapshot", "station_snapshot"];
let buffer = "", count = 0;
const timeout = setTimeout(() => { child.kill(); process.exitCode = 1; }, 20000);
child.stdout.on("data", chunk => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf("\n")) >= 0) {
    const value = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
    const r = value.result || {};
    const safe = value.id === "station_snapshot" ? { available: r.available, source: r.source,
      radio: r.radio, route: r.station?.route_alignment, kpa_operate: r.station?.kpa_operate,
      alarms: r.station?.alarm_summary, rotor_connected: r.rotor?.connected }
      : value.id === "cluster_snapshot" ? { clusters: r.snapshot?.connectedClusters,
        contacts: r.snapshot?.contactCount, spots: r.snapshot?.loadedSpots, cty: r.snapshot?.countryDataLoaded }
      : value.id === "workspace_status" ? { exists: r.workspace_exists, native_exists: r.native_log_exists,
        qso_count: r.qso_count, automatic_sync: r.automatic_sync } : r;
    console.log(JSON.stringify({ method: value.id, ok: value.ok, result: safe, error: value.error }));
    count += 1;
    if (count === methods.length) child.stdin.end();
  }
});
child.on("close", code => { clearTimeout(timeout); if (code !== 0 || count !== methods.length) process.exitCode = 1; });
for (const method of methods) child.stdin.write(JSON.stringify({ id: method, method, params: {} }) + "\n");
