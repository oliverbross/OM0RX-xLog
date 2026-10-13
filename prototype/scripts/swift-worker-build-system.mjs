// Mac resource accessors must resolve the standard signed Contents/Resources
// layout. Keep staging's --show-bin-path aligned with the actual worker build.
export function swiftWorkerBuildSystemArgs(platform) {
  return platform === 'darwin' ? ['--build-system', 'xcode'] : [];
}
