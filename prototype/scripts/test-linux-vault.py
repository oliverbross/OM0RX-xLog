#!/usr/bin/env python3
"""Exercise the Linux vault only in a disposable D-Bus/keyring environment.

Requires cc, pkg-config, libsecret-1-dev, dbus and gnome-keyring. Optionally run
already-built Swift credential tests inside the same unlocked fixture keyring:
  XLOG_PORTABLE_ONLY=1 python3 prototype/scripts/test-linux-vault.py --swift-tests
Never connects to the invoking user's session bus or changes their HOME.
"""

import argparse
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import time


REPO = Path(__file__).resolve().parents[2]
PASSWORD = b"xlog-disposable-keyring-fixture-password"


def run(command, *, env, timeout=15, **kwargs):
    return subprocess.run(command, cwd=REPO, env=env, timeout=timeout,
                          check=True, **kwargs)


def stop_daemon(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()  # Only the exact foreground fixture child PID.
            process.wait(timeout=5)


def start_daemon(root, env, sequence):
    control = root / f"control-{sequence}"
    control.mkdir(mode=0o700)
    env["GNOME_KEYRING_CONTROL"] = str(control)
    log = (root / f"keyring-{sequence}.log").open("wb")
    process = subprocess.Popen([
        "gnome-keyring-daemon", "--foreground", "--components=secrets",
        "--control-directory=" + str(control), "--unlock",
    ], cwd=REPO, env=env, stdin=subprocess.PIPE, stdout=log, stderr=log)
    log.close()
    try:
        process.stdin.write(PASSWORD)
        process.stdin.close()
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError("Disposable keyring daemon exited during startup")
            status = run([
                "dbus-send", "--session", "--print-reply", "--dest=org.freedesktop.DBus",
                "/org/freedesktop/DBus", "org.freedesktop.DBus.NameHasOwner",
                "string:org.freedesktop.secrets",
            ], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=2)
            if b"boolean true" in status.stdout:
                probe = subprocess.run([str(root / "vault-smoke"), "probe"], cwd=REPO, env=env,
                                       timeout=2, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                if probe.returncode == 0:
                    return process
            time.sleep(0.05)
        raise RuntimeError("Disposable keyring daemon did not acquire its private bus name")
    except BaseException:
        stop_daemon(process)
        raise


def isolated_session(root, swift_tests, swift_scratch_path):
    env = os.environ.copy()
    if (env.get("XLOG_TEST_LINUX_VAULT_ROOT") != str(root)
            or env.get("XDG_DATA_HOME") != str(root / "data")
            or not env.get("DBUS_SESSION_BUS_ADDRESS")
            or (root / "fixture-owner").read_text() != "xlog-linux-vault-fixture\n"):
        raise RuntimeError("Private D-Bus/keyring fixture coordinates are missing")
    binary = str(root / "vault-smoke")
    daemon = start_daemon(root, env, 1)
    try:
        run([binary, "write"], env=env)
        # A fresh daemon and fresh client must recover the default collection.
        stop_daemon(daemon)
        daemon = start_daemon(root, env, 2)
        run([binary, "read"], env=env)
        keyring_files = list((root / "data" / "keyrings").glob("*.keyring"))
        if not keyring_files or any(b"fixture-\xc3\xa9\xe7\xa7\x98\xe5\xaf\x86\0end" in file.read_bytes()
                                    for file in keyring_files):
            raise RuntimeError("Fixture keyring persistence was absent or contained a plaintext secret")
        if swift_tests:
            env["XLOG_TEST_NATIVE_VAULT"] = "1"
            swift_command = ["swift", "test"]
            if swift_scratch_path is not None:
                swift_command.extend(["--scratch-path", str(swift_scratch_path)])
            swift_command.extend(["--skip-build", "--filter", "NativeCredentialStoreTests"])
            run(swift_command, env=env, timeout=120)
        run([binary, "lock"], env=env)
        # Observe only these two method names on the disposable bus. Neither
        # filter collects any stored secret bytes or searches a user's vault.
        monitor = subprocess.Popen([
            "dbus-monitor", "--session",
            "type='method_call',interface='org.freedesktop.Secret.Service',member='Unlock'",
            "type='method_call',interface='org.freedesktop.Secret.Prompt',member='Prompt'",
        ], cwd=REPO, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            time.sleep(0.1)  # Let the private monitor install its match rules.
            if monitor.poll() is not None:
                raise RuntimeError("Disposable D-Bus method monitor exited")
            run([binary, "locked"], env=env, timeout=3)
            time.sleep(0.1)
        finally:
            monitor.terminate()
            output, _ = monitor.communicate(timeout=5)
        if b"member=Unlock" in output or b"member=Prompt" in output:
            raise RuntimeError("Background vault read requested an unlock or prompt")
        run(["gnome-keyring-daemon", "--unlock", "--components=secrets"],
            env=env, input=PASSWORD, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        run([binary, "delete"], env=env)
        unavailable_env = dict(env, DBUS_SESSION_BUS_ADDRESS="unix:path=" + str(root / "absent-bus"))
        run([binary, "unavailable"], env=unavailable_env)
    finally:
        stop_daemon(daemon)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--swift-tests", action="store_true")
    parser.add_argument("--swift-scratch-path", type=Path,
                        help="Existing Swift build directory; relative paths use the repository root")
    parser.add_argument("--session", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.swift_scratch_path is not None and not args.swift_tests:
        parser.error("--swift-scratch-path requires --swift-tests")
    if sys.platform != "linux":
        parser.error("This native fixture requires Linux; no vault was accessed")
    if args.session:
        isolated_session(args.session.resolve(), args.swift_tests, args.swift_scratch_path)
        return
    for executable in ["cc", "pkg-config", "dbus-run-session", "dbus-send", "dbus-monitor", "gnome-keyring-daemon"]:
        if not shutil.which(executable):
            parser.error("Missing Linux fixture dependency: " + executable)
    root = Path(tempfile.mkdtemp(prefix="xlog-linux-vault-"))
    env = os.environ.copy()
    for key in ["GNOME_KEYRING_CONTROL", "DBUS_SESSION_BUS_ADDRESS", "DBUS_STARTER_ADDRESS", "DBUS_STARTER_BUS_TYPE"]:
        env.pop(key, None)
    env["XLOG_TEST_LINUX_VAULT_ROOT"] = str(root)
    for name, directory in [("XDG_DATA_HOME", "data"), ("XDG_CONFIG_HOME", "config"),
                            ("XDG_CACHE_HOME", "cache"), ("XDG_RUNTIME_DIR", "runtime")]:
        path = root / directory
        path.mkdir(mode=0o700)
        env[name] = str(path)
    (root / "fixture-owner").write_text("xlog-linux-vault-fixture\n")
    try:
        flags = run(["pkg-config", "--cflags", "--libs", "libsecret-1"], env=env,
                    stdout=subprocess.PIPE, text=True).stdout
        run(["cc", "-std=c11", "-Wall", "-Wextra", "-Werror",
             "-I" + str(REPO / "Sources/CPlatformVault/include"),
             str(REPO / "Sources/CPlatformVault/PlatformVault.c"),
             str(REPO / "Tests/CPlatformVaultTests/SecretServiceSmoke.c"),
             "-o", str(root / "vault-smoke"), *shlex.split(flags)], env=env)
        command = ["dbus-run-session", "--", sys.executable, str(Path(__file__).resolve()),
                   "--session", str(root)]
        if args.swift_tests:
            command.append("--swift-tests")
        if args.swift_scratch_path is not None:
            command.extend(["--swift-scratch-path", str(args.swift_scratch_path)])
        run(command, env=env, timeout=180 if args.swift_tests else 90)
    except BaseException:
        print("Linux vault fixture evidence retained at " + str(root), file=sys.stderr)
        raise
    else:
        shutil.rmtree(root)  # Contains only this invocation's synthetic fixture.
        print("Linux Secret Service vault: persistence, exact identities, bytes, lock/no-prompt, failure and deletion passed")


if __name__ == "__main__":
    main()
