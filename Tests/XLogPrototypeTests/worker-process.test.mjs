import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const runFile = promisify(execFile);

const binary = process.env.XLOG_WORKER_BINARY || process.argv[2];
assert.ok(binary, "Pass the built xlog-prototype-worker executable path.");

async function exercise(start, onLine, expectedCount, args = [], executable = binary,
                        { prepareHome = async () => {}, afterExit = async () => {}, expectedExitCode = 0,
                          wrapContestingBundle = true, operatingModule = "contesting", timeoutMilliseconds = 5000 } = {}) {
  const home = await mkdtemp(join(tmpdir(), "xlog-worker-home-"));
  try {
    await prepareHome(home);
    if (wrapContestingBundle && process.platform === "darwin" && !args.includes("--runtime-profile=contesting-test")) {
      const contents = join(home, "Test.app", "Contents");
      await mkdir(join(contents, "MacOS"), { recursive: true });
      await writeFile(join(contents, "Info.plist"), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.oliverbross.xlog.contesting-test</string></dict></plist>`);
      const isolatedExecutable = join(contents, "MacOS", "xlog-prototype-worker");
      await symlink(resolve(executable), isolatedExecutable);
      executable = isolatedExecutable;
      args = ["--runtime-profile=contesting-test", ...args];
    }
  return await new Promise((resolve, reject) => {
    // These are protocol/framing checks. Keep the real worker in the
    // contesting module so unrelated normal-log background providers do not
    // acquire shared application-support ownership during a disposable run.
    const child = spawn(executable, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, XLOG_OPERATING_MODULE: operatingModule, HOME: home, CFFIXED_USER_HOME: home },
    });
    let buffer = "";
    let stderr = "";
    const responses = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Worker response timed out while stdin remained open."));
    }, timeoutMilliseconds);
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
    child.on("close", async (code, signal) => {
      clearTimeout(timer);
      try {
        assert.equal(signal, null, `Worker terminated by ${signal}; stderr: ${stderr}`);
        assert.equal(code, expectedExitCode, stderr || "Worker exited unsuccessfully without diagnostics.");
        assert.equal(stderr, expectedExitCode === 0 ? "" : "Background delivery retirement failed.\n");
        assert.equal(buffer, "");
        assert.equal(responses.length, expectedCount);
        await afterExit(home);
        resolve(responses);
      } catch (error) { reject(error); }
    });
    start(child);
  });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test("accepted work drains after EOF through the real retirement path", async () => {
  const responses = await exercise(child => {
    for (const id of ["accepted-one", "accepted-two"]) {
      child.stdin.write(JSON.stringify({ id, method: "health", params: {} }) + "\n");
    }
    child.stdin.end();
  }, () => {}, 2);
  assert.deepEqual(new Set(responses.map(response => response.id)), new Set(["accepted-one", "accepted-two"]));
  assert.ok(responses.every(response => response.ok));
});

test("Contesting Test EOF leaves production-style spot receipts untouched", { skip: process.platform !== "darwin" }, async () => {
  for (const age of [0, 1200]) {
    let legacyBytes;
    const replies = await exercise(child => {
      child.stdin.write(JSON.stringify({ id: "retained-spot", method: "health", params: {} }) + "\n");
      child.stdin.end();
    }, () => {}, 1, [], binary, {
      prepareHome: async home => {
        const services = join(home, "Library", "Application Support", "OM0RX-xLog Integration Services");
        await mkdir(services, { recursive: true });
        legacyBytes = Buffer.from(JSON.stringify({ version: 1, spots: [{
          provider: "direct_agent", radioID: "radio1", callsign: "TEST1", frequencyHz: 7125000,
          owner: "contesting", acceptedAt: Date.now() / 1000 - age,
        }] }));
        await writeFile(join(services, "forwarded-radio-spots.json"), legacyBytes);
      },
      afterExit: async home => {
        const services = join(home, "Library", "Application Support", "OM0RX-xLog Integration Services");
        assert.deepEqual(await readFile(join(services, "forwarded-radio-spots.json")), legacyBytes);
        assert.deepEqual(await readdir(services), ["forwarded-radio-spots.json"], "Private EOF must not open or migrate a production-style ledger.");
      },
    });
    assert.equal(replies[0].ok, true);
  }
});

test("marked offline candidate EOF preserves the fake HOME production ledger byte for byte", { skip: process.platform !== "darwin" }, async () => {
  for (const operatingModule of ["normal_logging", "contesting"]) {
    const privateRoot = await mkdtemp(join(await realpath(tmpdir()), "xlog-wave1-"));
    try {
      await chmod(privateRoot, 0o700);
      await writeFile(join(privateRoot, ".xlog-offline-acceptance.json"), JSON.stringify({ schema: 1, id: randomUUID() }));
      const contents = join(privateRoot, "Candidate.app", "Contents");
      const executable = join(contents, "MacOS", "xlog-prototype-worker");
      await mkdir(join(contents, "MacOS"), { recursive: true });
      await writeFile(join(contents, "Info.plist"), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.oliverbross.xlog.integration</string></dict></plist>');
      await symlink(resolve(binary), executable);
      let before, names;
      const replies = await exercise(child => {
        child.stdin.write(JSON.stringify({ id: "offline-eof", method: "health", params: {} }) + "\n");
        child.stdin.end();
      }, () => {}, 1, ["--offline-contest-acceptance=" + privateRoot], executable, {
        wrapContestingBundle: false, operatingModule, timeoutMilliseconds: 15000,
        prepareHome: async home => {
          const services = join(home, "Library", "Application Support", "OM0RX-xLog Integration Services");
          await mkdir(services, { recursive: true });
          const inventory = join(services, "forwarded-radio-spots.json.sqlite");
          await writeFile(join(services, "forwarded-radio-spots.json"), JSON.stringify({ version: 1, spots: [] }));
          const sql = "PRAGMA journal_mode=DELETE; CREATE TABLE pending_deliveries(key TEXT PRIMARY KEY,payload BLOB NOT NULL);" +
            "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<256) " +
            "INSERT INTO pending_deliveries SELECT printf('00000000-0000-4000-8000-%012d',x), " +
            "CAST(json_object('id',printf('00000000-0000-4000-8000-%012d',x),'provider','direct_agent'," +
            "'callsign','TEST'||x,'frequencyHz',7125000,'owner',CASE WHEN x<=189 THEN 'contesting' ELSE 'normal_logging' END) AS BLOB) FROM n;";
          await runFile("/usr/bin/sqlite3", [inventory, sql]);
          before = createHash("sha256").update(await readFile(inventory)).digest("hex");
          names = (await readdir(services)).sort();
        },
        afterExit: async home => {
          const services = join(home, "Library", "Application Support", "OM0RX-xLog Integration Services");
          const inventory = join(services, "forwarded-radio-spots.json.sqlite");
          assert.equal(createHash("sha256").update(await readFile(inventory)).digest("hex"), before, "Offline EOF altered the fake production ledger.");
          assert.deepEqual((await readdir(services)).sort(), names, "Offline EOF created production ledger sidecars or publisher locks.");
          const { stdout } = await runFile("/usr/bin/sqlite3", ["-readonly", inventory, "SELECT count(*) FROM pending_deliveries;"]);
          assert.equal(stdout.trim(), "256");
          await assert.rejects(stat(join(privateRoot, "worker", "OM0RX-xLog Integration Services", "forwarded-radio-spots.json.sqlite")), { code: "ENOENT" });
        },
      });
      assert.equal(replies[0].ok, true);
    } finally { await rm(privateRoot, { recursive: true, force: true }); }
  }
});

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
  assert.equal(byID.cluster.result.spots[0].call_status, "New Call");
  assert.equal(byID.cluster.result.spots[0].dxcc_status, "ATNO");
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
