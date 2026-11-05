[CmdletBinding()]
param(
    [string]$ResultPath,
    [string]$AcceptanceScript = (Join-Path $PSScriptRoot 'accept-windows.ps1')
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Execute the owning acceptance blocks, rather than checking textual ordering.
# Only process I/O is faked; assertion, JSON writer, and check recording are real.
$source = (Resolve-Path -LiteralPath $AcceptanceScript).Path
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Acceptance source did not parse.' }
foreach ($name in @('Write-Json', 'Assert-That', 'Record-Check')) {
    $definitions = @($ast.FindAll({ param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
    }, $true))
    if ($definitions.Count -ne 1) { throw "Expected one real function: $name" }
    . ([scriptblock]::Create($definitions[0].Extent.Text))
}

$blocks = @{}
foreach ($kind in @('local', 'cli')) {
    $message = if ($kind -eq 'local') { 'Packaged local logbook round trip failed.' } else { 'Worker --self-test failed.' }
    $matches = @($ast.FindAll({ param($node)
        $node -is [Management.Automation.Language.StringConstantExpressionAst] -and $node.Value -eq $message
    }, $true))
    if ($matches.Count -ne 1) { throw "Expected one owning $kind assertion." }
    $owner = $matches[0].Parent
    while ($owner -and $owner -isnot [Management.Automation.Language.TryStatementAst]) { $owner = $owner.Parent }
    if (-not $owner) { throw "Expected owning $kind try/finally block." }
    $blocks[$kind] = [scriptblock]::Create($owner.Extent.Text)
}

function Read-Response($Process) { return $script:fakeResponse }
function Finish-Worker($Process, $StderrTask) {
    $script:finishCalls++
    # Receipt must already exist when graceful shutdown/exit validation starts.
    if (-not (Test-Path -LiteralPath $script:expectedReceipt)) { throw 'TEST: receipt missing before Finish-Worker.' }
    if ($script:finishShouldFail) { throw 'TEST: synthetic worker exit failure.' }
}

$temporary = Join-Path ([IO.Path]::GetTempPath()) "xlog-worker-receipt-test-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $temporary | Out-Null
$results = [Collections.Generic.List[object]]::new()
$cases = @(
    @{ name = 'local-rejected-response'; kind = 'local'; json = '{"id":"local-logbook-self-test","ok":false,"error":{"code":"local_self_test_failed","message":"Local logbook acceptance failed."}}'; failure = 'Packaged local logbook round trip failed.' },
    @{ name = 'local-count-guard'; kind = 'local'; json = '{"id":"local-logbook-self-test","ok":true,"result":{"passed":true,"award_programmes":191,"network_contact":false,"station_io":false}}'; failure = 'Packaged local logbook round trip failed.' },
    @{ name = 'local-valid'; kind = 'local'; json = '{"id":"local-logbook-self-test","ok":true,"result":{"passed":true,"award_programmes":192,"network_contact":false,"station_io":false}}'; failure = '' },
    @{ name = 'local-exit-rejected'; kind = 'local'; json = '{"id":"local-logbook-self-test","ok":true,"result":{"passed":true,"award_programmes":192,"network_contact":false,"station_io":false}}'; failure = 'TEST: synthetic worker exit failure.' },
    @{ name = 'cli-rejected-response'; kind = 'cli'; json = '{"id":"self-test","ok":false,"error":{"code":"self_test_failed"}}'; failure = 'Worker --self-test failed.' },
    @{ name = 'cli-valid'; kind = 'cli'; json = '{"id":"self-test","ok":true,"result":{"passed":true}}'; failure = '' },
    @{ name = 'cli-exit-rejected'; kind = 'cli'; json = '{"id":"self-test","ok":true,"result":{"passed":true}}'; failure = 'TEST: synthetic worker exit failure.' }
)
try {
    foreach ($case in $cases) {
        $EvidenceDirectory = Join-Path $temporary $case.name
        New-Item -ItemType Directory -Path $EvidenceDirectory | Out-Null
        $script:expectedReceipt = Join-Path $EvidenceDirectory $(if ($case.kind -eq 'local') { 'worker-local-logbook.json' } else { 'worker-self-test.json' })
        $script:fakeResponse = $case.json | ConvertFrom-Json -Depth 30
        $script:finishCalls = 0
        $script:finishShouldFail = $case.name.EndsWith('exit-rejected')
        $checks = [Collections.Generic.List[object]]::new()
        $stderr = [pscustomobject]@{}
        $stderr | Add-Member ScriptMethod ReadToEndAsync { return [Threading.Tasks.Task]::FromResult('') }
        $worker = [pscustomobject]@{ HasExited = $true; StandardError = $stderr; Disposed = $false }
        $worker | Add-Member ScriptMethod Dispose { $this.Disposed = $true }
        $caught = ''
        $persistedAtCatch = $false
        try { . $blocks[$case.kind] }
        catch {
            $caught = $_.Exception.Message
            $persistedAtCatch = Test-Path -LiteralPath $script:expectedReceipt
        }
        $receiptExists = Test-Path -LiteralPath $script:expectedReceipt
        $matchesResponse = $false
        if ($receiptExists) {
            $actual = Get-Content -LiteralPath $script:expectedReceipt -Raw | ConvertFrom-Json -Depth 30
            $matchesResponse = ($actual | ConvertTo-Json -Depth 30 -Compress) -ceq ($script:fakeResponse | ConvertTo-Json -Depth 30 -Compress)
        }
        $expectedFinish = if ($case.name -like '*rejected-response' -or $case.name -eq 'local-count-guard') { 0 } else { 1 }
        $expectedChecks = if ($case.failure) { 0 } else { 1 }
        $passed = $caught -ceq $case.failure -and $receiptExists -and $matchesResponse -and
            $script:finishCalls -eq $expectedFinish -and $checks.Count -eq $expectedChecks -and $worker.Disposed -and
            (-not $case.failure -or $persistedAtCatch)
        $results.Add([pscustomobject]@{ name = $case.name; passed = $passed; receiptExists = $receiptExists;
            parsedResponsePreserved = $matchesResponse; persistedBeforeCaughtFailure = $persistedAtCatch;
            expectedFailureObserved = $caught -ceq $case.failure; finishCalls = $script:finishCalls;
            successfulChecks = $checks.Count; disposed = $worker.Disposed })
        Write-Host "$($case.name): $(if ($passed) { 'PASS' } else { 'FAIL' })"
    }
} finally { Remove-Item -LiteralPath $temporary -Recurse -Force }
$failures = @($results | Where-Object { -not $_.passed }).Count
$report = [ordered]@{ schema = 1; method = 'Actual acceptance try/finally AST blocks with fake worker I/O and real JSON writer/assertions';
    acceptanceSourceSHA256 = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant();
    tests = $results.Count; failures = $failures; cases = @($results.ToArray()) }
if ($ResultPath) {
    if (Test-Path -LiteralPath $ResultPath) { throw 'ResultPath must be new.' }
    Write-Json $ResultPath $report
}
Write-Host "$($results.Count) cases, $failures failures"
if ($failures) { exit 1 }
