#!/usr/bin/env python3
"""Packaged Linux QA lifecycle receipts; no UI input or arbitrary PID signals."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

def save(path, value):
    path = Path(path); temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n'); temporary.chmod(0o600); temporary.replace(path)

def stat_identity(pid):
    text = Path(f'/proc/{pid}/stat').read_text(); fields = text[text.rfind(')') + 2:].split()
    return {'pid': pid, 'ppid': int(fields[1]), 'startTicks': int(fields[19]), 'state': fields[0]}

def identity(pid):
    try:
        first = stat_identity(pid)
        value = {**first, 'executable': None, 'argv': []}
        try:
            value['executable'] = os.readlink(f'/proc/{pid}/exe')
            value['argv'] = Path(f'/proc/{pid}/cmdline').read_bytes().rstrip(b'\0').decode().split('\0')
        except FileNotFoundError: pass
        second = stat_identity(pid)
        # Never publish another task's argv/exe under the first task's start.
        if first['startTicks'] != second['startTicks']: return None
        value.update(ppid=second['ppid'], state=second['state'])
        return value
    except FileNotFoundError: return None

def original_state(expected):
    if expected is None: return {'state': 'unknown-no-identity'}
    current = identity(expected['pid'])
    if current is None: return {'state': 'absent'}
    if current['startTicks'] != expected['startTicks']: return {'state': 'original-absent-pid-reused'}
    return {'state': 'present-exited-zombie' if current['state'] == 'Z' else 'present', 'identity': current}

def absent(value): return value['state'] in ('absent', 'original-absent-pid-reused')
def exit_code(value): return 128 - value if value < 0 else value

class Owned:
    """An exclusive original Popen is retained even if the first receipt fails."""
    def __init__(self, argv, receipt, *, writer=save, **kwargs):
        self.receipt, self.writer = receipt, writer
        self.value = {'schema': 1, 'argv': argv, 'initialIdentity': None, 'actualWaitReturnCode': None,
                      'cleanupSignals': [], 'cleanupErrors': [], 'ordinaryExit': False}
        self.proc = subprocess.Popen(argv, **kwargs)
        self.value['createdPID'] = self.proc.pid
        try:
            self.persist() # Before identity/proof: preserves exclusive creation.
            self.value['initialIdentity'] = identity(self.proc.pid); self.persist()
        except BaseException:
            self.cleanup(); raise

    def persist(self): self.writer(self.receipt, self.value)
    def finish(self, timeout):
        code = self.proc.wait(timeout=timeout)
        self.value.update(actualWaitReturnCode=code, ordinaryExit=code == 0 and not self.value['cleanupSignals'])
        self.value['finalState'] = original_state(self.value['initialIdentity']); self.persist()
        return code

    def cleanup(self):
        # Never waits forever and never needs an on-disk startup receipt. Only
        # this original child handle is signalled; no guessed PID/group signal.
        if self.proc.poll() is None:
            for name, action in (('TERM', self.proc.terminate), ('KILL', self.proc.kill)):
                self.value['cleanupSignals'].append(name)
                try: action(); self.proc.wait(timeout=2); break
                except subprocess.TimeoutExpired: continue
                except BaseException as error: self.value['cleanupErrors'].append(type(error).__name__)
        self.value.update(actualWaitReturnCode=self.proc.poll(), ordinaryExit=False)
        try: self.value['finalState'] = original_state(self.value['initialIdentity'])
        except BaseException as error: self.value['finalState'] = {'state': 'unknown', 'errorType': type(error).__name__}
        try: self.persist()
        except BaseException as error: self.value['cleanupErrors'].append('receipt:' + type(error).__name__)
        return self.proc.poll() is not None and not self.value['cleanupErrors']

def children(pid):
    values = set()
    for task in Path(f'/proc/{pid}/task').glob('*'):
        try: values.update(int(value) for value in (task / 'children').read_text().split())
        except FileNotFoundError: pass
    return values

def supervise(args):
    package, report = args.package.resolve(strict=True), args.report.resolve()
    host_exe, worker_exe = (str(package / 'bin' / name) for name in ('xlog-prototype', 'xlog-prototype-worker'))
    value = {'schema': 1, 'scope': 'direct-host-and-observed-workers-only', 'hostIdentity': None, 'observedWorkers': [],
             'actualHostWaitReturnCode': None, 'workerWaitReturnCode': None, 'workerEOF': 'unknown-not-observed',
             'receivedSignals': [], 'status': 'running'}
    child = None; workers = {}; cleanup_attempted = False
    def interrupted(number, _frame):
        value['receivedSignals'].append(number); value['status'] = 'interrupted-not-ordinary'; save(args.receipt, value)
    for number in (signal.SIGTERM, signal.SIGINT): signal.signal(number, interrupted)
    try:
        child = Owned([str(package / 'launch'), '--acceptance-report', str(report)], args.receipt.with_suffix('.host.json'))
        value['createdHostPID'] = child.proc.pid; save(args.receipt, value)
        while child.proc.poll() is None:
            if value['receivedSignals']:
                # GNU timeout already signalled this process group. A native
                # host may ignore TERM, so stop supervising normal work and
                # boundedly retire the original exclusive child handle now.
                cleanup_attempted = True
                stopped = child.cleanup(); value['hostCleanup'] = child.value
                value['actualHostWaitReturnCode'] = child.proc.poll()
                if not stopped or child.proc.poll() is None:
                    value.update(status='failed-interrupted-cleanup-unconfirmed', hostNormalExit=False)
                    value['workerFinalStates'] = [original_state(worker) for worker in workers.values()]
                    save(args.receipt, value); return 1
                break
            host = identity(child.proc.pid)
            if host and host['ppid'] == os.getpid() and host['executable'] == host_exe and host['argv'] == [host_exe, '--acceptance-report', str(report)]:
                value['hostIdentity'] = host
                for pid in children(child.proc.pid):
                    worker = identity(pid)
                    if worker and worker['ppid'] == child.proc.pid and worker['executable'] == worker_exe and worker['argv'] == [worker_exe, '--local-ui-acceptance']:
                        key = (pid, worker['startTicks'])
                        if key not in workers:
                            if len(workers) >= 16: raise RuntimeError('Worker churn exceeds bounded receipt')
                            workers[key] = worker; value['observedWorkers'] = list(workers.values()); save(args.receipt, value)
            time.sleep(0.1)
        value['actualHostWaitReturnCode'] = child.finish(timeout=0)
        value['workerFinalStates'] = [original_state(worker) for worker in workers.values()]
        value['workerOutcome'] = 'unobserved-unknown' if not workers else 'all-observed-absent' if all(absent(row) for row in value['workerFinalStates']) else 'present-or-unknown'
        value['hostNormalExit'] = child.proc.returncode == 0 and not value['receivedSignals'] and not child.value['cleanupSignals']
        value['status'] = 'passed' if value['hostNormalExit'] and value['hostIdentity'] and workers and value['workerOutcome'] == 'all-observed-absent' else 'failed-or-incomplete'
        save(args.receipt, value)
        return exit_code(child.proc.returncode) if child.proc.returncode else 0 if value['status'] == 'passed' else 1
    except BaseException as error:
        value.update(status='failed', errorType=type(error).__name__)
        if child is not None:
            if not cleanup_attempted: child.cleanup()
            value['hostCleanup'] = child.value
            value['actualHostWaitReturnCode'] = child.proc.returncode
        value['workerFinalStates'] = [original_state(worker) for worker in workers.values()]
        try: save(args.receipt, value)
        except BaseException: print('Host receipt unavailable after bounded cleanup', file=sys.stderr)
        # Preserve a real nonzero host result even when receipt persistence fails.
        return exit_code(child.proc.returncode) if child is not None and child.proc.returncode else 1

def session(args):
    # This parent owns timeout and compositor Popen handles, while supervise
    # owns the actual host. Receipt/startup failures cannot lose those handles.
    package, report = args.package.resolve(strict=True), args.report.resolve()
    wayland = args.backend == 'wayland'; app = None; weston = None; primary = 1
    result = {'schema': 1, 'status': 'running', 'wrapperWaitReturnCode': None, 'hostWaitReturnCode': None,
              'cleanupStatus': 'unknown', 'scope': 'owned-timeout-host-observed-workers-compositor', 'forcedApplicationSignals': False}
    state = report.with_suffix('.session.json'); host_receipt = report.with_suffix('.process.json')
    handles = []; cleanup_failed = False
    try:
        save(state, result)
        if wayland:
            version = subprocess.run(['weston', '--version'], stdout=subprocess.PIPE, check=True).stdout
            (report.parent / 'weston-version.txt').write_bytes(version)
            process_log = (report.parent / 'weston-process.log').open('xb'); handles.append(process_log)
            weston = Owned(['weston', '--backend=x11', '--renderer=pixman', '--no-config', '--idle-time=0', '--width=1600', '--height=1100',
                            '--socket=' + os.environ['WAYLAND_DISPLAY'], '--log=' + str(report.parent / 'weston.log')],
                           report.parent / 'wayland-compositor.process.json', stdout=process_log, stderr=subprocess.STDOUT)
            socket = Path(os.environ['XDG_RUNTIME_DIR']) / os.environ['WAYLAND_DISPLAY']
            for _ in range(40):
                if socket.is_socket(): break
                if weston.proc.poll() is not None: raise RuntimeError('Weston exited before readiness')
                time.sleep(0.25)
            if not socket.is_socket(): raise RuntimeError('Weston readiness timed out')
        log = args.log.open('xb'); handles.append(log)
        argv = ['timeout'] + (['--kill-after=5'] if wayland else []) + ['100', sys.executable, str(Path(__file__).resolve()), 'supervise',
                         str(package), str(report), str(host_receipt)]
        environment = dict(os.environ)
        if wayland: environment.pop('DISPLAY', None)
        started = time.monotonic()
        app = Owned(argv, report.with_suffix('.timeout.json'), env=environment, stdout=log, stderr=subprocess.STDOUT)
        for _ in range(200):
            if report.exists() and report.stat().st_size:
                time.sleep(1)
                subprocess.run(['import', '-window', 'root', str(args.png)], check=True, timeout=max(0.01, 100 - (time.monotonic() - started)))
                break
            if app.proc.poll() is not None: break
            if weston is not None and weston.proc.poll() is not None: raise RuntimeError('Weston exited during application')
            time.sleep(0.5)
        # Same100s app deadline / Wayland5s kill-after. Cleanup is bounded and
        # cannot turn a deadline or forced exit into an ordinary success.
        try: code = app.finish(timeout=max(0, started + 100 + (5 if wayland else 0) - time.monotonic()))
        except subprocess.TimeoutExpired:
            result['wrapperDeadlineExceeded'] = True; primary = 124; raise
        result['wrapperWaitReturnCode'] = code; primary = exit_code(code)
        if host_receipt.exists():
            host = json.loads(host_receipt.read_text()); result['hostWaitReturnCode'] = host.get('actualHostWaitReturnCode')
            result['hostStatus'] = host.get('status'); result['forcedApplicationSignals'] = bool(host.get('receivedSignals'))
        else: result['hostStatus'] = 'unknown-no-receipt'
        if primary == 0 and result['hostStatus'] != 'passed': primary = 1
        result['status'] = 'passed' if primary == 0 else 'failed'; save(state, result)
    except BaseException as error:
        result.update(status='failed', errorType=type(error).__name__)
        # Do not replace an already recorded nonzero wrapper/deadline result.
        if app is not None and app.proc.returncode and primary != 124: primary = exit_code(app.proc.returncode)
        if primary == 0: primary = 1
    finally:
        for role, owner in (('application-wrapper', app), ('weston', weston)):
            if owner is None: continue
            before_cleanup = owner.proc.poll()
            if role == 'application-wrapper':
                result['wrapperWaitObservedBeforeFailureCleanup'] = before_cleanup
                if before_cleanup is not None:
                    result['wrapperWaitReturnCode'] = before_cleanup
                    if before_cleanup != 0 and primary != 124: primary = exit_code(before_cleanup)
            was_live = before_cleanup is None
            if was_live:
                if not owner.cleanup(): cleanup_failed = True
                if role == 'application-wrapper': result['forcedApplicationSignals'] = True; cleanup_failed = True
            else:
                try: owner.finish(timeout=0)
                except BaseException: cleanup_failed = True
                if role == 'weston' and owner.proc.returncode != 0: cleanup_failed = True
            if 'KILL' in owner.value['cleanupSignals']: cleanup_failed = True
            result[role + 'Final'] = owner.value
        if host_receipt.exists():
            try:
                host = json.loads(host_receipt.read_text()); known = ([host['hostIdentity']] if host.get('hostIdentity') else []) + host.get('observedWorkers', [])
                result['finalScopedInventory'] = [{'expected': expected, 'current': original_state(expected)} for expected in known]
                result['inventoryCoverage'] = 'host-and-observed-workers' if host.get('hostIdentity') and host.get('observedWorkers') else 'partial-or-unknown'
                if result['inventoryCoverage'] != 'host-and-observed-workers' or any(not absent(row['current']) for row in result['finalScopedInventory']): cleanup_failed = True
            except BaseException: result['inventoryCoverage'] = 'unknown-unreadable-receipt'; cleanup_failed = True
        else: result['inventoryCoverage'] = 'unknown-no-host-receipt'; cleanup_failed = True
        result['cleanupStatus'] = 'failed-or-incomplete' if cleanup_failed else 'complete-known-scope'
        if primary == 0 and cleanup_failed: primary = 1
        result['returnedExitCode'] = primary
        result['status'] = 'passed' if primary == 0 else 'failed'
        try: save(state, result)
        except BaseException:
            if primary == 0: primary = 1
            print(json.dumps({'lifecycleReceiptUnavailable': True, 'actualWrapperWaitReturnCode': result['wrapperWaitReturnCode'], 'returnedExitCode': primary}), file=sys.stderr)
        finally:
            for handle in handles: handle.close()
    return primary

def main():
    parser = argparse.ArgumentParser(description=__doc__); modes = parser.add_subparsers(dest='mode', required=True)
    p = modes.add_parser('supervise'); p.add_argument('package', type=Path); p.add_argument('report', type=Path); p.add_argument('receipt', type=Path); p.set_defaults(run=supervise)
    p = modes.add_parser('session'); p.add_argument('package', type=Path); p.add_argument('report', type=Path); p.add_argument('log', type=Path); p.add_argument('png', type=Path); p.add_argument('backend', choices=['x11', 'wayland']); p.set_defaults(run=session)
    args = parser.parse_args(); raise SystemExit(args.run(args))

if __name__ == '__main__': main()
