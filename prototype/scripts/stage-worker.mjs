// Stage only the prototype's own release worker, never an installed application.
import { cpSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { swiftWorkerBuildSystemArgs } from './swift-worker-build-system.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const executable = `xlog-prototype-worker${process.platform === 'win32' ? '.exe' : ''}`;
const binDir = execFileSync('swift', ['build', ...swiftWorkerBuildSystemArgs(process.platform), '--scratch-path', '.build/prototype-worker', '-c', 'release', '--show-bin-path'], {
  cwd: root, env: { ...process.env, XLOG_PORTABLE_ONLY: '1' }, encoding: 'utf8',
}).trim();
const source = join(binDir, executable);
if (!existsSync(source)) throw new Error('Build the prototype worker before staging.');
const resourceName = process.platform === 'darwin'
  ? 'OM0RXXLogPrototype_XLogCore.bundle'
  : 'OM0RXXLogPrototype_XLogPortableCore.resources';
const coreResources = join(binDir, resourceName);
if (!existsSync(coreResources)) throw new Error(`Required local logbook resources are missing: ${resourceName}`);
const target = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (.+)$/m)?.[1];
if (!target) throw new Error('Cannot resolve Rust host triple.');
const binaries = join(root, 'prototype/src-tauri/binaries');
mkdirSync(binaries, { recursive: true });
copyFileSync(source, join(binaries, `xlog-prototype-worker-${target}${process.platform === 'win32' ? '.exe' : ''}`));

// Cargo-run/development location; release bundlers use externalBin instead.
for (const mode of ['debug', 'release']) {
  const destination = join(root, 'prototype/src-tauri/target', mode);
  mkdirSync(destination, { recursive: true });
  copyFileSync(source, join(destination, executable));
  cpSync(coreResources, join(destination, resourceName), { recursive: true });
  if (process.platform === 'win32' && existsSync(join(binDir, 'sqlite3.dll'))) {
    cpSync(join(binDir, 'sqlite3.dll'), join(destination, 'sqlite3.dll'));
  }
}
console.log(`Staged ${executable} for ${target}. Runtime dependency packaging is a separate acceptance gate.`);
