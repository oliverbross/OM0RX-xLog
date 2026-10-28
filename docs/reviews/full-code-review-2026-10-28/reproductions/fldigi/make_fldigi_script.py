from pathlib import Path

root = Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
out = Path('/tmp/xlog-review-20261028-4bd554a/native')
source = (root / 'Sources/XLogPrototypeSupport/LiveFldigiBridge.swift').read_text()
stubs = (out / 'fldigi_stubs.swift').read_text()
harness = (out / 'fldigi_repro.swift').read_text()
harness = harness.replace('@main struct Repro {\n    static func main() async throws {', 'Task {')
harness = harness.rsplit('    }\n}', 1)[0] + '\n    exit(0)\n}\ndispatchMain()\n'
(out / 'fldigi_interpreter_repro.swift').write_text(stubs + '\n' + source + '\n' + harness)
