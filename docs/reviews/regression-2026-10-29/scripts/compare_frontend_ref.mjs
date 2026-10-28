import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const root='/Users/oliver/Documents/Projects/OM0RX-xLog', prototype=resolve(root,'prototype');
const scratch='/tmp/xlog-phase4-20261029-26f795cb', ref=process.argv[2];
assert(ref && /^[0-9a-f]{7,40}$/.test(ref));
const commit=execFileSync('git',['rev-parse',`${ref}^{commit}`],{cwd:root,encoding:'utf8'}).trim();
const changed=execFileSync('git',['diff','--name-only',commit,'HEAD','--','prototype/src'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean);
const overrides=new Map(), hits=new Set();
for(const name of changed) {
  if(!/\.(ts|tsx|css|json)$/.test(name)||name.includes('.test.'))continue;
  const exists=execFileSync('git',['ls-tree','--name-only',commit,'--',name],{cwd:root,encoding:'utf8'}).trim();
  assert(exists,`Production source absent at baseline: ${name}`);
  overrides.set(resolve(root,name),execFileSync('git',['show',`${commit}:${name}`],{cwd:root,encoding:'utf8'}));
}
const require=createRequire(resolve(prototype,'package.json'));
const {build}=await import(pathToFileURL(require.resolve('vite')).href);
const directory=resolve(scratch,`frontend-ref-${ref}`);
const baselinePlugin={name:'phase4-git-blob-baseline',enforce:'pre',load(id){const path=id.split('?')[0];if(overrides.has(path)){hits.add(path);return overrides.get(path);}}};
await build({root:prototype,configFile:resolve(prototype,'vite.config.ts'),plugins:[baselinePlugin],build:{outDir:directory,emptyOutDir:false}});
const checkSource=readFileSync(resolve(prototype,'scripts/check-window-bundles.mjs'),'utf8');
const receipt={ref:commit,method:'Read-only Vite pre-load overrides from git blobs for every changed production frontend file; canonical source files and budgets are unchanged.',
  overrides:[...overrides].map(([path,source])=>({path,loaded:hits.has(path),sha256:createHash('sha256').update(source).digest('hex')})),
  originalCheckerSHA256:createHash('sha256').update(checkSource).digest('hex'),outDir:directory};
const check=checkSource.replace('const dist = fileURLToPath(new URL("../dist/", import.meta.url));',`const dist = ${JSON.stringify(directory)};`);
assert.notEqual(check,checkSource);
writeFileSync(resolve(scratch,`check-ref-${ref}.mjs`),check);
try {await import('data:text/javascript;base64,'+Buffer.from(check).toString('base64'));receipt.gate='PASS';}
catch(error){receipt.gate='FAIL';receipt.error=String(error);process.exitCode=1;}
writeFileSync(resolve(scratch,`frontend-ref-${ref}.json`),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt));
