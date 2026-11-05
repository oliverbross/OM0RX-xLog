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
