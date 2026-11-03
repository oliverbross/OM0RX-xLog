import { copyFileSync, chmodSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Xcode can produce a universal worker even for a host-only Rust application.
// Select its matching slice before bundle metadata and signatures are created.
export function stageWorkerExecutable(source, destination, platform, target) {
  if (platform !== 'darwin') {
    copyFileSync(source, destination);
    return;
  }
  const architecture = { 'aarch64-apple-darwin': 'arm64', 'x86_64-apple-darwin': 'x86_64' }[target];
  if (!architecture) throw new Error(`Unsupported Mac worker target: ${target}`);
  const architectures = execFileSync('lipo', ['-archs', source], { encoding: 'utf8' }).trim().split(/\s+/);
  if (!architectures.includes(architecture)) throw new Error(`Worker lacks ${architecture}: ${source}`);
  if (architectures.length === 1) copyFileSync(source, destination);
  else execFileSync('lipo', [source, '-thin', architecture, '-output', destination]);
  chmodSync(destination, statSync(source).mode & 0o777);
  if (execFileSync('lipo', ['-archs', destination], { encoding: 'utf8' }).trim() !== architecture) {
    throw new Error(`Staged worker does not match ${target}`);
  }
}
