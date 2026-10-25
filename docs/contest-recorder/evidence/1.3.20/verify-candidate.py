#!/usr/bin/env python3
"""Verify an already signed candidate; fixtures never open devices or production data."""
import argparse,hashlib,json,plistlib,subprocess,time
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument("--bundle",required=True);p.add_argument("--source",required=True);p.add_argument("--output",required=True);a=p.parse_args()
bundle=Path(a.bundle).resolve();out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
def run(args,timeout=120):
    r=subprocess.run([str(v) for v in args],capture_output=True,text=True,timeout=timeout)
    if r.returncode:raise RuntimeError(f"{args[0]} failed: {r.stderr[-2000:]} {r.stdout[-2000:]}")
    return r.stdout,r.stderr
info=plistlib.loads((bundle/"Contents/Info.plist").read_bytes())
assert info["CFBundleShortVersionString"]=="1.3.20"
assert "operator-selected contest audio input" in info["NSMicrophoneUsageDescription"]
exe=bundle/"Contents/MacOS/xlog-prototype"
verified=run(["codesign","--verify","--deep","--strict","--verbose=2",bundle])
signature=run(["codesign","-dvvv",bundle])[1]
assert "Developer ID Application: Oliver Bross" in signature and "runtime" in signature
entitlements=plistlib.loads(run(["codesign","-d","--entitlements",":-",bundle])[0].encode())
assert entitlements=={"com.apple.security.device.audio-input":True},entitlements
metadata=json.loads((bundle/"Contents/Resources/DistributionMetadata/components.json").read_text())
assert metadata["sourceCommit"]==a.source
python_receipt=json.loads((bundle/"Contents/Resources/Not1MM/python-runtime.json").read_text())
assert python_receipt["sourceCommit"]==a.source and python_receipt["sourceChanges"]==[]
began=time.monotonic();fixture=json.loads(run([exe,"--recorder-acceptance"])[0])
assert fixture["ok"] and fixture["sourceCommit"]==a.source and fixture["version"]=="1.3.20",fixture
assert all(v is True for v in fixture["checks"].values()),fixture
assert not fixture["captureOpened"] and not fixture["outputOpened"] and not fixture["productionDataOpened"]
(out/"native-fixture.json").write_text(json.dumps(fixture,indent=2)+"\n")
devices=json.loads(run([exe,"--recorder-audio-devices"],30)[0])
(out/"devices-readonly.json").write_text(json.dumps(devices,indent=2)+"\n")
files={}
for name,relative in {"executable":"Contents/MacOS/xlog-prototype","worker":"Contents/MacOS/xlog-prototype-worker","info":"Contents/Info.plist","pythonReceipt":"Contents/Resources/Not1MM/python-runtime.json","distributionReceipt":"Contents/Resources/DistributionMetadata/components.json","python":"Contents/Frameworks/Python.framework/Versions/3.12/bin/python3.12"}.items():
    file=bundle/relative;files[name]={"path":str(file),"sha256":hashlib.sha256(file.read_bytes()).hexdigest()}
receipt={"version":"1.3.20","sourceCommit":a.source,"bundle":str(bundle),"signatureIdentity":signature,"signatureVerification":"".join(verified),"entitlements":entitlements,"microphonePurpose":info["NSMicrophoneUsageDescription"],"files":files,"fixtureChecks":fixture["checks"],"fixtureElapsedMs":fixture["elapsedMs"],"verificationElapsedSeconds":round(time.monotonic()-began,3),"captureOpened":False,"outputOpened":False,"productionDataOpened":False,"installed":False,"physicalAcceptance":"NOT READY: audio disconnected; signed-app TCC, physical route and real-time soak pending","notarization":"Not claimed"}
(out/"candidate-receipt.json").write_text(json.dumps(receipt,indent=2)+"\n")
print(json.dumps({"ok":True,"version":receipt["version"],"sourceCommit":a.source,"checks":len(fixture["checks"]),"bundle":str(bundle),"receipt":str(out/"candidate-receipt.json")}))
