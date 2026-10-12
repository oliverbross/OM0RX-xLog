#!/usr/bin/env node
// P1 lab harness: no model, endpoint, serial device or daemon options are accepted.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile, realpath, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const HOST = '127.0.0.1';
const EXPECTED_VERSION = /Hamlib 4\.7\.2(?:\s|$)/;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const owned = [];
const sockets = [];
let directory;
let interrupted = false;
const report = { status: 'FAIL', model: 1, host: HOST, version: '4.7.2', checks: [], helpers: [] };

function stopSignal() {
  interrupted = true;
  for (const socket of sockets) socket.destroy(new Error('Interrupted'));
  for (const helper of owned) if (helper.child.exitCode === null) helper.child.kill('SIGTERM');
}
process.on('SIGINT', stopSignal);
process.on('SIGTERM', stopSignal);

async function inspect(binary, role) {
  const executable = await realpath(binary);
  await access(executable, constants.X_OK);
  const { stdout, stderr } = await exec(executable, ['--version'], { timeout: 3000, maxBuffer: 16384 });
  const version = `${stdout}\n${stderr}`.trim();
  assert.match(version, EXPECTED_VERSION, 'Only the pinned Hamlib 4.7.2 is accepted');
  assert.ok(role === 'radio' ? version.startsWith('rigctld Hamlib ') : version.startsWith('rotctl(d), Hamlib '), 'Radio and rotor executable roles must match');
  return { executable, version: version.split('\n')[0], sha256: createHash('sha256').update(await readFile(executable)).digest('hex') };
}

async function reservePort() {
  const reservation = net.createServer();
  await new Promise((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen({ host: HOST, port: 0, exclusive: true }, resolve);
  });
  return { reservation, port: reservation.address().port };
}

async function start(metadata, allocation) {
  // Reserve before selection, release immediately before spawn; bind failure is fatal.
  await new Promise((resolve, reject) => allocation.reservation.close(error => error ? reject(error) : resolve()));
  if (interrupted) throw new Error('Interrupted');
  const args = ['-m', '1', '-T', HOST, '-t', String(allocation.port)];
  const child = spawn(metadata.executable, args, { cwd: directory, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  const helper = { child, exited: false, error: null, output: '', ...metadata, port: allocation.port, args };
  owned.push(helper);
  child.on('error', error => { helper.error = error; });
  child.once('exit', (code, signal) => { helper.exited = true; helper.exit = { code, signal }; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {
    helper.output = (helper.output + data.toString()).slice(-16384);
  });
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (helper.error || helper.exited || interrupted) throw helper.error ?? new Error(`Dummy helper exited before readiness: ${helper.output}`);
    const socket = await new Promise(resolve => {
      const candidate = net.createConnection({ host: HOST, port: helper.port });
      candidate.setTimeout(150, () => candidate.destroy());
      candidate.once('connect', () => { candidate.setTimeout(0); resolve(candidate); });
      candidate.once('error', () => resolve(null));
      candidate.once('close', () => resolve(null));
    });
    if (socket) {
      sockets.push(socket);
      // Give immediate bind/start failures a chance to arrive before any writes.
      await delay(75);
      if (helper.exited || helper.error || /bind.*(?:fail|error)|address already in use/i.test(helper.output)) {
        socket.destroy();
        throw helper.error ?? new Error(`Dummy helper could not own its port: ${helper.output}`);
      }
      report.helpers.push({ ...metadata, pid: child.pid, port: helper.port, args });
      return new Session(socket, helper);
    }
    await delay(25);
  }
  throw new Error(`Dummy helper readiness timed out: ${helper.output}`);
}

class Session {
  constructor(socket, helper) {
    this.socket = socket;
    this.helper = helper;
    this.pending = null;
    this.buffer = '';
    this.failure = null;
    socket.setEncoding('utf8');
    socket.on('error', error => this.fail(error));
    socket.on('close', () => this.fail(new Error('Dummy connection closed')));
    socket.on('data', chunk => {
      this.buffer += chunk;
      if (this.buffer.length > 8192) return this.fail(new Error('Response exceeds bound'));
      while (this.buffer.includes('\n')) {
        const end = this.buffer.indexOf('\n');
        const line = this.buffer.slice(0, end).replace(/\r$/, '');
        this.buffer = this.buffer.slice(end + 1);
        if (!this.pending) return this.fail(new Error('Unexpected response without a request'));
        this.pending.lines.push(line);
        if (this.pending.lines.length === this.pending.count) {
          const { resolve, lines, timer } = this.pending;
          this.pending = null;
          clearTimeout(timer);
          resolve(lines);
        }
      }
    });
  }
  fail(error) {
    this.failure ??= error;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = null;
    }
  }
  command(command, count) {
    assert.equal(this.pending, null, 'Only one command may be outstanding');
    if (this.failure || this.helper.exited || interrupted) throw this.failure ?? new Error('Helper unavailable');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error(`Command timeout: ${command}`));
        this.socket.destroy();
      }, 2000);
      this.pending = { resolve, reject, timer, count, lines: [] };
      this.socket.write(`${command}\n`, error => { if (error) this.fail(error); });
    });
  }
}

async function check(name, work) {
  const result = await work();
  report.checks.push({ name, status: 'PASS', result });
}

async function cleanup() {
  for (const socket of sockets) socket.destroy();
  for (const helper of owned) {
    if (!helper.exited && !helper.error) helper.child.kill('SIGTERM');
  }
  let deadline = Date.now() + 1000;
  while (owned.some(helper => !helper.exited && !helper.error) && Date.now() < deadline) await delay(20);
  for (const helper of owned) if (!helper.exited && !helper.error) helper.child.kill('SIGKILL');
  deadline = Date.now() + 1000;
  while (owned.some(helper => !helper.exited && !helper.error) && Date.now() < deadline) await delay(20);
  assert.ok(owned.every(helper => helper.exited || helper.error), 'Owned helpers failed to stop');
  report.cleanup = owned.map(helper => ({ pid: helper.child.pid, stopped: helper.exited || Boolean(helper.error), ...helper.exit }));
  for (const helper of owned) {
    const probe = net.createServer();
    try {
      await new Promise((resolve, reject) => {
        probe.once('error', reject);
        probe.listen({ host: HOST, port: helper.port, exclusive: true }, resolve);
      });
      report.cleanup.find(result => result.pid === helper.child.pid).portReleased = true;
    } finally {
      if (probe.listening) await new Promise(resolve => probe.close(resolve));
    }
  }
  if (directory) await rm(directory, { recursive: true, force: true });
}

let allocations = [];
try {
  const args = process.argv.slice(2);
  assert.equal(args.length, 2, 'Usage: node hamlib-dummy-smoke.mjs /path/to/rigctld /path/to/rotctld');
  const [rig, rotor] = await Promise.all([inspect(args[0], 'radio'), inspect(args[1], 'rotor')]);
  directory = await mkdtemp(path.join(tmpdir(), 'xlog-hamlib-dummy-'));
  const reserved = await Promise.allSettled([reservePort(), reservePort()]);
  allocations = reserved.filter(result => result.status === 'fulfilled').map(result => result.value);
  for (const result of reserved) if (result.status === 'rejected') throw result.reason;
  const radio = await start(rig, allocations[0]);
  const rotator = await start(rotor, allocations[1]);
  await check('dummy radio identity', async () => {
    const response = await radio.command('_', 1);
    assert.match(response[0], /dummy/i);
    return response;
  });
  await check('dummy radio frequency set', async () => {
    const response = await radio.command('F 14074000', 1);
    assert.deepEqual(response, ['RPRT 0']);
    return response;
  });
  await check('dummy radio frequency readback', async () => {
    const response = await radio.command('f', 1);
    assert.equal(Number(response[0]), 14074000);
    return response;
  });
  await check('dummy radio mode set', async () => {
    const response = await radio.command('M USB 2400', 1);
    assert.deepEqual(response, ['RPRT 0']);
    return response;
  });
  await check('dummy radio mode readback', async () => {
    const response = await radio.command('m', 2);
    assert.deepEqual(response, ['USB', '2400']);
    return response;
  });
  await check('dummy rotor identity', async () => {
    const response = await rotator.command('_', 1);
    assert.match(response[0], /dummy/i);
    return response;
  });
  await check('dummy rotor position set', async () => {
    const response = await rotator.command('P 12 6', 1);
    assert.deepEqual(response, ['RPRT 0']);
    return response;
  });
  await check('dummy rotor position readback', async () => {
    // Model 1 simulates six degrees/second; acknowledgment precedes arrival.
    const deadline = Date.now() + 4000;
    const observations = [];
    while (Date.now() < deadline) {
      const response = (await rotator.command('p', 2)).map(Number);
      assert.ok(response.every(Number.isFinite), 'Rotor position must be numeric');
      observations.push(response);
      if (response[0] === 12 && response[1] === 6) return observations;
      assert.ok(response[0] >= 0 && response[0] <= 12 && response[1] >= 0 && response[1] <= 6, 'Dummy rotor left the expected trajectory');
      await delay(100);
    }
    throw new Error(`Dummy rotor never reached observed target: ${JSON.stringify(observations)}`);
  });
  if (interrupted) throw new Error('Interrupted');
  report.status = 'PASS';
} catch (error) {
  report.error = error.message;
  report.helperDiagnostics = owned.map(helper => ({ pid: helper.child.pid, output: helper.output }));
  process.exitCode = 1;
} finally {
  // Close reservations that did not reach spawn, including the first-start failure case.
  for (const { reservation } of allocations) if (reservation.listening) await new Promise(resolve => reservation.close(resolve));
  try { await cleanup(); } catch (error) {
    report.status = 'FAIL';
    report.cleanupError = error.message;
    process.exitCode = 1;
  }
  if (interrupted) {
    report.status = 'FAIL';
    report.error ??= 'Interrupted';
    process.exitCode = 1;
  }
  console.log(JSON.stringify(report, null, 2));
}
