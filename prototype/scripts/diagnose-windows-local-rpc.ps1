#Requires -Version 7.0
<#
.SYNOPSIS
Replays local logbook stages through the unchanged 1.5.20 acceptance-only worker.
.DESCRIPTION
Private diagnosis, never acceptance. At most two sequential workers, each with
sole --local-ui-acceptance and a TOTAL 10-second budget including startup/proof.
Original nested TEMP, CWD, profile and common PATH remain fixed. No GUI, normal
worker, network or station methods. First failing stage stops the entire replay.
Unlike LocalLogbookSelfTest this mode precreates a differently named TEMP root,
seeds spot history, disables native preference inheritance and creates LiveWorker
lanes; EOF deletes its workspace/defaults. Restore exercises database reopening,
but cannot reproduce the direct test's final fresh-service reopen. A pass does
not clear the original self-test failure or establish a long-path mechanism.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$PortableDirectory,
    [Parameter(Mandatory)][string]$InstalledDirectory,
    [Parameter(Mandatory)][string]$InstallerReceipt,
    [Parameter(Mandatory)][string]$RunnerTemp,
    [Parameter(Mandatory)][string]$OriginalNestedTemp,
    [Parameter(Mandatory)][string]$WorkingDirectory,
    [Parameter(Mandatory)][string]$PairedDiagnostic,
    [Parameter(Mandatory)][string]$EvidenceDirectory
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Import-XLogReplayHelpers([string]$Path) {
    $tokens = $null; $errors = $null
    $tree = [Management.Automation.Language.Parser]::ParseFile($Path,[ref]$tokens,[ref]$errors)
    if ($errors.Count) { throw 'Diagnostic dependency syntax failed.' }
    foreach ($node in $tree.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] },$true)) {
        # Import definitions only. Never execute the dependency's preflight/launch.
        . ([scriptblock]::Create('function script:' + $node.Name + $node.Extent.Text.Substring(('function ' + $node.Name).Length)))
    }
    return $tree
}
function Get-XLogReplayRemaining($Clock) {
    $remaining = 10000 - $Clock.ElapsedMilliseconds
    if ($remaining -le 0) { throw 'Replay total 10-second deadline reached.' }
    return [int]$remaining
}
function Assert-XLogReplayPaired($Paired,$Receipt,[string]$ReceiptHash,[string]$NativeHash,$Packages,$Values,[string]$Working,[string]$Temp) {
    Assert-XLogDiagnostic ($Paired.schema -eq 1 -and $Paired.sourceCommit -ceq '3d9cb0981c30764f1188db350ffebc22a5f328a7' -and
        $Paired.version -ceq '1.5.20' -and $Paired.status -ceq 'complete-diagnostic-not-acceptance' -and
        $Paired.maximumRuns -eq 6 -and @($Paired.runs).Count -eq 6 -and $Paired.payloadsUnchangedAfterProbes -eq $true -and
        $Paired.responseDeadlineSeconds -eq 10 -and $Paired.inputProof.installationScope -ceq $Receipt.installationScope -and
        $Paired.inputProof.installerReceiptSHA256 -ceq $ReceiptHash -and $Paired.inputProof.nativeReceiptSHA256 -ceq $NativeHash) 'Need completed exact-source, payload-stable six-run paired evidence.'
    Assert-XLogDiagnostic ((Test-XLogDiagnosticSamePath $Paired.controls.workingDirectory $Working) -and
        (Test-XLogDiagnosticSamePath $Paired.controls.originalNestedTemp $Temp) -and
        $Paired.controls.commonNonTempEnvironmentSHA256 -ceq (Get-XLogDiagnosticTextHash ((Get-XLogDiagnosticEnvironmentEntries $Values -WithoutTemp) -join "`0"))) 'Replay environment differs from paired controls.'
    foreach($kind in @('portable','installed')) {
        Assert-XLogDiagnostic (Test-XLogDiagnosticSamePath $Paired.inputProof.packages.$kind.worker $Packages[$kind].worker) 'Paired worker coordinate mismatch.'
    }
    for($i=0;$i -lt 6;$i++) {
        $run=$Paired.runs[$i];$kind=if($i%2 -eq 0){'portable'}else{'installed'};$condition=if($i -in @(2,3)){'B'}else{'A'}
        Assert-XLogDiagnostic ($run.ordinal -eq $i+1 -and $run.package -ceq $kind -and $run.condition -ceq $condition -and
            $run.status -ceq 'captured-diagnostic-not-acceptance' -and $run.sourceCommit -ceq $Paired.sourceCommit -and
            $run.workerSHA256 -ceq '2dd9a007937b0cee8240bc73785a76ce2fbe4cc6a6dbe9dcde5114abce5593e5' -and
            $run.identityVerifiedBeforeResume -eq $true -and $run.cleanup.resumed -eq $true -and $run.cleanup.abortedBeforeResume -eq $false -and
            $run.exitConfirmed -eq $true -and $run.timedOut -eq $false -and $run.drainComplete -eq $true -and $run.outputTruncated -eq $false -and
            $run.stderrTotalBytes -eq 0 -and $run.responseDeadlineSeconds -eq 10) 'Paired run identity/lifecycle is incomplete.'
        if($condition -ceq 'B') {
            Assert-XLogDiagnostic ($run.exitCode -eq 0 -and $run.contractPassed -eq $true -and (Test-XLogDiagnosticReply $run.parsedReply)) 'Paired short TEMP did not pass unchanged192 contract.'
        } else {
            Assert-XLogDiagnostic ($run.exitCode -eq 1 -and $run.contractPassed -eq $false -and $run.parsedReply.ok -eq $false -and
                $run.parsedReply.id -ceq 'local-logbook-self-test' -and $run.parsedReply.error.code -ceq 'local_self_test_failed' -and
                (Test-XLogDiagnosticSamePath $run.controlledEnvironment.TEMP $Temp) -and (Test-XLogDiagnosticSamePath $run.controlledEnvironment.TMP $Temp)) 'Paired original TEMP failure differs from the demonstrated outcome.'
        }
    }
}
function Assert-XLogReplayIdentity($Observation, $Process, [string]$Worker, [string[]]$Argv, [string]$ExpectedHash) {
    $os = $Observation.CimInstance
    Assert-XLogDiagnostic ($null -ne $os -and $os.ProcessId -eq $Process.Id -and $os.ParentProcessId -eq $PID -and
        (Test-XLogDiagnosticSamePath $Observation.ImagePath $Worker) -and
        ([string]::IsNullOrEmpty($os.ExecutablePath) -or (Test-XLogDiagnosticSamePath $os.ExecutablePath $Worker))) 'Replay OS image/PID/PPID proof failed.'
    Assert-XLogDiagnostic ($Argv.Count -eq 2 -and (Test-XLogDiagnosticSamePath $Argv[0] $Worker) -and $Argv[1] -ceq '--local-ui-acceptance') 'Replay requires the sole acceptance flag.'
    Assert-XLogDiagnostic ($Observation.CreationFileTime -gt 0 -and (Get-XLogDiagnosticHash $Worker) -ceq $ExpectedHash) 'Replay creation/hash proof failed.'
}
function Invoke-XLogReplayStage($State,[string]$Method,$Params,[scriptblock]$Check) {
    $allowed = @('health','workspace_status','workspace_create','settings_load','settings_save','logbook_import_adif','logbook_list',
        'logbook_save','logbook_stats','logbook_catalog','logbook_country_facts','backup_create','logbook_delete','logbook_undo','backup_restore','logbook_export_adif')
    Assert-XLogDiagnostic ($State.identityVerified -and $Method -cin $allowed) 'Replay stage lacks verified acceptance authority.'
    $null = Get-XLogReplayRemaining $State.clock
    $ordinal = ++$State.ordinal
    $directory = Join-Path $State.directory ('{0:00}-{1}' -f $ordinal,$Method)
    $null = New-Item -ItemType Directory -Path $directory
    $id = [guid]::NewGuid().ToString()
    $request = @{id=$id;method=$Method;params=$Params}
    Write-XLogDiagnosticJson (Join-Path $directory 'request.json') $request
    $stage = [ordered]@{id=$id;method=$Method;startedUtc=[DateTime]::UtcNow.ToString('o');elapsedStartMs=$State.clock.ElapsedMilliseconds;status='waiting'}
    try {
        $State.process.StandardInput.WriteLine(($request | ConvertTo-Json -Depth 30 -Compress)); $State.process.StandardInput.Flush()
        while (-not $State.pending.Contains([byte]10)) {
            $buffer = [byte[]]::new(4096)
            $read = $State.process.StandardOutput.BaseStream.ReadAsync($buffer,0,$buffer.Length)
            Assert-XLogDiagnostic ($read.Wait((Get-XLogReplayRemaining $State.clock))) 'Replay response exceeded total deadline.'
            $count = $read.GetAwaiter().GetResult()
            Assert-XLogDiagnostic ($count -gt 0) 'Replay stdout closed before a reply.'
            [IO.File]::WriteAllBytes((Join-Path $directory ('chunk-{0:00}.bin' -f $State.totalBytes)),[byte[]]$buffer[0..($count-1)])
            $State.totalBytes += $count
            Assert-XLogDiagnostic ($State.totalBytes -le 1048576) 'Replay stdout exceeded private total byte bound.'
            for ($i=0;$i -lt $count;$i++) { $State.pending.Add($buffer[$i]) }
            Assert-XLogDiagnostic ($State.pending.Count -le 65536) 'Replay frame exceeded 65536 bytes.'
        }
        $end = $State.pending.IndexOf([byte]10)
        $raw = $State.pending.GetRange(0,$end+1).ToArray()
        $State.pending.RemoveRange(0,$end+1)
        [IO.File]::WriteAllBytes((Join-Path $directory 'reply.bin'),$raw)
        $reply = [Text.UTF8Encoding]::new($false,$true).GetString($raw) | ConvertFrom-Json -Depth 40
        Write-XLogDiagnosticJson (Join-Path $directory 'reply.json') $reply
        Assert-XLogDiagnostic ($reply.id -ceq $id -and $reply.ok -eq $true) 'Replay stage returned an error or mismatched correlation.'
        Assert-XLogDiagnostic (-not $State.stderrRead.IsCompleted -or $State.stderrRead.GetAwaiter().GetResult() -eq 0) 'Replay emitted stderr.'
        Assert-XLogDiagnostic ([bool](& $Check $reply.result)) 'Replay stage result contract failed.'
        $stage.status='passed'
        return $reply.result
    } catch { $stage.status='failed'; $stage.error=$_.Exception.Message; throw }
    finally {
        $stage.finishedUtc=[DateTime]::UtcNow.ToString('o');$stage.elapsedEndMs=$State.clock.ElapsedMilliseconds
        Write-XLogDiagnosticJson (Join-Path $directory 'stage.json') $stage
        $State.stages.Add($stage)
    }
}
function Invoke-XLogReplaySequence([scriptblock]$Rpc) {
    $null = & $Rpc 'health' @{} {param($r) $r.mode -ceq 'isolated_local_acceptance' -and $r.platform_services -eq $false -and $r.isolated_workspace -eq $true -and $r.network_contact -eq $false -and $r.credentials_accessed -eq $false}
    $null = & $Rpc 'workspace_status' @{} {param($r) $r.workspace_exists -eq $false}
    $null = & $Rpc 'workspace_create' @{mode='empty'} {param($r) $r.qso_count -eq 0 -and $r.automatic_sync -eq $false}
    $settings = & $Rpc 'settings_load' @{} {param($r) $r.settings.logbookMode -ceq 'local' -and $r.settings.automaticSync -eq $false}
    $settings.settings.stationLocation='Synthetic local acceptance'
    $snapshot = & $Rpc 'settings_load' @{} {param($r) $null -ne $r.generation -and $null -ne $r.revision}
    $null = & $Rpc 'settings_save' @{operationID=[guid]::NewGuid().ToString();expectedRevision=$snapshot.revision;generation=$snapshot.generation;settings=$settings.settings} {param($r) $r.settings.stationLocation -ceq 'Synthetic local acceptance'}
    $adif='<CALL:5>K1ABC<QSO_DATE:8>20261001<TIME_ON:6>120000<BAND:3>20m<MODE:2>CW<DXCC:3>291<QSL_RCVD:1>Y<APP_FIXTURE:4>KEPT<EOR>'
    $null = & $Rpc 'logbook_import_adif' @{text=$adif} {param($r) $r.imported -eq 1}
    $rows = & $Rpc 'logbook_list' @{search='K1ABC'} {param($r) @($r.qsos).Count -eq 1}
    $qso=$rows.qsos[0];$id=$qso.id;$qso.comment='Edited locally'
    $null = & $Rpc 'logbook_save' @{qso=$qso} {param($r) $r.qso.comment -ceq 'Edited locally'}
    $null = & $Rpc 'logbook_stats' @{} {param($r) $r.stats.qso_count -eq 1 -and $r.dxcc_statuses.'291' -ceq 'confirmed'}
    $null = & $Rpc 'logbook_catalog' @{} {param($r) $r.total_programmes -eq 192}
    # Public date-aware endpoint is a resource proxy, not legacy resolve().
    $null = & $Rpc 'logbook_country_facts' @{call='K1ABC';at='2026-10-01T12:00:00Z'} {param($r) $r.facts.status -ceq 'resolved' -and $r.facts.country.adif -eq 291}
    $backup = & $Rpc 'backup_create' @{name='round-trip'} {param($r) -not [string]::IsNullOrEmpty($r.name)}
    $null = & $Rpc 'logbook_delete' @{id=$id} {param($r) $null -ne $r.qso.deletedAt}
    $null = & $Rpc 'logbook_list' @{} {param($r) $r.total -eq 0}
    $null = & $Rpc 'logbook_undo' @{id=$id} {param($r) $null -eq $r.qso.PSObject.Properties['deletedAt'] -or $null -eq $r.qso.deletedAt}
    $null = & $Rpc 'logbook_list' @{} {param($r) $r.total -eq 1}
    $null = & $Rpc 'logbook_delete' @{id=$id} {param($r) $null -ne $r.qso.deletedAt}
    $null = & $Rpc 'backup_restore' @{name=$backup.name;confirm_restore=$true} {param($r) $r.restored -eq $true}
    $null = & $Rpc 'settings_load' @{} {param($r) $r.settings.stationLocation -ceq 'Synthetic local acceptance'}
    $null = & $Rpc 'logbook_export_adif' @{} {param($r) $r.text.Contains('<APP_FIXTURE:4>KEPT') -and $r.text.Contains('Edited locally')}
}
function Complete-XLogReplay($State) {
    $State.process.StandardInput.Close()
    Assert-XLogDiagnostic ($State.process.WaitForExit((Get-XLogReplayRemaining $State.clock))) 'Replay EOF exceeded total deadline.'
    $extra=[byte[]]::new(4096)
    $drain=$State.process.StandardOutput.BaseStream.ReadAsync($extra,0,$extra.Length)
    Assert-XLogDiagnostic ($drain.Wait((Get-XLogReplayRemaining $State.clock))) 'Replay stdout EOF exceeded total deadline.'
    $count=$drain.GetAwaiter().GetResult()
    $captured=[byte[]]::new($count);[Array]::Copy($extra,$captured,$count)
    [IO.File]::WriteAllBytes((Join-Path $State.directory 'extra-stdout.bin'),$captured)
    Assert-XLogDiagnostic ($State.stderrRead.Wait((Get-XLogReplayRemaining $State.clock))) 'Replay stderr did not close within total deadline.'
    Assert-XLogDiagnostic ($State.process.ExitCode -eq 0 -and $State.stderrRead.Result -eq 0 -and $State.pending.Count -eq 0 -and $count -eq 0) 'Replay EOF exit/output contract failed.'
}

if (-not $IsWindows) { throw 'Replay requires native Windows; no worker was launched.' }
$dependency = Join-Path $PSScriptRoot 'diagnose-windows-local-self-test.ps1'
$dependencyAst = Import-XLogReplayHelpers $dependency
$RunnerTemp=Resolve-XLogDiagnosticDirectory $RunnerTemp
Assert-XLogDiagnostic ([Environment]::Is64BitOperatingSystem -and [IntPtr]::Size -eq 8 -and (Test-XLogDiagnosticSamePath $RunnerTemp ([IO.Path]::GetFullPath($env:RUNNER_TEMP)))) 'Use this x64 job RUNNER_TEMP.'
$WorkingDirectory=Resolve-XLogDiagnosticDirectory $WorkingDirectory
$OriginalNestedTemp=Resolve-XLogDiagnosticDirectory $OriginalNestedTemp
Assert-XLogDiagnosticInside $WorkingDirectory $RunnerTemp
Assert-XLogDiagnosticInside $OriginalNestedTemp $WorkingDirectory
Assert-XLogDiagnostic (Test-XLogDiagnosticSamePath $OriginalNestedTemp (Join-Path $WorkingDirectory 'Temp')) 'Original nested TEMP must match the failed profile.'
$EvidenceDirectory=[IO.Path]::GetFullPath($EvidenceDirectory)
Assert-XLogDiagnosticInside $EvidenceDirectory $RunnerTemp
Assert-XLogDiagnostic (-not (Test-Path -LiteralPath $EvidenceDirectory)) 'Replay evidence must be new.'
$null=New-Item -ItemType Directory -Path $EvidenceDirectory
$EvidenceDirectory=Resolve-XLogDiagnosticDirectory $EvidenceDirectory
Assert-XLogDiagnosticInside ([IO.Path]::GetFullPath($InstallerReceipt)) $RunnerTemp
Assert-XLogDiagnosticInside ([IO.Path]::GetFullPath($PairedDiagnostic)) $RunnerTemp
$receipt=Get-Content -LiteralPath $InstallerReceipt -Raw | ConvertFrom-Json -Depth 40
Assert-XLogDiagnostic ($null -ne $receipt.PSObject.Properties['installationScope']) 'Missing installer scope receipt.'
$knownRoot = switch ($receipt.installationScope) {'currentUser' {$env:LOCALAPPDATA};'perMachine' {$env:ProgramW6432};default {throw 'Unknown installer scope.'}}
Assert-XLogDiagnostic (-not [string]::IsNullOrWhiteSpace($knownRoot)) 'Expected scope known-folder unavailable.'
$InstalledDirectory=Resolve-XLogDiagnosticDirectory $InstalledDirectory
$PortableDirectory=Resolve-XLogDiagnosticDirectory $PortableDirectory
Assert-XLogDiagnosticInside $PortableDirectory $RunnerTemp
Assert-XLogDiagnosticReceipt $receipt $InstalledDirectory (Join-Path $knownRoot 'OM0RX-xLog')
Assert-XLogDiagnostic (-not (Test-XLogDiagnosticSamePath $InstalledDirectory $PortableDirectory)) 'Replay packages must be distinct.'
$nativePath=Join-Path (Split-Path $WorkingDirectory -Parent) 'acceptance.json'
$native=Get-Content -LiteralPath $nativePath -Raw | ConvertFrom-Json -Depth 40
$commonPath="$InstalledDirectory;$env:SystemRoot\System32;$env:SystemRoot"
$proof=@($native.checks | Where-Object {$_.name -ceq 'payload-hashes' -and $_.passed -eq $true})
Assert-XLogDiagnostic ($native.schema -eq 1 -and $native.commit -ceq $receipt.sourceCommit -and
    (Test-XLogDiagnosticSamePath $native.package $InstalledDirectory) -and $proof.Count -eq 1 -and $proof[0].evidence.files -eq 3270 -and
    $proof[0].evidence.manifestSha256 -ceq $receipt.payloadManifestSHA256 -and
    (Test-XLogDiagnosticSamePath $native.isolation.workingDirectory $WorkingDirectory) -and
    (Test-XLogDiagnosticSamePath $native.isolation.childProfile $WorkingDirectory) -and $native.isolation.childPath -ieq $commonPath) 'Original installed runtime receipt/environment mismatch.'
$packages=@{portable=Assert-XLogDiagnosticPayload $PortableDirectory $false;installed=Assert-XLogDiagnosticPayload $InstalledDirectory $true}
$values=New-XLogDiagnosticEnvironment ([Environment]::GetEnvironmentVariables()) $WorkingDirectory $commonPath $OriginalNestedTemp
$paired=Get-Content -LiteralPath $PairedDiagnostic -Raw | ConvertFrom-Json -Depth 50
Assert-XLogReplayPaired $paired $receipt (Get-XLogDiagnosticHash $InstallerReceipt) (Get-XLogDiagnosticHash $nativePath) $packages $values $WorkingDirectory $OriginalNestedTemp
$declaration=@($dependencyAst.FindAll({param($n) $n -is [Management.Automation.Language.StringConstantExpressionAst] -and $n.Value.Contains('namespace XLogLocalDiagnostic')},$true))
Assert-XLogDiagnostic ($declaration.Count -eq 1) 'Expected original native declaration.'
Add-Type -TypeDefinition $declaration[0].Value # Reuse unchanged CommandLineToArgvW only; no Child.Create/Resume calls.
$report=[ordered]@{schema=1;sourceCommit=$receipt.sourceCommit;version='1.5.20';status='running';maximumWorkers=2;totalChildBudgetMs=10000;helperSHA256=Get-XLogDiagnosticHash $PSCommandPath;dependencySHA256=Get-XLogDiagnosticHash $dependency;pairedDiagnosticSHA256=Get-XLogDiagnosticHash $PairedDiagnostic;installerReceiptSHA256=Get-XLogDiagnosticHash $InstallerReceipt;nativeReceiptSHA256=Get-XLogDiagnosticHash $nativePath;packages=$packages;controls=@{cwd=$WorkingDirectory;temp=$OriginalNestedTemp;profile=$WorkingDirectory;commonPath=$commonPath;environmentLengths=@($values.Keys | ForEach-Object {@{name=$_;length=$values[$_].Length}})};limitations=@('diagnosis only; does not clear original self-test','different generated root basename; precreated root and137 spot-history seed rows','native preference inheritance disabled; LiveWorker lanes initialized','EOF deletes generated workspace/defaults; no final fresh-service/process reopen');runs=[Collections.Generic.List[object]]::new()}
try {
    foreach ($kind in @('portable','installed')) {
        $directory=Join-Path $EvidenceDirectory $kind;$null=New-Item -ItemType Directory -Path $directory
        $worker=[string]$packages[$kind].worker
        $run=[ordered]@{package=$kind;workerSHA256=Get-XLogDiagnosticHash $worker;argv=@($worker,'--local-ui-acceptance');status='starting';identityVerified=$false;stages=[Collections.Generic.List[object]]::new()}
        $process=[Diagnostics.Process]::new();$clock=[Diagnostics.Stopwatch]::new();$stderrBuffer=[byte[]]::new(65536);$stderrRead=$null
        try {
            $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$worker;$info.ArgumentList.Add('--local-ui-acceptance')
            $info.WorkingDirectory=$WorkingDirectory;$info.UseShellExecute=$false;$info.CreateNoWindow=$true
            $info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
            $info.Environment.Clear();foreach($key in $values.Keys){$info.Environment[$key]=$values[$key]}
            $process.StartInfo=$info;$clock.Start();Assert-XLogDiagnostic ($process.Start()) 'Replay child creation failed.'
            $null=$process.SafeHandle # Hold the exclusive creation handle before any observation; never reacquire by PID.
            $run.pid=$process.Id
            Assert-XLogDiagnostic (-not $process.HasExited) 'Replay child exited before identity observations.'
            $observed=Get-XLogDiagnosticIdentityObservations -QueryCim {Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)" -ErrorAction Stop} -QueryImage {$process.MainModule.FileName} -QueryCreationTime {$process.StartTime.ToUniversalTime().ToFileTimeUtc()}
            $run.observations=$observed.Observations
            $run.observations.expected=@{pid=$process.Id;parentPID=$PID;executablePath=$worker;argv=$run.argv;workerSHA256=$run.workerSHA256}
            Write-XLogDiagnosticJson (Join-Path $directory 'identity-observed.json') $run.observations
            $argv=[XLogLocalDiagnostic.Child]::SplitCommandLine($observed.CimInstance.CommandLine)
            Assert-XLogReplayIdentity $observed $process $worker $argv $run.workerSHA256
            $null=Get-XLogReplayRemaining $clock
            Assert-XLogDiagnostic (-not $process.HasExited) 'Replay child exited before identity admission.'
            $run.identityVerified=$true;$run.status='identity-proved-before-first-rpc'
            Write-XLogDiagnosticJson (Join-Path $directory 'identity-verified.json') @{image=$observed.ImagePath;creationFileTime=$observed.CreationFileTime;argv=$argv;pid=$process.Id;parentPID=$PID}
            $stderrRead=$process.StandardError.BaseStream.ReadAsync($stderrBuffer,0,$stderrBuffer.Length)
            $state=@{identityVerified=$true;process=$process;clock=$clock;directory=$directory;ordinal=0;pending=[Collections.Generic.List[byte]]::new();totalBytes=0;stderrRead=$stderrRead;stages=$run.stages}
            Invoke-XLogReplaySequence {param($method,$params,$check) Invoke-XLogReplayStage $state $method $params $check}
            Complete-XLogReplay $state
            $run.status='completed-diagnostic-not-acceptance';$run.shutdown='normal EOF'
        } catch {$run.status=if($run.stages.Count -eq 0){'startup-or-before-health-failed'}else{'stage-failed'};$run.error=$_.Exception.Message;throw}
        finally {
            $run.elapsedMs=$clock.ElapsedMilliseconds
            $cleanupFailed=$false
            try {
                if ($run.Contains('pid')) {
                    if (-not $process.HasExited) {
                        try {$process.StandardInput.Close();$run.cleanupInput='EOF'}
                        catch {$cleanupFailed=$true;$run.eofCloseError=$_.Exception.Message}
                        # No arbitrary PID/tree termination. Failed/proof-blocked child is retired only at its original deadline.
                        $remaining=[Math]::Max(0,10000-$clock.ElapsedMilliseconds)
                        if (-not $process.WaitForExit([int]$remaining)) {$process.Kill();$run.ownedTimeoutTermination=$true;$null=$process.WaitForExit(3000)}
                    }
                    $run.exitConfirmed=$process.HasExited
                    if($process.HasExited){$run.exitCode=$process.ExitCode}
                }
            } catch {$cleanupFailed=$true;$run.cleanupError=$_.Exception.Message}
            finally {
                try {
                    if($null -ne $stderrRead -and $stderrRead.IsCompletedSuccessfully){$captured=[byte[]]::new($stderrRead.Result);[Array]::Copy($stderrBuffer,$captured,$captured.Length);[IO.File]::WriteAllBytes((Join-Path $directory 'stderr.bin'),$captured);$run.stderrCapturedBytes=$captured.Length}
                } finally {
                    try {$process.Dispose()} catch {$cleanupFailed=$true;$run.disposeError=$_.Exception.Message}
                    $run.elapsedAfterCleanupMs=$clock.ElapsedMilliseconds;$report.runs.Add($run);Write-XLogDiagnosticJson (Join-Path $directory 'run.json') $run
                }
            }
            if($cleanupFailed){throw 'Replay owned-child cleanup failed; preserve private run receipt and stop.'}
        }
    }
    $null=Assert-XLogDiagnosticPayload $PortableDirectory $false;$null=Assert-XLogDiagnosticPayload $InstalledDirectory $true
    $report.status='completed-diagnostic-not-acceptance'
} catch {$report.status='failed';$report.error=$_.Exception.Message;throw}
finally {Write-XLogDiagnosticJson (Join-Path $EvidenceDirectory 'replay.json') $report}
