// Mac resource accessors must resolve the standard signed Contents/Resources
// layout. Keep staging's --show-bin-path aligned with the actual worker build.
export function swiftWorkerBuildSystemArgs(platform) {
  return platform === 'darwin' ? ['--build-system', 'xcode'] : [];
}
import { join } from 'node:path';


export function swiftWorkerBuildInvocation(platform, root, args) {
  const build = ['build', ...swiftWorkerBuildSystemArgs(platform), ...args];
  return platform === 'darwin' ? { executable: 'swift', args: build } : {
    executable: 'python3', args: [join(root, 'prototype/scripts/portable-swift-lock.py'),
      'run', '--root', root, '--', 'swift', 'build', '--force-resolved-versions', ...build.slice(1)],
  };
}
