import { describe, expect, it, vi } from 'vitest';
import { homeFrom, rigFrom, announceLogChanges, publicFetch } from '../hm-control/xlog-adapter.js';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const contact = { id: 'one', call: 'MM/LY3X/P', band: '40m', mode: 'SSB', whereName: 'Scotland', lat: 56, lon: -4, confirmed: false };
const log = (total: number, recent: any[], generation = 'workspace') => ({ generation, logbook: { total, recent } });
describe('HM Control authoritative data', () => {
  it('requires a real xLog station instead of the upstream sample QTH', () => {
    expect(() => homeFrom({ context: { metadata: { home: null } } })).toThrow(/Settings/);
    expect(homeFrom({ context: { metadata: { home: { call: 'OM0RX', grid: 'KN08', lat: 48, lon: 20 } } } })).toMatchObject({ call: 'OM0RX', lat: 48, lon: 20 });
  });
  it('does not infer on-air state or retain an obsolete provider', () => {
    expect(rigFrom({ selection: { provider: 'hamlib' }, radio: { available: false } })).toBeNull();
    expect(rigFrom({ selection: { provider: 'hamlib' }, radio: { provider: 'direct_agent', available: true, received_at_ms: Date.now() } })).toBeNull();
  });
  it('announces committed additions and confirmations, never a new workspace baseline or an edit', () => {
    const announced = vi.fn();
    announceLogChanges(log(1, [contact]), log(1, [{ ...contact, mode: 'CW' }]), announced);
    announceLogChanges(log(1, [contact]), log(2, [{ ...contact, id: 'two' }, contact]), announced);
    expect(announced).toHaveBeenCalledOnce(); expect(announced.mock.calls[0][0]).toMatchObject({ type: 'qso', call: contact.call, src: 'xLog' });
    announceLogChanges(log(1, [contact]), log(1, [{ ...contact, confirmed: true }]), announced);
    expect(announced.mock.calls[1][0].type).toBe('confirm');
    announceLogChanges(log(1, [contact]), log(2, [{ ...contact, id: 'three' }], 'other'), announced);
    expect(announced).toHaveBeenCalledTimes(2);
  });
  it('blocks arbitrary public URLs and all external feeds in offline acceptance', async () => {
    vi.stubGlobal('location', { href: 'http://localhost/', origin: 'http://localhost' });
    const link = { offline: false, home: { lat: 48, lon: 20 } };
    await expect(publicFetch(link, 'https://example.com/secret')).rejects.toThrow(/Unsupported/);
    await expect(publicFetch({ ...link, offline: true }, 'https://celestrak.org/NORAD/elements/gp.php')).rejects.toThrow(/disabled/);
    vi.unstubAllGlobals();
  });
  it('announces an older contact confirmation and a new country once from committed revisions', () => {
    const before = { generation: 'same', logbook: { revision: 10, confirmedDXCC: [], recent: [] } };
    const after = { generation: 'same', logbook: { revision: 11, baseRevision: 10, confirmedDXCC: [279], added: [], confirmations: [{ ...contact, adif: 279, confirmed: true }], recent: [] } };
    const announce = vi.fn();
    announceLogChanges(before, after, announce);
    expect(announce).toHaveBeenCalledOnce();
    expect(announce.mock.calls[0][0]).toMatchObject({ type: 'confirm', newCountry: true, where: 'Scotland' });
    announceLogChanges(after, after, announce);
    expect(announce).toHaveBeenCalledOnce();
  });
});
