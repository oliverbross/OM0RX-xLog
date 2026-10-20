import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const binary = process.env.XLOG_WORKER_BINARY || process.argv[2];
assert.ok(binary, "Pass the built xlog-prototype-worker executable path.");

function exercise(start, onLine, expectedCount, args = [], executable = binary) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    let stderr = "";
    const responses = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Worker response timed out while stdin remained open."));
    }, 5000);
    child.on("error", reject);
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.stdout.on("data", chunk => {
      try {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          assert.ok(Buffer.byteLength(line) + 1 <= 1048576, "Response exceeds its limit.");
          responses.push(JSON.parse(line));
          buffer = buffer.slice(newline + 1);
          onLine(child, responses);
          if (responses.length === expectedCount) child.stdin.end();
        }
        assert.ok(Buffer.byteLength(buffer) <= 1048576, "Unframed stdout exceeds its limit.");
      } catch (error) { child.kill(); clearTimeout(timer); reject(error); }
    });
    child.on("close", code => {
      clearTimeout(timer);
      try {
        assert.equal(code, 0);
        assert.equal(stderr, "");
        assert.equal(buffer, "");
        assert.equal(responses.length, expectedCount);
        resolve(responses);
      } catch (error) { reject(error); }
    });
    start(child);
  });
}

test("NDJSON responds with stdin open, preserves correlation and accepts fragments", async () => {
  const responses = await exercise(child => {
    child.stdin.write(JSON.stringify({ id: "one", method: "health", params: {} }) + "\n");
  }, (child, responses) => {
    if (responses.length === 1) {
      const second = JSON.stringify({ id: "two", method: "parse_adif", params: { text: "<CALL:5>TEST1<EOR>" } }) + "\n";
      child.stdin.write(second.slice(0, 17));
      child.stdin.write(second.slice(17));
      child.stdin.write(JSON.stringify({ id: "three", method: "self_test", params: {} }) + "\n");
    }
  }, 3);
  assert.deepEqual(new Set(responses.map(response => response.id)), new Set(["one", "two", "three"]));
  assert.ok(responses.every(response => response.ok));
  assert.equal(responses.find(response => response.id === "three").result.network_contact, false);
});

test("NDJSON rejects malformed and oversized lines then recovers", async () => {
  const responses = await exercise(child => {
    child.stdin.write("bad JSON\n" + "x".repeat(32769) + "\n");
    child.stdin.write(JSON.stringify({ id: "recovered", method: "health", params: {} }) + "\n");
  }, () => {}, 3);
  assert.deepEqual(new Set(responses.filter(response => !response.ok).map(response => response.error.code)),
    new Set(["invalid_request", "request_too_large"]));
  assert.equal(responses.find(response => response.id === "recovered").ok, true);
});

test("P2 core integration methods run through the real bounded worker process", async () => {
  const responses = await exercise(child => {
    child.stdin.write(JSON.stringify({ id: "contracts", method: "integration_self_test", params: {} }) + "\n");
    child.stdin.write(JSON.stringify({ id: "cluster", method: "cluster_classify", params: {
      history_scope: "synthetic_session", contacts: [],
      spots: [{ id: "s1", line: "DX de DEMO1: 14240.0 W1AW SSB", adif: 291 }],
    } }) + "\n");
  }, () => {}, 2);
  assert.ok(responses.every(response => response.ok));
  const byID = Object.fromEntries(responses.map(response => [response.id, response]));
  assert.equal(byID.contracts.result.passed, true);
  assert.equal(byID.contracts.result.station_io, false);
  assert.equal(byID.cluster.result.spots[0].call_status, "New Callsign");
  assert.equal(byID.cluster.result.spots[0].dxcc_status, "New DXCC");
});

test("concurrent worker requests have unique correlated replies under a burst", async () => {
  const count = 12;
  const responses = await exercise(child => {
    for (let index = 0; index < count; index++) {
      child.stdin.write(JSON.stringify({ id: `burst-${index}`, method: "health", params: {} }) + "\n");
    }
  }, () => {}, count);
  assert.deepEqual(new Set(responses.map(response => response.id)),
    new Set(Array.from({ length: count }, (_, index) => `burst-${index}`)));
  assert.ok(responses.every(response => response.ok));
});

test("local UI acceptance uses a real isolated workspace and refuses external services", async () => {
  const requests = [
    ["health", {}], ["workspace_create", { mode: "empty" }], ["logbook_list", {}],
    ["station_connect", {}], ["backup_import", {}],
  ];
  const send = (child, index) => {
    const [method, params] = requests[index];
    child.stdin.write(JSON.stringify({ id: `isolated-${index}`, method, params }) + "\n");
  };
  const replies = await exercise(child => send(child, 0), (child, responses) => {
    if (responses.length < requests.length) send(child, responses.length);
  }, requests.length, ["--local-ui-acceptance"]);
  assert.equal(replies[0].result.mode, "isolated_local_acceptance");
  assert.equal(replies[0].result.isolated_workspace, true);
  assert.equal(replies[0].result.platform_services, false);
  assert.equal(replies[1].ok, true);
  assert.equal(replies[2].result.total, 0);
  for (const reply of replies.slice(3)) {
    assert.equal(reply.ok, false);
    assert.equal(reply.error.code, "acceptance_restricted");
  }
});

test("Contesting Test profile composes with isolated local UI acceptance", { skip: process.platform !== "darwin" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "xlog-contesting-worker-"));
  try {
    const contents = join(root, "Test.app", "Contents");
    const executable = join(contents, "MacOS", "xlog-prototype-worker");
    await mkdir(join(contents, "MacOS"), { recursive: true });
    await writeFile(join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.oliverbross.xlog.contesting-test</string></dict></plist>\n`);
    await symlink(resolve(binary), executable);
    const requests = [["health", {}], ["station_connect", {}]];
    const send = (child, index) => {
      const [method, params] = requests[index];
      child.stdin.write(JSON.stringify({ id: `combined-${index}`, method, params }) + "\n");
    };
    const replies = await exercise(child => send(child, 0), (child, responses) => {
      if (responses.length < requests.length) send(child, responses.length);
    }, requests.length, ["--runtime-profile=contesting-test", "--local-ui-acceptance"], executable);
    assert.equal(replies[0].result.mode, "isolated_local_acceptance");
    assert.equal(replies[0].result.isolated_workspace, true);
    assert.equal(replies[0].result.station_io, false);
    assert.equal(replies[1].ok, false);
    assert.equal(replies[1].error.code, "acceptance_restricted");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
