import { execFileSync, spawn } from "node:child_process";

export class BoundedChildError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = "BoundedChildError"; this.code = code; Object.assign(this, details); }
}

function processGroupPIDs(pgid) {
  try {
    return execFileSync("/bin/ps", ["-axo", "pid=,pgid="], { encoding: "utf8" }).trim().split("\n").map(row => row.trim().split(/\s+/).map(Number))
      .filter(([, group]) => group === pgid).map(([pid]) => pid).sort((a, b) => a - b);
  } catch { return []; }
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error?.code === "ESRCH") return false; throw error; } };
async function waitGone(pids, timeoutMs = 2_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() <= until) { const remaining = pids.filter(alive); if (!remaining.length) return []; await new Promise(resolve => setTimeout(resolve, 25)); }
  return pids.filter(alive);
}

export function runBoundedChild(command, args, { cwd, env, timeoutMs = 20_000, startupTimeoutMs = timeoutMs,
  readinessSignal, terminateGraceMs = 1_000, outputLimit = 1_000_000, processGroup = false } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(command, args, { cwd, env, detached: processGroup, stdio: ["ignore", "pipe", "pipe"] }); }
    catch (cause) { reject(new BoundedChildError("spawn_failed", `Could not spawn ${command}.`, { cause })); return; }
    let stdout = "", stderr = "", stdoutTruncated = false, stderrTruncated = false, timedOut = false, settled = false,
      killTimer, deadline, ownedPIDs = [], readinessObserved = readinessSignal === undefined;
    const append = (current, chunk, markTruncated) => {
      const remaining = Math.max(0, outputLimit - Buffer.byteLength(current));
      if (chunk.length > remaining) markTruncated();
      return current + chunk.subarray(0, remaining).toString();
    };
    const signal = value => { try { process.kill(processGroup ? -child.pid : child.pid, value); } catch (error) { if (error?.code !== "ESRCH") throw error; } };
    const expire = () => {
      timedOut = true;
      ownedPIDs = processGroup ? processGroupPIDs(child.pid) : [child.pid];
      signal("SIGTERM");
      killTimer = setTimeout(() => { if (processGroup || child.exitCode === null && child.signalCode === null) signal("SIGKILL"); }, terminateGraceMs);
    };
    const armDeadline = duration => { clearTimeout(deadline); deadline = setTimeout(expire, duration); };
    const observeReadiness = () => {
      if (timedOut || settled) return;
      if (!readinessObserved && (stdout.includes(readinessSignal) || stderr.includes(readinessSignal))) {
        readinessObserved = true;
        armDeadline(timeoutMs);
      }
    };
    child.stdout.on("data", chunk => { stdout = append(stdout, chunk, () => { stdoutTruncated = true; }); observeReadiness(); });
    child.stderr.on("data", chunk => { stderr = append(stderr, chunk, () => { stderrTruncated = true; }); observeReadiness(); });
    armDeadline(readinessObserved ? timeoutMs : startupTimeoutMs);
    const finish = (callback, clearKill = true) => (...values) => {
      if (settled) return; settled = true; clearTimeout(deadline); if (clearKill) clearTimeout(killTimer); callback(...values);
    };
    child.once("error", finish(cause => reject(new BoundedChildError("spawn_failed", `Could not run ${command}.`, { cause, pid: child.pid }))));
    child.once("close", async (code, closeSignal) => {
      if (settled) return;
      if (!timedOut) {
        const lingeringPIDs = processGroup ? processGroupPIDs(child.pid) : [];
        if (lingeringPIDs.length) {
          signal("SIGKILL");
          await waitGone(lingeringPIDs);
        }
        const result = { pid: child.pid, childExitCode: code, signal: closeSignal, stdout, stderr, stdoutTruncated, stderrTruncated,
          processGroup, readinessObserved, lingeringPIDs };
        finish(value => code !== 0 ? reject(new BoundedChildError("child_failed", `${command} failed (${code ?? closeSignal}).`, value))
          : lingeringPIDs.length ? reject(new BoundedChildError("process_group_leaked", `${command} exited while owned descendants were still running.`, value))
            : resolve(value))(result);
        return;
      }
      if (processGroup) await new Promise(resolveDelay => setTimeout(resolveDelay, terminateGraceMs + 25));
      const lingeringPIDs = await waitGone(ownedPIDs);
      const result = { pid: child.pid, childExitCode: code, signal: closeSignal, stdout, stderr, stdoutTruncated, stderrTruncated,
        processGroup, readinessObserved, ownedPIDs, lingeringPIDs };
      finish(value => reject(new BoundedChildError("deadline_exceeded", `${command} exceeded ${timeoutMs} ms and its owned process group was reaped.`, value)))(result);
    });
  });
}
