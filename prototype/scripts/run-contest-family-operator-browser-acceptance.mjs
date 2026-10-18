#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runBoundedChild } from "./bounded-child-process.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../.."),option=name=>{const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw new Error(`Missing ${name}.`);return process.argv[i+1];};
const expectedHead=option("--expected-head"),output=resolve(option("--output")),scratch=resolve(option("--scratch-path")),scenario=process.argv.includes("--scenario")?option("--scenario"):"family",sha256=bytes=>createHash("sha256").update(bytes).digest("hex");
assert.ok(["family","declarative"].includes(scenario),"Scenario must be family or declarative.");
function sourceState(){const head=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim(),status=execFileSync("git",["status","--porcelain=v1","--untracked-files=all"],{cwd:root,encoding:"utf8"}).trim().split("\n").filter(Boolean);const untracked=Object.fromEntries(status.filter(row=>row.startsWith("?? ")).map(row=>row.slice(3)).filter(path=>existsSync(join(root,path))&&statSync(join(root,path)).isFile()).sort().map(path=>[path,sha256(readFileSync(join(root,path)))]));return{head,status,trackedDiffSHA256:sha256(execFileSync("git",["diff","--binary","HEAD","--"],{cwd:root})),untracked};}
const sourceBefore=sourceState();assert.equal(sourceBefore.head,expectedHead);assert.equal(existsSync(output),false);
const env={...process.env,XLOG_PORTABLE_ONLY:"1"};const build=await runBoundedChild("swift",["test","list","--jobs","2","--scratch-path",scratch],{cwd:root,env,timeoutMs:900_000,terminateGraceMs:2_000,processGroup:true,outputLimit:4_000_000});
const bundle=join(scratch,"out/Products/Debug/XLogPrototypeTests.xctest"),host=join(bundle,"Contents/MacOS/XLogPrototypeTests"),xctest="/Applications/Xcode.app/Contents/Developer/usr/bin/xctest",selector="XLogPrototypeTests.ContestOperatorBrowserAcceptanceTests/testRealWorkspaceAndMutationOwnerAgainstIsolatedLiveWorker";assert.ok(existsSync(host));
const base={...env,XLOG_RUN_CONTEST_OPERATOR_BROWSER_ACCEPTANCE:"1",XLOG_OPERATOR_ACCEPTANCE_SCENARIO:scenario,XLOG_OPERATOR_ACCEPTANCE_SOURCE_HEAD:expectedHead,XLOG_OPERATOR_ACCEPTANCE_OUTER_GUARD:"owned-process-group-v1"};
function persistProbeFailure(mode,error,validationError){
  try{
    const evidenceRoot=join(output,"evidence");mkdirSync(evidenceRoot,{recursive:true});
    const stdout=Buffer.from(error.stdout??""),stderr=Buffer.from(error.stderr??"");
    writeFileSync(join(evidenceRoot,`probe-${mode}-failure.stdout.log`),stdout,{flag:"wx"});
    writeFileSync(join(evidenceRoot,`probe-${mode}-failure.stderr.log`),stderr,{flag:"wx"});
    writeFileSync(join(evidenceRoot,"preflight-failure.json"),`${JSON.stringify({schemaVersion:1,ok:false,expectedHead,scenario,
      source:sourceBefore,testHost:{path:host,sha256:sha256(readFileSync(host))},selector,probe:{mode,code:error.code,
        readinessObserved:error.readinessObserved??false,ownedPIDs:error.ownedPIDs??[],lingeringPIDs:error.lingeringPIDs??[],
        stdoutSHA256:sha256(stdout),stderrSHA256:sha256(stderr)},failure:String(validationError.stack??validationError)},null,2)}\n`,{flag:"wx"});
  }catch(receiptError){process.stderr.write(`Could not persist probe failure without replacing the original error: ${String(receiptError)}\n`);}
}
async function probe(mode){
  try{
    await runBoundedChild(xctest,["-XCTest",selector,bundle],{cwd:root,
      env:{...base,XLOG_OPERATOR_ACCEPTANCE_OUTPUT:`${output}-probe-${mode}`,XLOG_OPERATOR_ACCEPTANCE_STALL:mode},
      startupTimeoutMs:30_000,readinessSignal:`XLOG_ACCEPTANCE_STALL_READY:${mode}`,timeoutMs:3_000,
      terminateGraceMs:500,processGroup:true,outputLimit:1_000_000});
    assert.fail("stall completed");
  }catch(error){
    try{
      assert.equal(error.code,"deadline_exceeded");
      assert.equal(error.readinessObserved,true,`${mode} probe did not reach its injected stall.`);
      assert.ok(error.ownedPIDs.length>=2,`${mode} probe did not include the host and Node descendant: ${JSON.stringify(error.ownedPIDs)}`);
      assert.deepEqual(error.lingeringPIDs,[]);
    }catch(validationError){persistProbeFailure(mode,error,validationError);throw validationError;}
    return{mode,readinessObserved:error.readinessObserved,ownedPIDs:error.ownedPIDs,lingeringPIDs:error.lingeringPIDs,stdout:error.stdout,stderr:error.stderr};
  }
}
const rawProbes=[await probe("response"),await probe("shutdown")];const run=await runBoundedChild(xctest,["-XCTest",selector,bundle],{cwd:root,env:{...base,XLOG_OPERATOR_ACCEPTANCE_OUTPUT:output},timeoutMs:1_020_000,terminateGraceMs:2_000,processGroup:true,outputLimit:4_000_000});
const acceptancePath=join(output,"evidence/acceptance.json"),acceptance=JSON.parse(readFileSync(acceptancePath,"utf8"));assert.equal(acceptance.schemaVersion,3);assert.equal(acceptance.ok,true);assert.equal(acceptance.source.actualHead,expectedHead);assert.deepEqual({runtimeProfile:acceptance.testHost.isolation.runtimeProfile,inheritNativePreferences:acceptance.testHost.isolation.inheritNativePreferences,stationIO:acceptance.testHost.isolation.stationIO},{runtimeProfile:"contestingTest",inheritNativePreferences:false,stationIO:false});assert.deepEqual(acceptance.openFileAudits.map(audit=>audit.phase),["after-workspace-create","after-first-contest-session","before-owned-shutdown"]);for(const [index,audit] of acceptance.openFileAudits.entries()){assert.equal(audit.testHostPID,acceptance.testHost.pid);assert.equal(audit.isolatedRoot,acceptance.testHost.isolation.supportRoot);assert.ok(audit.workspaceDatabases.some(path=>basename(path)==="OM0RX-xLog.sqlite"));if(index>0)assert.ok(audit.contestDatabases.some(path=>basename(path)==="contests.sqlite"));assert.equal(audit.databases.every(path=>path===audit.isolatedRoot||path.startsWith(`${audit.isolatedRoot}${sep}`)),true);}assert.equal(acceptance.protectedDatabaseMetadataObservation,acceptance.protectedDatabaseMetadataUnchanged?"unchanged":"changed; process attribution unknown; bounded test-host checks observed no protected paths");const sourceAfter=sourceState();assert.deepEqual(sourceAfter,sourceBefore);
const evidenceRoot=join(output,"evidence");mkdirSync(evidenceRoot,{recursive:true});
function persistLog(name,value){const bytes=Buffer.from(value),path=join(evidenceRoot,name);writeFileSync(path,bytes,{flag:"wx"});return{path:`evidence/${name}`,byteLength:bytes.length,sha256:sha256(bytes)};}
const buildLogs={stdout:persistLog("build.stdout.log",build.stdout),stderr:persistLog("build.stderr.log",build.stderr)};
const runLogs={stdout:persistLog("run.stdout.log",run.stdout),stderr:persistLog("run.stderr.log",run.stderr)};
const probes=rawProbes.map(({stdout,stderr,...probe})=>({...probe,stdout:persistLog(`probe-${probe.mode}.stdout.log`,stdout),stderr:persistLog(`probe-${probe.mode}.stderr.log`,stderr)}));
const evidence={schemaVersion:2,ok:true,expectedHead,scenario,command:{xctest,selector,bundle,scratch},source:sourceBefore,build:{code:build.childExitCode,...buildLogs},host:{path:host,sha256:sha256(readFileSync(host))},isolation:{testHostPID:acceptance.testHost.pid,supportRoot:acceptance.testHost.isolation.supportRoot,openFileAudits:acceptance.openFileAudits,boundary:acceptance.boundary},probes,run:{code:run.childExitCode,...runLogs,acceptancePath}};writeFileSync(join(evidenceRoot,"outer-runner.json"),`${JSON.stringify(evidence,null,2)}\n`,{flag:"wx"});process.stdout.write(`${JSON.stringify({ok:true,scenario,evidence:join(evidenceRoot,"outer-runner.json"),probes:probes.length})}\n`);
