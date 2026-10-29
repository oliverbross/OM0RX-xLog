import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

const installedPaths = ['MacOS/xlog-prototype', 'MacOS/xlog-prototype-worker', 'MacOS/xlog-cw-worker', 'MacOS/rigctld', 'MacOS/rotctld',
  'Frameworks/Python.framework/Versions/3.12/bin/python3.12'];

let fixtureBuild = null, fixtureBuildError = null;
function ownedProcessFixture() {
  if (fixtureBuildError) throw fixtureBuildError;
  if (fixtureBuild) return fixtureBuild;
  try {
    const root = mkdtempSync(join(tmpdir(), 'xlog-installer-owner-'));
    const executable = join(root, 'owned-pause');
    const source = '#include <unistd.h>\nint main(void) { for (;;) pause(); }\n';
    const toolchain = spawnSync('/usr/bin/xcrun', ['--sdk', 'macosx', '--find', 'clang'], { encoding: 'utf8' });
    assert.equal(toolchain.status, 0, toolchain.stderr);
    const clang = toolchain.stdout.trim();
    const sdk = spawnSync('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8' });
    assert.equal(sdk.status, 0, sdk.stderr);
    const sdkPath = sdk.stdout.trim();
    const compiled = spawnSync(clang, ['-isysroot', sdkPath, '-x', 'c', '-', '-o', executable], { input: source, encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stderr);
    // Sign and verify this standalone test executable before it enters a fake
    // app. No real candidate or Apple system executable is modified or signed.
    const sign = spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'com.oliverbross.xlog.installer-fixture', executable], { encoding: 'utf8' });
    assert.equal(sign.status, 0, sign.stderr);
    const verify = spawnSync('/usr/bin/codesign', ['--verify', '--strict', executable], { encoding: 'utf8' });
    assert.equal(verify.status, 0, verify.stderr);
    fixtureBuild = { executable, clang, sdkPath, sourceSHA256: createHash('sha256').update(source).digest('hex'),
      sha256: createHash('sha256').update(readFileSync(executable)).digest('hex'),
      signingIdentity: 'ad-hoc standalone test executable only', signExit: sign.status, verificationExit: verify.status };
    return fixtureBuild;
  } catch (cause) { fixtureBuildError = cause; throw cause; }
}

for (const installedPath of installedPaths) {
  test(`installer refuses live ${installedPath} without signalling it or replacing its bundle`, { skip: process.platform !== 'darwin' }, async t => {
    const repo = resolve(import.meta.dirname, '../..');
    const root = mkdtempSync(join(tmpdir(), 'xlog-installer-refusal-'));
    const scripts = join(root, 'prototype/scripts');
    const fixture = ownedProcessFixture();
    mkdirSync(scripts, { recursive: true });
    for (const name of ['install-macos.sh', 'macos-app-process.sh']) copyFileSync(join(repo, 'prototype/scripts', name), join(scripts, name));
    const candidate = join(root, 'Candidate.app'), destination = join(root, 'Installed.app');
    for (const app of [candidate, destination]) {
      for (const name of ['XLog', 'XContest']) mkdirSync(join(app, `Contents/Resources/OM0RXXLogPrototype_${name}Core.bundle`), { recursive: true });
      writeFileSync(join(app, 'Contents/Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>xlog-prototype</string></dict></plist>');
      for (const path of installedPaths) {
        const target = join(app, 'Contents', path);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(app === destination && path === installedPath ? fixture.executable : '/usr/bin/true', target);
      }
      writeFileSync(join(app, 'Contents/identity'), app === destination ? 'preserve-current' : 'candidate');
    }
    // Only signature verification is stubbed for these synthetic process fixtures.
    // Actual bundle signing remains a separate, real packaging acceptance gate.
    const bin = join(root, 'bin'); mkdirSync(bin);
    writeFileSync(join(bin, 'codesign'), '#!/bin/sh\nexit 0\n'); chmodSync(join(bin, 'codesign'), 0o755);
    const childPath = join(destination, 'Contents', installedPath);
    assert.equal(createHash('sha256').update(readFileSync(childPath)).digest('hex'), fixture.sha256);
    const child = spawn(childPath, ['600'], { stdio: 'ignore' });
    let childExit = null;
    child.once('exit', (code, signal) => { childExit = { code, signal }; });
    const childExitEvent = once(child, 'exit');
    await once(child, 'spawn');
    t.after(async () => {
      await new Promise(resolve => setImmediate(resolve));
      if (child.exitCode === null && child.signalCode === null) {
        const current = spawnSync('/bin/ps', ['-p', String(child.pid), '-o', 'comm='], { encoding: 'utf8' }).stdout.trim();
        if (current !== childPath) {
          child.unref();
          assert.fail(`Disposable child identity is unconfirmed; no cleanup signal sent: ${child.pid} ${current}`);
        }
        child.kill('SIGTERM');
        await childExitEvent;
      }
    });
    let command = '';
    for (let n = 0; n < 50; n++) {
      command = spawnSync('/bin/ps', ['-p', String(child.pid), '-o', 'comm='], { encoding: 'utf8' }).stdout.trim();
      if (command === childPath) break;
      await delay(10);
    }
    assert.equal(command, childPath, 'positively identify the disposable child before the installer exercise');
    const processBefore = spawnSync('/bin/ps', ['-axo', 'pid=,comm='], { encoding: 'utf8' }).stdout.split('\n').filter(line => line.includes(root));
    const result = spawnSync('/bin/bash', [join(scripts, 'install-macos.sh'), candidate, destination], {
      encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, timeout: 15000,
    });
    await new Promise(resolve => setImmediate(resolve));
    t.diagnostic(JSON.stringify({ installedPath, fixtureRoot: root, childPID: child.pid,
      installerSHA256: createHash('sha256').update(readFileSync(join(scripts, 'install-macos.sh'))).digest('hex'),
      fixture, installerExit: result.status, installerStdout: result.stdout, installerStderr: result.stderr, childExit,
      processBefore, processAfter: spawnSync('/bin/ps', ['-axo', 'pid=,comm='], { encoding: 'utf8' }).stdout.split('\n').filter(line => line.includes(root)),
      childCommAfter: spawnSync('/bin/ps', ['-p', String(child.pid), '-o', 'comm='], { encoding: 'utf8' }).stdout.trim() }));
    assert.notEqual(result.status, 0, 'a live destination must refuse replacement');
    assert.match(result.stderr, /Application remains running \(no relaunch or signal issued\)/);
    assert.equal(spawnSync('/bin/ps', ['-p', String(child.pid), '-o', 'comm='], { encoding: 'utf8' }).stdout.trim(), childPath);
    assert.equal(readFileSync(join(destination, 'Contents/identity'), 'utf8'), 'preserve-current');
    assert.equal(readFileSync(join(candidate, 'Contents/identity'), 'utf8'), 'candidate');
    assert.ok(existsSync(childPath));
    assert.doesNotMatch(result.stdout, /Installed and verified|Recoverable previous application/);
  });
}
