import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, statSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { stageWorkerExecutable } from './stage-worker-executable.mjs';

test('Mac worker staging selects both supported host slices and rejects missing/unknown targets', { skip: process.platform !== 'darwin' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'xlog-worker-architecture-'));
  try {
    const source = join(root, 'worker.c');
    writeFileSync(source, 'int main(void) { return 0; }\n');
    for (const arch of ['arm64', 'x86_64']) execFileSync('xcrun', ['clang', '-arch', arch, '-c', source, '-o', join(root, arch)]);
    const universal = join(root, 'universal');
    execFileSync('lipo', ['-create', join(root, 'arm64'), join(root, 'x86_64'), '-output', universal]);
    chmodSync(universal, 0o755);
    for (const [target, arch] of [['aarch64-apple-darwin', 'arm64'], ['x86_64-apple-darwin', 'x86_64']]) {
      const destination = join(root, `staged-${arch}`);
      stageWorkerExecutable(universal, destination, 'darwin', target);
      assert.equal(execFileSync('lipo', ['-archs', destination], { encoding: 'utf8' }).trim(), arch);
      assert.equal(statSync(destination).mode & 0o777, 0o755);
      assert.deepEqual(readFileSync(destination), readFileSync(join(root, arch)));
      const thinCopy = join(root, `thin-${arch}`);
      stageWorkerExecutable(destination, thinCopy, 'darwin', target);
      assert.deepEqual(readFileSync(thinCopy), readFileSync(destination));
    }
    assert.equal(execFileSync('lipo', ['-archs', universal], { encoding: 'utf8' }).trim().split(/\s+/).length, 2);
    assert.throws(() => stageWorkerExecutable(join(root, 'arm64'), join(root, 'missing'), 'darwin', 'x86_64-apple-darwin'), /lacks x86_64/);
    assert.throws(() => stageWorkerExecutable(universal, join(root, 'unknown'), 'darwin', 'unknown'), /Unsupported Mac worker target/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('non-Mac staging retains the complete worker bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'xlog-worker-copy-'));
  try {
    const source = join(root, 'source'), destination = join(root, 'destination');
    writeFileSync(source, 'portable worker fixture');
    stageWorkerExecutable(source, destination, 'linux', 'x86_64-unknown-linux-gnu');
    assert.deepEqual(readFileSync(destination), readFileSync(source));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
