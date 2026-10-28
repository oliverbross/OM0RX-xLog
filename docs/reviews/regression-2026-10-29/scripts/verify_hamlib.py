from pathlib import Path
import hashlib,json
root=Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
directory=root/'prototype/src-tauri/binaries'
manifest=directory/'hamlib-4.7.2-aarch64-apple-darwin.sha256'
recipe=directory/'hamlib-4.7.2-aarch64-apple-darwin.recipe'
expected=hashlib.sha256((root/'prototype/scripts/stage-hamlib-macos.sh').read_bytes()).hexdigest()
assert recipe.read_text().strip()==expected, 'Staged recipe differs'
files=[]
for line in manifest.read_text().splitlines():
    digest,name=line.split(maxsplit=1)
    name=name.lstrip('* ')
    path=directory/name
    assert path.resolve().is_relative_to(directory.resolve())
    actual=hashlib.sha256(path.read_bytes()).hexdigest()
    assert digest==actual, name
    files.append({'path':str(path),'sha256':actual})
result={'recipeSHA256':expected,'files':files,'scope':'Pinned local Hamlib helpers; subsequent tests use only model1 on loopback.'}
Path('/tmp/xlog-phase4-20261029-26f795cb/hamlib-provenance.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'filesChecked':len(files),'recipeMatches':True}))
