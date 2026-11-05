#Requires -Version 7.0
# Actual source functions only; no process/Win32 API/worker is launched.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$path=Join-Path $PSScriptRoot 'diagnose-windows-local-rpc.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors | Out-String)}
foreach($node in $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$true)){. ([scriptblock]::Create($node.Extent.Text))}
$null=Import-XLogReplayHelpers (Join-Path $PSScriptRoot 'diagnose-windows-local-self-test.ps1')
$checks=[Collections.Generic.List[string]]::new()
function Check([bool]$Pass,[string]$Name){if(-not $Pass){throw "FAILED: $Name"};$checks.Add($Name)}
function Reject([scriptblock]$Action,[string]$Name){$failure=$null;try{&$Action}catch{$failure=$_};Check ($null -ne $failure) $Name}
$hash='2dd9a007937b0cee8240bc73785a76ce2fbe4cc6a6dbe9dcde5114abce5593e5'
$worker='C:\synthetic\xlog-prototype-worker.exe'
function Get-XLogDiagnosticHash([string]$Path){return $script:hash}
$observation=[pscustomobject]@{CimInstance=[pscustomobject]@{ProcessId=123;ParentProcessId=$PID;ExecutablePath=$null};ImagePath=$worker;CreationFileTime=1234}
$process=[pscustomobject]@{Id=123}
Assert-XLogReplayIdentity $observation $process $worker @($worker,'--local-ui-acceptance') $hash
$checks.Add('actual identity accepts null CIM only with owned native image/parent/time/hash')
foreach($scenario in @('native-null','native-mismatch','cim-contradiction','pid','ppid','creation','hash','normal-worker','extra-flag')){
    $o=[pscustomobject]@{CimInstance=[pscustomobject]@{ProcessId=123;ParentProcessId=$PID;ExecutablePath=$worker};ImagePath=$worker;CreationFileTime=1234}
    $argv=@($worker,'--local-ui-acceptance');$expectedHash=$hash
    switch($scenario){
        'native-null'{$o.ImagePath=$null};'native-mismatch'{$o.ImagePath='C:\other.exe'};'cim-contradiction'{$o.CimInstance.ExecutablePath='C:\other.exe'}
        'pid'{$o.CimInstance.ProcessId=124};'ppid'{$o.CimInstance.ParentProcessId=$PID+1};'creation'{$o.CreationFileTime=0};'hash'{$expectedHash='wrong'}
        'normal-worker'{$argv=@($worker)};'extra-flag'{$argv=@($worker,'--local-ui-acceptance','--self-test')}
    }
    Reject {Assert-XLogReplayIdentity $o $process $worker $argv $expectedHash} "actual identity rejects $scenario"
}
Check ((Get-XLogReplayRemaining ([pscustomobject]@{ElapsedMilliseconds=9999})) -eq 1) 'deadline shares remaining original budget'
Reject {Get-XLogReplayRemaining ([pscustomobject]@{ElapsedMilliseconds=10000})} 'deadline rejects exactly10000ms'

$working='D:\runner\evidence\native-runtime\synthetic-profile';$temp="$working\Temp"
$values=New-XLogDiagnosticEnvironment @{KEEP='same'} $working 'C:\installed;C:\Windows\System32;C:\Windows' $temp
$packages=@{portable=@{worker='D:\runner\portable\xlog-prototype-worker.exe'};installed=@{worker='C:\installed\xlog-prototype-worker.exe'}}
$receipt=[pscustomobject]@{installationScope='perMachine'}
$paired=[pscustomobject]@{schema=1;sourceCommit='3d9cb0981c30764f1188db350ffebc22a5f328a7';version='1.5.20';status='complete-diagnostic-not-acceptance';maximumRuns=6;payloadsUnchangedAfterProbes=$true;responseDeadlineSeconds=10;
    inputProof=@{installationScope='perMachine';installerReceiptSHA256='receipt';nativeReceiptSHA256='native';packages=$packages};
    controls=@{workingDirectory=$working;originalNestedTemp=$temp;commonNonTempEnvironmentSHA256=Get-XLogDiagnosticTextHash ((Get-XLogDiagnosticEnvironmentEntries $values -WithoutTemp) -join "`0")};runs=@()}
foreach($i in 0..5){
    $kind=if($i%2 -eq 0){'portable'}else{'installed'};$condition=if($i -in @(2,3)){'B'}else{'A'}
    $reply=if($condition -ceq 'B'){'{"id":"local-logbook-self-test","ok":true,"result":{"passed":true,"award_programmes":192,"network_contact":false,"station_io":false}}'|ConvertFrom-Json}else{'{"id":"local-logbook-self-test","ok":false,"error":{"code":"local_self_test_failed"}}'|ConvertFrom-Json}
    $paired.runs+=@{ordinal=$i+1;package=$kind;condition=$condition;status='captured-diagnostic-not-acceptance';sourceCommit=$paired.sourceCommit;workerSHA256=$hash;identityVerifiedBeforeResume=$true;cleanup=@{resumed=$true;abortedBeforeResume=$false};exitConfirmed=$true;timedOut=$false;drainComplete=$true;outputTruncated=$false;stderrTotalBytes=0;responseDeadlineSeconds=10;exitCode=$(if($condition -ceq 'B'){0}else{1});contractPassed=($condition -ceq 'B');parsedReply=$reply;controlledEnvironment=@{TEMP=$temp;TMP=$temp}}
}
Assert-XLogReplayPaired $paired $receipt 'receipt' 'native' $packages $values $working $temp
$checks.Add('actual paired preflight admits complete exact ABA evidence')
foreach($scenario in @('source','incomplete','unstable','identity','exit','order','count','environment','receipt')){
    $copy=$paired | ConvertTo-Json -Depth 40 | ConvertFrom-Json -Depth 40
    switch($scenario){'source'{$copy.sourceCommit='other'};'incomplete'{$copy.maximumRuns=4};'unstable'{$copy.payloadsUnchangedAfterProbes=$false};'identity'{$copy.runs[0].identityVerifiedBeforeResume=$false};'exit'{$copy.runs[0].exitConfirmed=$false};'order'{$copy.runs[0].condition='B'};'count'{$copy.runs[2].parsedReply.result.award_programmes=191};'environment'{$copy.controls.commonNonTempEnvironmentSHA256='other'};'receipt'{$copy.inputProof.installerReceiptSHA256='other'}}
    Reject {Assert-XLogReplayPaired $copy $receipt 'receipt' 'native' $packages $values $working $temp} "actual paired preflight rejects $scenario"
}

function New-ReplayResult([string]$Method,$Params){
    switch($Method){
        'health'{return @{mode='isolated_local_acceptance';platform_services=$false;isolated_workspace=$true;network_contact=$false;credentials_accessed=$false}}
        'workspace_status'{return @{workspace_exists=$false}}
        'workspace_create'{return @{qso_count=0;automatic_sync=$false}}
        'settings_load'{return @{settings=@{logbookMode='local';automaticSync=$false;stationLocation='Synthetic local acceptance'};generation='fixture';revision=0}}
        'settings_save'{return @{settings=$Params.settings}}
        'logbook_import_adif'{return @{imported=1}}
        'logbook_list'{return @{qsos=@(@{id='synthetic-id';comment='';deletedAt=$null});total=$script:liveCount}}
        'logbook_save'{return @{qso=$Params.qso}}
        'logbook_stats'{return @{stats=@{qso_count=1};dxcc_statuses=@{'291'='confirmed'}}}
        'logbook_catalog'{return @{total_programmes=192}}
        'logbook_country_facts'{return @{facts=@{status='resolved';country=@{adif=291}};read_only=$true}}
        'backup_create'{return @{name='round-trip.xlogbackup'}}
        'logbook_delete'{$script:liveCount=0;return @{qso=@{deletedAt='2026-01-01'}}}
        'logbook_undo'{$script:liveCount=1;return @{qso=@{id='synthetic-id'}}} # Codable omits nil deletedAt.
        'backup_restore'{return @{restored=$true}}
        'logbook_export_adif'{return @{text='<APP_FIXTURE:4>KEPT Edited locally'}}
        default{throw "Unexpected method $Method"}
    }
}
$script:seen=[Collections.Generic.List[string]]::new();$script:liveCount=1
Invoke-XLogReplaySequence {param($method,$params,$check) $script:seen.Add($method);$r=New-ReplayResult $method $params|ConvertTo-Json -Depth 20|ConvertFrom-Json -Depth 20;Assert-XLogDiagnostic ([bool](&$check $r)) "Invalid stage fixture $method";return $r}
Check ($script:seen.Count -eq 21 -and $script:seen[10] -ceq 'logbook_catalog' -and $script:seen[20] -ceq 'logbook_export_adif') 'actual21stage sequence accepts owning result shapes'
$script:seen.Clear();$script:liveCount=1
Reject {Invoke-XLogReplaySequence {param($method,$params,$check) $script:seen.Add($method);if($method -ceq 'logbook_catalog'){throw 'catalogue firstfailure'};return (New-ReplayResult $method $params)}} 'actual sequence stops at first failing operation'
Check ($script:seen.Count -eq 11 -and -not $script:seen.Contains('backup_create')) 'no request after first failure'

# Exercise real bounded framing, correlation, assertion and persistent receipts.
$scratch=Join-Path (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) '.build') ('qa-rpc-stage-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $scratch
try{
    foreach($scenario in @('valid','error','wrong-id','wrong-count','oversize','unverified','forbidden')){
        $directory=Join-Path $scratch $scenario;$null=New-Item -ItemType Directory -Path $directory
        $inputWriter=[pscustomobject]@{}
        $inputWriter | Add-Member ScriptMethod WriteLine {
            param($text)
            $request=$text|ConvertFrom-Json
            $reply=@{id=$(if($script:scenario -ceq 'wrong-id'){'wrong'}else{$request.id});ok=($script:scenario -cne 'error');result=@{total_programmes=$(if($script:scenario -ceq 'wrong-count'){191}else{192})}}
            $bytes=[Text.Encoding]::UTF8.GetBytes($(if($script:scenario -ceq 'oversize'){('x'*65537)+"`n"}else{($reply|ConvertTo-Json -Compress)+"`n"}))
            $script:fakeState.process.StandardOutput.BaseStream=[IO.MemoryStream]::new($bytes,$false)
        }
        $inputWriter | Add-Member ScriptMethod Flush {}
        $inputWriter | Add-Member ScriptMethod Close {}
        $script:scenario=$scenario
        $script:fakeState=@{identityVerified=($scenario -cne 'unverified');process=[pscustomobject]@{StandardInput=$inputWriter;StandardOutput=[pscustomobject]@{BaseStream=$null}};clock=[pscustomobject]@{ElapsedMilliseconds=0};directory=$directory;ordinal=0;pending=[Collections.Generic.List[byte]]::new();totalBytes=0;stderrRead=[Threading.Tasks.Task]::FromResult([int]0);stages=[Collections.Generic.List[object]]::new()}
        $method=if($scenario -ceq 'forbidden'){'station_connect'}else{'logbook_catalog'}
        $failed=$false;try{$null=Invoke-XLogReplayStage $script:fakeState $method @{} {param($r) $r.total_programmes -eq 192}}catch{$failed=$true}
        Check ($failed -eq ($scenario -cne 'valid')) "actual RPC stage $scenario outcome"
        if($scenario -in @('unverified','forbidden')){Check ($script:fakeState.ordinal -eq 0 -and $script:fakeState.stages.Count -eq 0) "$scenario rejected before request/output"}
        else{
            $stagePath=Join-Path $directory '01-logbook_catalog'
            $saved=Get-Content (Join-Path $stagePath 'stage.json') -Raw|ConvertFrom-Json
            Check ($saved.status -ceq $(if($scenario -ceq 'valid'){'passed'}else{'failed'}) -and (Test-Path (Join-Path $stagePath 'request.json'))) "$scenario persistent stage receipt"
            if($scenario -cne 'oversize'){Check (Test-Path (Join-Path $stagePath 'reply.bin')) "$scenario raw reply retained before validation"}
        }
    }
    foreach($scenario in @('empty','extra')){
        $directory=Join-Path $scratch ('eof-'+$scenario);$null=New-Item -ItemType Directory -Path $directory
        $bytes=[Text.Encoding]::UTF8.GetBytes($(if($scenario -ceq 'extra'){'unexpected'}else{''}))
        $p=[pscustomobject]@{StandardInput=[pscustomobject]@{};StandardOutput=[pscustomobject]@{BaseStream=[IO.MemoryStream]::new($bytes,$false)};ExitCode=0}
        $p.StandardInput|Add-Member ScriptMethod Close {}
        $p|Add-Member ScriptMethod WaitForExit {param($remaining) return $remaining -eq 10000}
        $state=@{process=$p;clock=[pscustomobject]@{ElapsedMilliseconds=0};directory=$directory;pending=[Collections.Generic.List[byte]]::new();stderrRead=[Threading.Tasks.Task]::FromResult([int]0)}
        $failed=$false;try{Complete-XLogReplay $state}catch{$failed=$true}
        Check ($failed -eq ($scenario -ceq 'extra')) "actual EOF drain $scenario outcome"
        Check ((Get-Item (Join-Path $directory 'extra-stdout.bin')).Length -eq $bytes.Length) "EOF $scenario bounded raw bytes preserved"
    }
    # Execute the real finally block: failed EOF close must not bypass retirement.
    $cleanup=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.TryStatementAst] -and
        $null -ne $n.Finally -and $n.Finally.Extent.Text.Contains('$run.elapsedMs=$clock.ElapsedMilliseconds')},$true))
    Assert-XLogDiagnostic ($cleanup.Count -eq 1) 'Expected one actual owned-child cleanup block.'
    $executeCleanup=[scriptblock]::Create($cleanup[0].Finally.Extent.Text.Trim().Substring(1).TrimEnd().TrimEnd('}'))
    $directory=Join-Path $scratch 'throwing-eof-cleanup';$null=New-Item -ItemType Directory -Path $directory
    $script:retirementCalls=[Collections.Generic.List[string]]::new()
    $process=[pscustomobject]@{StandardInput=[pscustomobject]@{};HasExited=$false;ExitCode=124}
    $process.StandardInput|Add-Member ScriptMethod Close {$script:retirementCalls.Add('close');throw 'synthetic EOF close failure'}
    $process|Add-Member ScriptMethod WaitForExit {param($remaining)
        $script:retirementCalls.Add("wait:$remaining")
        if($remaining -eq 3000){$this.HasExited=$true;return $true}
        return $false
    }
    $process|Add-Member ScriptMethod Kill {$script:retirementCalls.Add('owned-kill')}
    $process|Add-Member ScriptMethod Dispose {$script:retirementCalls.Add('dispose')}
    $run=[ordered]@{pid=123};$clock=[pscustomobject]@{ElapsedMilliseconds=9000};$stderrRead=$null
    $report=@{runs=[Collections.Generic.List[object]]::new()}
    $failure=$null;try{&$executeCleanup}catch{$failure=$_}
    Check ($null -ne $failure -and $failure.Exception.Message -ceq 'Replay owned-child cleanup failed; preserve private run receipt and stop.') 'actual cleanup reports EOF failure after retirement'
    Check (($script:retirementCalls -join ',') -ceq 'close,wait:1000,owned-kill,wait:3000,dispose') 'actual cleanup retains remaining original budget then owned-only timeout retirement and dispose'
    $retained=Get-Content (Join-Path $directory 'run.json') -Raw|ConvertFrom-Json
    Check ($retained.eofCloseError.Contains('synthetic EOF close failure') -and $retained.exitConfirmed -and
        $retained.exitCode -eq 124 -and $retained.ownedTimeoutTermination -and $report.runs.Count -eq 1) 'actual cleanup persists EOF error and confirmed retirement receipt'
}finally{Remove-Item -LiteralPath $scratch -Recurse -Force}
[ordered]@{status='passed';checks=$checks.Count;nativeAPICalls=0;workerLaunches=0;testNames=$checks.ToArray()}|ConvertTo-Json -Depth 8
