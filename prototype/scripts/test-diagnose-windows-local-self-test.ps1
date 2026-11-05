#Requires -Version 7.0
# Pure helper/receipt tests and C# compilation. No Win32 API or child is invoked.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$path = Join-Path $PSScriptRoot 'diagnose-windows-local-self-test.ps1'
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
foreach ($function in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $true)) {
    . ([scriptblock]::Create($function.Extent.Text))
}
$checks = [Collections.Generic.List[string]]::new()
function Check([bool]$Value, [string]$Name) { if (-not $Value) { throw "FAILED: $Name" }; $checks.Add($Name) }
function Reject([scriptblock]$Action, [string]$Name) {
    $failed = $false
    try { & $Action } catch { $failed = $true }
    Check $failed $Name
}
function Receipt([string]$Scope = 'currentUser') {
    $directory = if ($Scope -eq 'currentUser') { 'C:\Users\fixture\AppData\Local\OM0RX-xLog' } else { 'C:\Program Files\OM0RX-xLog' }
    return [pscustomobject]@{ schema = 2; sourceCommit = '3d9cb0981c30764f1188db350ffebc22a5f328a7'; version = '1.5.20'; passed = $false;
        installationScope = $Scope; registryHive = $(if ($Scope -eq 'currentUser') { 'HKCU' } else { 'HKLM' });
        actualDirectory = $directory; expectedDefaultDirectory = $directory; shortcutTarget = "$directory\xlog-prototype.exe";
        defaultPathPassed = $true; registryScopePassed = $true; startMenuScopePassed = $true;
        payloadManifestSHA256 = '448ca94af62660acf51cd201eee791367fa0898a6ab355f3559e41d4a9c2060d' }
}
# Execute the real top-level statement, not an equivalent hand-written test.
$scopeGuard = @($ast.FindAll({ param($node)
    $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -ceq 'Assert-XLogDiagnostic' -and
    $node.CommandElements.Count -eq 3 -and $node.CommandElements[2] -is [Management.Automation.Language.StringConstantExpressionAst] -and
    $node.CommandElements[2].Value -ceq 'Missing installer scope receipt.'
}, $true))
if ($scopeGuard.Count -ne 1) { throw 'Expected one actual top-level installer-scope guard.' }
$ancestor = $scopeGuard[0].Parent
while ($null -ne $ancestor) {
    if ($ancestor -is [Management.Automation.Language.FunctionDefinitionAst]) { throw 'Regression selected a function instead of the top-level preflight.' }
    $ancestor = $ancestor.Parent
}
$executeScopeGuard = [scriptblock]::Create($scopeGuard[0].Extent.Text)
$receipt = Receipt
if ($receipt.PSObject.Properties['installationScope'] -isnot [Management.Automation.PSNoteProperty]) { throw 'Expected a real present PSNoteProperty fixture.' }
& $executeScopeGuard # Regression: the original statement throws during [bool] binding here.
$receipt = [pscustomobject]@{ schema = 2 }
$missingScopeRejected = $false
try { & $executeScopeGuard } catch {
    if ($_.Exception.Message -cne 'Missing installer scope receipt.') { throw }
    $missingScopeRejected = $true
}
Check $missingScopeRejected 'actual top-level AST scope guard accepts PSNoteProperty and rejects missing property'

# Exercise the actual capture-through-resume region with fake probes. Each case
# must reject at the unchanged image/PID/PPID guard, after persisting all probes.
$capture = @($ast.FindAll({ param($node)
    $node -is [Management.Automation.Language.AssignmentStatementAst] -and
    $node.Left -is [Management.Automation.Language.VariableExpressionAst] -and $node.Left.VariablePath.UserPath -ceq 'observedIdentity'
}, $true))
$complete = @($ast.FindAll({ param($node)
    $node -is [Management.Automation.Language.InvokeMemberExpressionAst] -and $node.Expression.Extent.Text -ceq '$child' -and $node.Member.Value -ceq 'Complete'
}, $true))
if ($capture.Count -ne 1 -or $complete.Count -ne 1) { throw 'Expected one actual pre-Resume identity region.' }
$helperText = [IO.File]::ReadAllText($path)
$identityRegion = [scriptblock]::Create($helperText.Substring($capture[0].Extent.StartOffset, $complete[0].Extent.EndOffset - $capture[0].Extent.StartOffset))
$identityScratch = Join-Path (Join-Path (Split-Path $PSScriptRoot -Parent | Split-Path -Parent) '.build') ('qa-identity-observation-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $identityScratch
function Get-CimInstance {
    [CmdletBinding()] param([string]$ClassName, [string]$Filter)
    $script:identityCalls.Add('cim')
    if ($script:identityScenario -ceq 'cim-error') { throw [ComponentModel.Win32Exception]::new(5) }
    return $script:identityCim
}
try {
    foreach ($scenario in @('cim-null-image','native-probe-errors','cim-error')) {
        $script:identityScenario = $scenario
        $script:identityCalls = [Collections.Generic.List[string]]::new()
        $worker = 'C:\synthetic\xlog-prototype-worker.exe'
        $script:identityCim = [pscustomobject]@{ ProcessId = [uint32]123; ParentProcessId = [uint32]$PID;
            ExecutablePath = $(if ($scenario -ceq 'cim-null-image') { $null } else { $worker });
            CommandLine = '"C:\synthetic\xlog-prototype-worker.exe" --local-logbook-self-test' }
        $child = [pscustomobject]@{ Pid = [uint32]123; CommandLine = '"C:\synthetic\xlog-prototype-worker.exe" --local-logbook-self-test'; resumes = 0; completes = 0 }
        $child | Add-Member ScriptMethod ImagePath {
            $script:identityCalls.Add('image')
            if ($script:identityScenario -ceq 'native-probe-errors') { throw [ComponentModel.Win32Exception]::new(5) }
            return 'C:\synthetic\xlog-prototype-worker.exe'
        }
        $child | Add-Member ScriptMethod CreationFileTime {
            $script:identityCalls.Add('creation')
            if ($script:identityScenario -ceq 'native-probe-errors') { throw [ComponentModel.Win32Exception]::new(87) }
            return [long]123456
        }
        $child | Add-Member ScriptMethod ResumeOnce { $this.resumes++ }
        $child | Add-Member ScriptMethod Complete { $this.completes++ }
        $directory = Join-Path $identityScratch $scenario
        $null = New-Item -ItemType Directory -Path $directory
        $record = [ordered]@{ workerSHA256 = ('a' * 64); identityVerifiedBeforeResume = $false }
        $failure = $null
        try { & $identityRegion } catch { $failure = $_ }
        Assert-XLogDiagnostic ($null -ne $failure -and $failure.Exception.Message -ceq 'OS image/PID/PPID proof failed before Resume.') 'Actual unchanged identity guard did not reject as expected.'
        $retained = Get-Content -LiteralPath (Join-Path $directory 'identity-observed-before-validation.json') -Raw | ConvertFrom-Json -Depth 30
        Assert-XLogDiagnostic (($script:identityCalls -join ',') -ceq 'cim,image,creation') 'Probe was skipped after an earlier null/error.'
        Assert-XLogDiagnostic ($child.resumes -eq 0 -and $child.completes -eq 0 -and -not $record.identityVerifiedBeforeResume) 'An unverified child reached resume/output observation.'
        Assert-XLogDiagnostic ($retained.expected.pid -eq 123 -and $retained.expected.parentPID -eq $PID -and
            $retained.expected.executablePath -ceq $worker -and $retained.expected.argv.Count -eq 2 -and
            $retained.expected.argv[1] -ceq '--local-logbook-self-test' -and $retained.expected.workerSHA256 -ceq $record.workerSHA256) 'Expected coordinates not persisted before validation.'
        if ($scenario -ceq 'cim-null-image') {
            Assert-XLogDiagnostic ($retained.cim.status -ceq 'observed' -and $retained.cim.instances[0].ExecutablePath.present -and
                $null -eq $retained.cim.instances[0].ExecutablePath.value -and $retained.image.value -ceq $worker -and
                $retained.creationTime.value -eq 123456 -and $retained.cim.instances[0].CommandLine.value -ceq $child.CommandLine) 'Null CIM operand or independent native values were lost.'
        } elseif ($scenario -ceq 'native-probe-errors') {
            Assert-XLogDiagnostic ($retained.cim.instances[0].ProcessId.value -eq 123 -and $retained.image.status -ceq 'error' -and
                $retained.creationTime.status -ceq 'error' -and $retained.image.error.nativeErrorCode -eq 5 -and
                $retained.creationTime.error.nativeErrorCode -eq 87) 'Native errors did not survive independent capture.'
        } else {
            Assert-XLogDiagnostic ($retained.cim.status -ceq 'error' -and $retained.cim.error.nativeErrorCode -eq 5 -and
                $retained.image.value -ceq $worker -and $retained.creationTime.value -eq 123456) 'CIM error prevented later native capture.'
        }
        $checks.Add("actual identity AST persists$scenario before unchanged guard; no resume")
    }
} finally {
    Remove-Item Function:\Get-CimInstance
    Remove-Item -LiteralPath $identityScratch -Recurse -Force
}

foreach ($scope in @('currentUser','perMachine')) {
    $r = Receipt $scope
    Assert-XLogDiagnosticReceipt $r $r.actualDirectory $r.expectedDefaultDirectory
    $checks.Add("verified default/$scope receipt admitted despite failed later runtime")
}
foreach ($field in @('defaultPathPassed','registryScopePassed','startMenuScopePassed')) {
    $r = Receipt; $r.$field = $false
    Reject { Assert-XLogDiagnosticReceipt $r $r.actualDirectory $r.expectedDefaultDirectory } "reject false $field"
}
$r = Receipt; $r.defaultPathPassed = 'true'
Reject { Assert-XLogDiagnosticReceipt $r $r.actualDirectory $r.expectedDefaultDirectory } 'reject string instead of verified Boolean'
$r = Receipt; $r.sourceCommit = '0000000000000000000000000000000000000000'
Reject { Assert-XLogDiagnosticReceipt $r $r.actualDirectory $r.expectedDefaultDirectory } 'reject other source'
$r = Receipt; $r.version = '1.5.19'
Reject { Assert-XLogDiagnosticReceipt $r $r.actualDirectory $r.expectedDefaultDirectory } 'reject other version'
$r = Receipt; $r.registryHive = 'HKLM'
Reject { Assert-XLogDiagnosticReceipt $r $r.actualDirectory $r.expectedDefaultDirectory } 'reject scope/hive mismatch'
$r = Receipt; $r.shortcutTarget = 'D:\portable\xlog-prototype.exe'
Reject { Assert-XLogDiagnosticReceipt $r $r.actualDirectory $r.expectedDefaultDirectory } 'reject shortcut fallback'
$r = Receipt; $r.payloadManifestSHA256 = ('f' * 64)
Reject { Assert-XLogDiagnosticReceipt $r $r.actualDirectory $r.expectedDefaultDirectory } 'reject other manifest'
$r = Receipt; $r.PSObject.Properties.Remove('startMenuScopePassed')
Reject { Assert-XLogDiagnosticReceipt $r $r.actualDirectory $r.expectedDefaultDirectory } 'reject missing checkpoint'
$r = Receipt
Reject { Assert-XLogDiagnosticReceipt $r 'D:\custom-install' $r.expectedDefaultDirectory } 'reject non-default installed directory'

$parent = @{ PATH = 'C:\Developer'; SDKROOT = 'synthetic-sdk'; SWIFT_TOOLCHAIN = 'synthetic'; XLOG_ROOT = 'synthetic'; KEEP_TEST = 'unchanged' }
$a = New-XLogDiagnosticEnvironment $parent 'D:\fixture\profile' 'C:\installed;C:\Windows\System32;C:\Windows' 'D:\fixture\deep\Temp'
$b = New-XLogDiagnosticEnvironment $parent 'D:\fixture\profile' 'C:\installed;C:\Windows\System32;C:\Windows' 'D:\xld-test'
$different = @($a.Keys | Where-Object { $a[$_] -cne $b[$_] })
Check ((($different | Sort-Object) -join ',') -ceq 'TEMP,TMP') 'only TEMP/TMP vary'
Check ((Get-XLogDiagnosticTextHash ((Get-XLogDiagnosticEnvironmentEntries $a -WithoutTemp) -join "`0")) -ceq
    (Get-XLogDiagnosticTextHash ((Get-XLogDiagnosticEnvironmentEntries $b -WithoutTemp) -join "`0"))) 'common non-TEMP environment hash'
Check ($a['APPDATA'] -ceq 'D:\fixture\profile\AppData\Roaming' -and $a['LOCALAPPDATA'] -ceq 'D:\fixture\profile\AppData\Local') 'profile variables stay at original profile'
Check (-not $a.ContainsKey('SDKROOT') -and -not $a.ContainsKey('SWIFT_TOOLCHAIN') -and -not $a.ContainsKey('XLOG_ROOT')) 'developer/normal-worker environment removed'
Check ($parent.SDKROOT -ceq 'synthetic-sdk' -and $parent.PATH -ceq 'C:\Developer') 'parent environment map untouched'

$success = '{"id":"local-logbook-self-test","ok":true,"result":{"passed":true,"award_programmes":192,"network_contact":false,"station_io":false}}' | ConvertFrom-Json
Check (Test-XLogDiagnosticReply $success) 'unchanged 192 success contract'
foreach ($count in @(191,193)) { $copy = ($success | ConvertTo-Json -Depth 8) | ConvertFrom-Json; $copy.result.award_programmes = $count; Check (-not (Test-XLogDiagnosticReply $copy)) "reject award count$count" }
Check (-not (Test-XLogDiagnosticReply ('{"id":"local-logbook-self-test","ok":false,"error":{"code":"local_self_test_failed"}}' | ConvertFrom-Json))) 'generic caught error remains failure'
Check (-not (Test-XLogDiagnosticReply ('{"id":"local-logbook-self-test","ok":true,"result":null}' | ConvertFrom-Json))) 'null result not misclassified or thrown'
$copy = ($success | ConvertTo-Json -Depth 8) | ConvertFrom-Json; $copy.result.station_io = $true
Check (-not (Test-XLogDiagnosticReply $copy)) 'station output cannot pass'
$copy = ($success | ConvertTo-Json -Depth 8) | ConvertFrom-Json; $copy.result.network_contact = $true
Check (-not (Test-XLogDiagnosticReply $copy)) 'network cannot pass'

$source = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.StringConstantExpressionAst] -and $node.Value.Contains('namespace XLogLocalDiagnostic') }, $true))
Check ($source.Count -eq 1) 'single native declaration'
# Homebrew PowerShell can omit its ref folder. Use its bundled Roslyn directly
# with actual runtime metadata references; this compiles declarations only.
$null = [Reflection.Assembly]::LoadFrom((Join-Path $PSHOME 'Microsoft.CodeAnalysis.dll'))
$null = [Reflection.Assembly]::LoadFrom((Join-Path $PSHOME 'Microsoft.CodeAnalysis.CSharp.dll'))
$references = [Collections.Generic.List[Microsoft.CodeAnalysis.MetadataReference]]::new()
foreach ($file in ([AppContext]::GetData('TRUSTED_PLATFORM_ASSEMBLIES') -split [IO.Path]::PathSeparator)) {
    if (Test-Path -LiteralPath $file) { $references.Add([Microsoft.CodeAnalysis.MetadataReference]::CreateFromFile($file)) }
}
$tree = [Microsoft.CodeAnalysis.CSharp.CSharpSyntaxTree]::ParseText($source[0].Value)
$compilation = [Microsoft.CodeAnalysis.CSharp.CSharpCompilation]::Create('XLogDiagnosticDeclarationTest').WithOptions(
    [Microsoft.CodeAnalysis.CSharp.CSharpCompilationOptions]::new([Microsoft.CodeAnalysis.OutputKind]::DynamicallyLinkedLibrary)).AddSyntaxTrees($tree).AddReferences($references.ToArray())
$stream = [IO.MemoryStream]::new()
try {
    $emitted = $compilation.Emit($stream)
    if (-not $emitted.Success) { throw (($emitted.Diagnostics | ForEach-Object ToString) -join "`n") }
    $null = [Reflection.Assembly]::Load($stream.ToArray())
} finally { $stream.Dispose() }
$checks.Add('C# declarations compile without native execution')
Check (([XLogLocalDiagnostic.Child]::LayoutSizes() -join ',') -ceq '24,104,24') '64-bit security/startup/process ABI layouts'
Check ([XLogLocalDiagnostic.Child]::MakeCommandLine('C:\Program Files\OM0RX-xLog\xlog-prototype-worker.exe') -ceq
    '"C:\Program Files\OM0RX-xLog\xlog-prototype-worker.exe" --local-logbook-self-test') 'only exact disposable flag with spaced executable'
Reject { [XLogLocalDiagnostic.Child]::MakeCommandLine('C:\bad"name.exe') } 'reject command quote injection'
$flags = [Reflection.BindingFlags]'NonPublic,Static'
Check ([XLogLocalDiagnostic.Child].GetField('Limit',$flags).GetRawConstantValue() -eq 65536) 'stdout/stderr bounded prefixes'
Check ([XLogLocalDiagnostic.Child].GetField('ResponseDeadlineMilliseconds',$flags).GetRawConstantValue() -eq 10000) 'response deadline remains exactly10seconds'

$scratch = Join-Path (Join-Path (Split-Path $PSScriptRoot -Parent | Split-Path -Parent) '.build') ('qa-diagnostic-helper-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $scratch
try {
    $output = Join-Path $scratch 'receipt.json'
    Write-XLogDiagnosticJson $output @{ synthetic = $true }
    $before = [IO.File]::ReadAllBytes($output)
    Reject { Write-XLogDiagnosticJson $output @{ overwritten = $true } } 'evidence writes never clobber'
    Check ([Convert]::ToBase64String([IO.File]::ReadAllBytes($output)) -ceq [Convert]::ToBase64String($before)) 'existing evidence bytes preserved'
} finally { Remove-Item -LiteralPath $scratch -Recurse -Force }
[pscustomobject]@{ status = 'passed'; checks = $checks.Count; nativeAPICalls = 0; appOrWorkerLaunches = 0; testNames = $checks.ToArray() } | ConvertTo-Json -Depth 6
