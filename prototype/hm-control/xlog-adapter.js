import { invoke } from '@tauri-apps/api/core';
import { frequencyBand, hamlibProjection } from '../src/live/hamlibStation';
import { mapRadioFrequency, mapClusterFresh } from '../src/live/mapObservations';

const status = (text, failed = false) => {
  const el = document.getElementById('xlog-link');
  el.textContent = text; el.classList.toggle('failed', failed);
};
export function homeFrom(value) {
  const home = value?.context?.metadata?.home;
  if (!home || !home.call || !Number.isFinite(home.lat) || Math.abs(home.lat) > 90 || !Number.isFinite(home.lon) || Math.abs(home.lon) > 180)
    throw new Error('Set your station callsign and grid in xLog Settings, then reconnect.');
  return { call: home.call, lat: home.lat, lon: home.lon, town: home.grid || 'Station QTH', tz: Intl.DateTimeFormat().resolvedOptions().timeZone };
}
export function rigFrom(context, now = Date.now()) {
  const freq = mapRadioFrequency(context, now);
  if (!freq) return null;
  const projected = context.selection.provider === 'hamlib' ? hamlibProjection(context.radio.snapshot, null) : context.radio.snapshot;
  const radio = projected?.radio;
  return { freq, band: frequencyBand(freq), mode: radio.mode || '', tx: typeof radio.transmitting === 'boolean' ? radio.transmitting : null,
    src: `xLog · ${context.selection.provider}` };
}
export async function connectXLog() {
  const retry = document.getElementById('xlog-retry');
  let initial;
  for (;;) {
    try { initial = await invoke('hm_control_snapshot'); homeFrom(initial); break; }
    catch (error) {
      status(String(error), true); retry.hidden = false;
      await new Promise(resolve => retry.addEventListener('click', resolve, { once: true }));
      retry.hidden = true; status('Connecting to xLog…');
    }
  }
  const home = homeFrom(initial), identity = JSON.stringify(home);
  let callback, reading = false, disposed = false, failures = 0;
  const link = { initial, current: initial, home, offline: initial.offline, subscribe(fn) { callback = fn; deliver(initial); } };
  function deliver(value) {
    const log = value.log.logbook;
    value.rig = rigFrom(value.context);
    status(`xLog linked · ${Number(log.total).toLocaleString()} QSOs · ${Number(log.located).toLocaleString()} located · ${Number(log.approximate).toLocaleString()} DXCC approximations · map grouped by area`);
    link.current = value; callback?.(value);
  }
  async function refresh() {
    if (disposed || reading) return;
    reading = true;
    try {
      const value = await invoke('hm_control_snapshot');
      if (disposed) return;
      if (JSON.stringify(homeFrom(value)) !== identity || value.offline !== link.offline) { location.reload(); return; }
      failures = 0; deliver(value);
    } catch {
      if (disposed) return;
      failures++;
      callback?.({ ...link.current, rig: null });
      status(`xLog updates paused · retained log · radio unavailable · reconnecting${failures > 3 ? ' (check the main window)' : '…'}`, true);
    } finally { reading = false; }
  }
  const timer = setInterval(refresh, 2000);
  addEventListener('pagehide', () => { disposed = true; clearInterval(timer); }, { once: true });
  addEventListener('focus', refresh);
  return link;
}

export async function publicFetch(link, input, options) {
  const url = new URL(String(input), location.href);
  if (url.origin === location.origin) return globalThis.fetch(input, options);
  if (link.offline) throw new Error('External feeds are disabled in offline acceptance.');
  const feeds = {
    'celestrak.org/NORAD/elements/gp.php': 'satellites',
    'api.open-meteo.com/v1/forecast': 'weather',
    'api.weather.gov/alerts/active': 'alerts',
    'services.swpc.noaa.gov/json/f107_cm_flux.json': 'sfi',
    'services.swpc.noaa.gov/products/noaa-planetary-k-index.json': 'kp',
    'services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json': 'xray',
  };
  const feed = feeds[url.hostname + url.pathname];
  if (url.protocol !== 'https:' || !feed) throw new Error('Unsupported public feed.');
  const text = await invoke('hm_control_feed', { request: { feed, latitude: link.home.lat, longitude: link.home.lon } });
  return new Response(text, { status: 200 });
}

export function updateCluster(context, { $, blips, blipXY, esc }, now = Date.now()) {
  const fresh = mapClusterFresh(context, now), spots = context.cluster?.response?.snapshot?.spots || [];
  $('dxDot').className = 'livedot' + (fresh ? '' : ' off');
  blips.spots = [];
  const seen = new Set();
  for (const s of fresh ? spots : []) {
    if (seen.has(s.callsign) || !Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) continue;
    seen.add(s.callsign);
    const point = blipXY({ lat: s.latitude, lon: s.longitude });
    if (point) blips.spots.push({ ...point, call: s.callsign, band: s.band, freq: s.frequencyKHz });
    if (blips.spots.length >= 12) break;
  }
  const html = fresh && spots.length ? spots.slice(0, 25).map(s => `<span><b>${esc(s.callsign)}</b> <u>${esc(s.frequencyKHz)}</u> ${esc(s.country || '')} · ${esc(s.mode || '')}</span>`).join('')
    : `<span>${fresh ? 'No reports in the shared xLog cluster' : 'Shared xLog cluster unavailable · retained reports may be stale'}</span>`;
  const el = $('tick');
  if (el.dataset.content === html) return;
  el.dataset.content = html; el.innerHTML = html + html;
  el.getAnimations().forEach(animation => animation.cancel());
  const width = el.scrollWidth / 2;
  if (width && fresh && !matchMedia('(prefers-reduced-motion: reduce)').matches) el.animate([{ transform: 'translateX(0)' }, { transform: `translateX(-${width}px)` }], { duration: width * 14, iterations: Infinity });
}

export function announceLogChanges(before, after, announce) {
  if (before.generation !== after.generation) return;
  if ('baseRevision' in after.logbook) {
    if (after.logbook.baseRevision == null) return;
    if (after.logbook.baseRevision !== before.logbook.revision) return;
    const countries = new Set(before.logbook.confirmedDXCC || []);
    const event = q => ({ ...q, where: q.whereName + (q.approximate ? ' (DXCC approximate)' : ''), src: 'xLog' });
    for (const q of (after.logbook.added || []).slice().reverse()) announce({ ...event(q), type: 'qso' });
    for (const q of [...(after.logbook.confirmations || []), ...(after.logbook.added || []).filter(q => q.confirmed)].slice().reverse()) {
      const newCountry = q.adif != null && !countries.has(q.adif);
      countries.add(q.adif); announce({ ...event(q), type: 'confirm', newCountry });
    }
    return;
  }
  const old = new Map(before.logbook.recent.map(q => [q.id, q]));
  const added = after.logbook.total > before.logbook.total;
  for (const q of after.logbook.recent.slice().reverse()) {
    const previous = old.get(q.id);
    const event = { ...q, where: q.whereName + (q.approximate ? ' (DXCC approximate)' : ''), src: 'xLog' };
    if (!previous && added) announce({ ...event, type: 'qso' });
    else if (previous && !previous.confirmed && q.confirmed) announce({ ...event, type: 'confirm', newCountry: false });
  }
}
