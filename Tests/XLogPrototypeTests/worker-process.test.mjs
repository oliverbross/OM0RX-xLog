import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";

const binary = process.argv[2];
assert.ok(binary, "Pass the built xlog-prototype-worker executable path.");

function exercise(start, onLine, expectedCount) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
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
          assert.ok(Buffer.byteLength(line) + 1 <= 65536, "Response exceeds its limit.");
          responses.push(JSON.parse(line));
          buffer = buffer.slice(newline + 1);
          onLine(child, responses);
          if (responses.length === expectedCount) child.stdin.end();
        }
        assert.ok(Buffer.byteLength(buffer) <= 65536, "Unframed stdout exceeds its limit.");
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
  assert.deepEqual(responses.map(response => response.id), ["one", "two", "three"]);
  assert.ok(responses.every(response => response.ok));
  assert.equal(responses[2].result.network_contact, false);
});

test("NDJSON rejects malformed and oversized lines then recovers", async () => {
  const responses = await exercise(child => {
    child.stdin.write("bad JSON\n" + "x".repeat(32769) + "\n");
    child.stdin.write(JSON.stringify({ id: "recovered", method: "health", params: {} }) + "\n");
  }, () => {}, 3);
  assert.deepEqual(responses.slice(0, 2).map(response => response.error.code), ["invalid_request", "request_too_large"]);
  assert.equal(responses[2].id, "recovered");
  assert.equal(responses[2].ok, true);
});
