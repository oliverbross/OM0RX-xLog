// Loopback status query only; no radio command or credential access.
import net from "node:net";
const socket = net.createConnection({ host: "127.0.0.1", port: 14532 });
let data = "";
socket.setTimeout(5000);
socket.on("connect", () => socket.write("\\get_xcat_state\n"));
socket.on("data", chunk => {
  data += chunk;
  if (data.length > 131072) { socket.destroy(); process.exitCode = 1; return; }
  const line = data.split("\n")[0];
  try {
    const r = JSON.parse(line);
    console.log(JSON.stringify({ bytes: Buffer.byteLength(line), available: r.available,
      keys: Object.keys(r), radio_keys: Object.keys(r.radio || {}), station_keys: Object.keys(r.station || {}),
      rotor_keys: Object.keys(r.rotor || {}), propagation_keys: Object.keys(r.propagation || {}),
      radio_connected: r.radio?.connected, frequency: r.radio?.frequencyHz, mode: r.radio?.mode,
      mox: r.radio?.isTransmitting, kpa: r.station?.kpaOperate, route: r.station?.routeAlignment }));
    socket.end();
  } catch { if (line.startsWith("RPRT")) { console.log(line); socket.end(); } }
});
socket.on("timeout", () => { console.log(JSON.stringify({ status: "timeout", bytes: data.length })); socket.destroy(); process.exitCode = 1; });
socket.on("error", error => { console.log(JSON.stringify({ error: error.code })); process.exitCode = 1; });
