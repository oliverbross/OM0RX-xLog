#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBoundedChild } from "./bounded-child-process.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../.."),option=name=>{const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw new Error(`Missing ${name}.`);return process.argv[i+1];};
const expectedHead=option("--expected-head"),output=resolve(option("--output")),scratch=resolve(option("--scratch-path")),sha256=bytes=>createHash("sha256").update(bytes).digest("hex");
function sourceState(){const head=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim(),status=execFileSync("git",["status","--porcelain=v1","--untracked-files=all"],{cwd:root,encoding:"utf8"}).trim().split("\n").filter(Boolean);const untracked=Object.fromEntries(status.filter(row=>row.startsWith("?? ")).map(row=>row.slice(3)).filter(path=>existsSync(join(root,path))&&statSync(join(root,path)).isFile()).sort().map(path=>[path,sha256(readFileSync(join(root,path)))]));return{head,status,trackedDiffSHA256:sha256(execFileSync("git",["diff","--binary","HEAD","--"],{cwd:root})),untracked};}
const sourceBefore=sourceState();assert.equal(sourceBefore.head,expectedHead);assert.equal(existsSync(output),false);
const env={...process.env,XLOG_PORTABLE_ONLY:"1"};const build=await runBoundedChild("swift",["test","list","--jobs","2","--scratch-path",scratch],{cwd:root,env,timeoutMs:900_000,terminateGraceMs:2_000,processGroup:true,outputLimit:4_000_000});
const bundle=join(scratch,"out/Products/Debug/XLogPrototypeTests.xctest"),host=join(bundle,"Contents/MacOS/XLogPrototypeTests"),xctest="/Applications/Xcode.app/Contents/Developer/usr/bin/xctest",selector="XLogPrototypeTests.ContestOperatorBrowserAcceptanceTests/testRealWorkspaceAndMutationOwnerAgainstIsolatedLiveWorker";assert.ok(existsSync(host));
const base={...env,XLOG_RUN_CONTEST_OPERATOR_BROWSER_ACCEPTANCE:"1",XLOG_OPERATOR_ACCEPTANCE_SCENARIO:"family",XLOG_OPERATOR_ACCEPTANCE_SOURCE_HEAD:expectedHead,XLOG_OPERATOR_ACCEPTANCE_OUTER_GUARD:"owned-process-group-v1"};
async function probe(mode){try{await runBoundedChild(xctest,["-XCTest",selector,bundle],{cwd:root,env:{...base,XLOG_OPERATOR_ACCEPTANCE_OUTPUT:`${output}-probe-${mode}`,XLOG_OPERATOR_ACCEPTANCE_STALL:mode},timeoutMs:3_000,terminateGraceMs:500,processGroup:true,outputLimit:1_000_000});assert.fail("stall completed");}catch(error){assert.equal(error.code,"deadline_exceeded");assert.ok(error.ownedPIDs.length>=2);assert.deepEqual(error.lingeringPIDs,[]);return{mode,ownedPIDs:error.ownedPIDs,lingeringPIDs:error.lingeringPIDs,stdout:error.stdout,stderr:error.stderr};}}
const rawProbes=[await probe("response"),await probe("shutdown")];const run=await runBoundedChild(xctest,["-XCTest",selector,bundle],{cwd:root,env:{...base,XLOG_OPERATOR_ACCEPTANCE_OUTPUT:output},timeoutMs:1_020_000,terminateGraceMs:2_000,processGroup:true,outputLimit:4_000_000});
const acceptancePath=join(output,"evidence/acceptance.json"),acceptance=JSON.parse(readFileSync(acceptancePath,"utf8"));assert.equal(acceptance.ok,true);assert.equal(acceptance.source.actualHead,expectedHead);const sourceAfter=sourceState();assert.deepEqual(sourceAfter,sourceBefore);
const evidenceRoot=join(output,"evidence");mkdirSync(evidenceRoot,{recursive:true});
function persistLog(name,value){const bytes=Buffer.from(value),path=join(evidenceRoot,name);writeFileSync(path,bytes,{flag:"wx"});return{path:`evidence/${name}`,byteLength:bytes.length,sha256:sha256(bytes)};}
const buildLogs={stdout:persistLog("build.stdout.log",build.stdout),stderr:persistLog("build.stderr.log",build.stderr)};
const runLogs={stdout:persistLog("run.stdout.log",run.stdout),stderr:persistLog("run.stderr.log",run.stderr)};
const probes=rawProbes.map(({stdout,stderr,...probe})=>({...probe,stdout:persistLog(`probe-${probe.mode}.stdout.log`,stdout),stderr:persistLog(`probe-${probe.mode}.stderr.log`,stderr)}));
const evidence={schemaVersion:1,ok:true,expectedHead,command:{xctest,selector,bundle,scratch},source:sourceBefore,build:{code:build.childExitCode,...buildLogs},host:{path:host,sha256:sha256(readFileSync(host))},probes,run:{code:run.childExitCode,...runLogs,acceptancePath}};writeFileSync(join(evidenceRoot,"outer-runner.json"),`${JSON.stringify(evidence,null,2)}\n`,{flag:"wx"});process.stdout.write(`${JSON.stringify({ok:true,evidence:join(evidenceRoot,"outer-runner.json"),probes:probes.length})}\n`);
