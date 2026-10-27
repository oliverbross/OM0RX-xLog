#!/usr/bin/env python3
"""Export a finite current-Python developer example, never install a definition."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'python'))
from contest_host.developer import TEMPLATES, describe, inspect_udc
from contest_host.upstream import VENDOR


def canonical(value):
    return (json.dumps(value,indent=2,sort_keys=True,ensure_ascii=False)+'\n').encode()


def build(output, plugin_id=None, udc=None):
    output=Path(output)
    if output.exists():raise ValueError('Choose a new output directory; existing developer evidence is never overwritten')
    if plugin_id is not None:
        profile=describe(plugin_id)
        source=ROOT/'python/contest_host/wae.py' if plugin_id.startswith('wae_') else VENDOR/f'not1mm/plugins/{plugin_id}.py'
        payloads={'profile.json':canonical(profile),'example.py':source.read_bytes(),'LICENSE.not1mm':(VENDOR.parent/'LICENSE').read_bytes(),
                  'README.txt':b'Current Python/Desk example only. Replace identities, official rule sources, participant/category evidence and independent fixtures. Review the current PLUGIN_REGISTRY and finite upstream loader deliberately. Run the existing lifecycle checker. Do not copy generated artifacts into a live worker or execute downloaded Python. Existing sessions pin their engine/reference context; definition changes do not authorize completed-log rescoring. General UDC conversion remains deferred.\n'}
        status='reference-scaffold-not-new-reviewed-definition'
        code=0
    else:
        path=Path(udc)
        if path.is_symlink() or not path.is_file() or path.stat().st_size>65536:raise ValueError('Use one regular UDC file of at most 64 KiB')
        raw=path.read_bytes();profile=inspect_udc(raw)
        payloads={'original.udc':raw,'diagnostics.json':canonical(profile)}
        status='conversion-rejected-original-retained';code=2
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    dirty=bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip())
    manifest={'schemaVersion':1,'kitVersion':'1.0.0','sourceGitCommit':commit,'sourceWorkingTreeDirty':dirty,'status':status,'installed':False,
              'files':{name:{'sha256':hashlib.sha256(raw).hexdigest(),'byteLength':len(raw)} for name,raw in sorted(payloads.items())}}
    output.mkdir(parents=True)
    for name,raw in payloads.items():(output/name).write_bytes(raw)
    (output/'manifest.json').write_bytes(canonical(manifest))
    return code,manifest


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--plugin',choices=TEMPLATES);group.add_argument('--inspect-udc',type=Path)
    parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args()
    try:
        code,manifest=build(args.output,args.plugin,args.inspect_udc)
    except (ValueError,OSError) as error:
        parser.error(str(error))
    print(json.dumps(manifest,indent=2));return code


if __name__=='__main__':raise SystemExit(main())
