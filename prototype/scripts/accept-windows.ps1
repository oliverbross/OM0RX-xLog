#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$PackageDirectory,
    [string]$EvidenceDirectory,
    [switch]$RequireNoSwiftToolchain,
    [int]$ResponseTimeoutSeconds = 10,
    [int]$GuiTimeoutSeconds = 100
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'Acceptance must run on native Windows.' }
$PackageDirectory = (Resolve-Path $PackageDirectory).Path
if (-not $EvidenceDirectory) {
    $EvidenceDirectory = Join-Path ([IO.Path]::GetTempPath()) "xlog-windows-acceptance-$([guid]::NewGuid())"
}
$EvidenceDirectory = [IO.Path]::GetFullPath($EvidenceDirectory)
if (Test-Path $EvidenceDirectory) { throw 'EvidenceDirectory must be new; acceptance never overwrites previous evidence.' }
New-Item -ItemType Directory -Path $EvidenceDirectory | Out-Null
$profileDirectory = Join-Path $EvidenceDirectory 'synthetic-profile'
foreach ($suffix in @('', 'AppData/Local', 'AppData/Roaming', 'Temp')) {
    New-Item -ItemType Directory -Path (Join-Path $profileDirectory $suffix) -Force | Out-Null
}
$checks = [Collections.Generic.List[object]]::new()
$report = [ordered]@{ schema = 1; status = 'running'; platform = 'windows'; package = $PackageDirectory; startedUtc = [DateTime]::UtcNow.ToString('o'); checks = @(); limitations = @('GitHub Windows Server native acceptance is not Windows 11 consumer desktop acceptance.', 'Evergreen WebView2 is a declared installed-runtime prerequisite.', 'Unsigned internal prototype; no station, remote host, credentials or stable app is touched.') }
$script:bundledNames = @{}

function Write-Json([string]$Path, $Value) {
    $Value | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $Path -Encoding utf8NoBOM
}
function Assert-That([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Record-Check([string]$Name, $Evidence) { $checks.Add([pscustomobject]@{ name = $Name; passed = $true; evidence = $Evidence }) }
function Hash([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Inside([string]$Path, [string]$Directory) {
    return [IO.Path]::GetFullPath($Path).StartsWith(([IO.Path]::GetFullPath($Directory).TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)
}
function Start-Isolated([string]$Name, [string[]]$Arguments = @()) {
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = Join-Path $PackageDirectory $Name
    $info.WorkingDirectory = $profileDirectory
    $info.UseShellExecute = $false
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
    $info.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
    $info.CreateNoWindow = $false
    foreach ($argument in $Arguments) { $info.ArgumentList.Add($argument) }
    foreach ($name in @($info.Environment.Keys)) {
        if ($name -match '^(SWIFT|SDKROOT$|DEVELOPER_DIR$|VCTools|VCINSTALL|VCPKG|XLOG_|CARGO|RUST|NODE|NPM|LIB$|LIBPATH$|INCLUDE$|WEBVIEW2_)') { $null = $info.Environment.Remove($name) }
    }
    $info.Environment['PATH'] = "$PackageDirectory;$env:SystemRoot\System32;$env:SystemRoot"
    $info.Environment['USERPROFILE'] = $profileDirectory
    $info.Environment['APPDATA'] = Join-Path $profileDirectory 'AppData/Roaming'
    $info.Environment['LOCALAPPDATA'] = Join-Path $profileDirectory 'AppData/Local'
    $info.Environment['TEMP'] = Join-Path $profileDirectory 'Temp'
    $info.Environment['TMP'] = Join-Path $profileDirectory 'Temp'
    $info.Environment['WEBVIEW2_USER_DATA_FOLDER'] = Join-Path $profileDirectory 'WebView2'
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    Assert-That ($process.Start()) "Failed to launch $Name."
    return $process
}
function Wait-Task($Task, [int]$Seconds, [string]$Message) {
    if (-not $Task.Wait([TimeSpan]::FromSeconds($Seconds))) { throw $Message }
    return $Task.GetAwaiter().GetResult()
}
function Read-Response($Process) {
    $line = Wait-Task ($Process.StandardOutput.ReadLineAsync()) $ResponseTimeoutSeconds 'Worker did not respond while stdin was open (or runtime loader failed).'
    Assert-That ($null -ne $line) 'Worker closed stdout unexpectedly.'
    Assert-That ([Text.Encoding]::UTF8.GetByteCount($line) + 1 -le 65536) 'Worker response exceeded byte limit.'
    return $line | ConvertFrom-Json -Depth 30
}
function Send-Request($Process, [string]$Id, [string]$Method, $Params) {
    $request = @{ id = $Id; method = $Method; params = $Params } | ConvertTo-Json -Depth 20 -Compress
    $Process.StandardInput.WriteLine($request)
    $Process.StandardInput.Flush()
    return Read-Response $Process
}
function Finish-Worker($Process, $StderrTask) {
    $Process.StandardInput.Close()
    Assert-That ($Process.WaitForExit($ResponseTimeoutSeconds * 1000)) 'Worker did not shut down after EOF.'
    $stderr = Wait-Task $StderrTask $ResponseTimeoutSeconds 'Worker stderr did not close.'
    Assert-That ($Process.ExitCode -eq 0) "Worker exit code $($Process.ExitCode); $stderr"
    Assert-That ([string]::IsNullOrEmpty($stderr)) "Unexpected worker stderr: $stderr"
    Assert-That ([string]::IsNullOrEmpty($Process.StandardOutput.ReadToEnd())) 'Unexpected extra/unframed worker output.'
}
function Record-Modules($Process, [string]$Label, [switch]$RequireWorkerRuntime) {
    $Process.Refresh()
    $modules = @($Process.Modules | ForEach-Object {
        [pscustomobject]@{ name = $_.ModuleName.ToLowerInvariant(); path = $_.FileName; fileVersion = $_.FileVersionInfo.FileVersion; sha256 = Hash $_.FileName }
    } | Sort-Object path)
    Write-Json (Join-Path $EvidenceDirectory "$Label-modules.json") $modules
    foreach ($module in $modules) {
        if ($script:bundledNames.ContainsKey($module.name)) {
            Assert-That (Inside $module.path $PackageDirectory) "Bundled module $($module.name) loaded from outside the portable package: $($module.path)"
            Assert-That ($module.sha256 -eq $script:bundledNames[$module.name]) "Loaded module hash differs from package: $($module.name)"
        } else {
            $fromWindows = Inside $module.path $env:SystemRoot
            $isEvergreen = $module.path -match '(?i)[\\/]Microsoft[\\/]EdgeWebView[\\/]Application[\\/]'
            Assert-That ($fromWindows -or $isEvergreen) "Unaccounted external module: $($module.path)"
        }
    }
    if ($RequireWorkerRuntime) {
        foreach ($name in @('swiftcore.dll', 'sqlite3.dll')) {
            Assert-That (@($modules | Where-Object name -eq $name).Count -eq 1) "Loaded worker runtime evidence is missing $name."
        }
    }
    Record-Check "$Label-module-origins" @{ count = $modules.Count; manifest = "$Label-modules.json"; appLocalRequired = [bool]$RequireWorkerRuntime }
}
function Capture-Desktop([string]$Label) {
    try {
        Add-Type -AssemblyName System.Drawing.Common
        if (-not ('XLogAcceptanceScreen' -as [type])) {
            Add-Type @'
using System.Runtime.InteropServices;
public static class XLogAcceptanceScreen {
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
}
'@
        }
        $width = [XLogAcceptanceScreen]::GetSystemMetrics(0)
        $height = [XLogAcceptanceScreen]::GetSystemMetrics(1)
        Assert-That ($width -gt 0 -and $height -gt 0) 'No interactive screen dimensions are available.'
        $bitmap = [Drawing.Bitmap]::new($width, $height)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.CopyFromScreen(0, 0, 0, 0, $bitmap.Size)
            $path = Join-Path $EvidenceDirectory "$Label-desktop.png"
            $bitmap.Save($path, [Drawing.Imaging.ImageFormat]::Png)
            return @{ status = 'captured'; path = "$Label-desktop.png"; width = $width; height = $height; sha256 = Hash $path; limitation = 'Full native CI desktop image; inspect for actual application rendering.' }
        } finally { $graphics.Dispose(); $bitmap.Dispose() }
    } catch {
        return @{ status = 'unavailable'; reason = $_.Exception.Message; limitation = 'No screenshot claim. Manual Windows desktop rendering remains required.' }
    }
}

try {
    $manifest = Get-Content (Join-Path $PackageDirectory 'payload-manifest.json') -Raw | ConvertFrom-Json -Depth 30
    $provenance = Get-Content (Join-Path $PackageDirectory 'provenance.json') -Raw | ConvertFrom-Json -Depth 30
    Assert-That ($manifest.schema -eq 1 -and $provenance.schema -eq 1) 'Unknown package manifest schema.'
    $report.commit = $provenance.commit
    $report.os = @{ description = [Runtime.InteropServices.RuntimeInformation]::OSDescription; version = [Environment]::OSVersion.VersionString; architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString(); powershell = $PSVersionTable.PSVersion.ToString(); runnerImage = $env:ImageOS; runnerImageVersion = $env:ImageVersion }
    foreach ($file in $manifest.files) {
        $path = [IO.Path]::GetFullPath((Join-Path $PackageDirectory $file.path))
        Assert-That (Inside $path $PackageDirectory) 'Manifest path escapes package.'
        Assert-That (Test-Path -LiteralPath $path -PathType Leaf) "Manifest payload missing: $($file.path)"
        Assert-That ((Hash $path) -eq $file.sha256) "Manifest hash mismatch: $($file.path)"
        Assert-That ((Get-Item $path).Length -eq $file.bytes) "Manifest byte count mismatch: $($file.path)"
        if ($file.path -notmatch '[/\\]' -and $file.path -match '\.(exe|dll)$') { $script:bundledNames[$file.path.ToLowerInvariant()] = $file.sha256 }
    }
    $actual = @(Get-ChildItem $PackageDirectory -Recurse -File | Where-Object Name -ne 'payload-manifest.json')
    Assert-That ($actual.Count -eq @($manifest.files).Count) 'Unmanifested files are present in the package.'
    Record-Check 'payload-hashes' @{ files = @($manifest.files).Count; manifestSha256 = Hash (Join-Path $PackageDirectory 'payload-manifest.json') }

    # Probe before changing any child environment. PATH isolation is not a claim
    # that toolchains were absent from the underlying hosted runner image.
    $commands = @{}
    foreach ($name in @('swift', 'swiftc', 'node', 'rustc', 'cargo', 'vcpkg', 'dumpbin')) {
        $commands[$name] = @(Get-Command $name -ErrorAction SilentlyContinue | ForEach-Object Source)
    }
    $swiftDirectories = @(
        (Join-Path $env:ProgramFiles 'Swift'),
        (Join-Path ${env:ProgramFiles(x86)} 'Swift'),
        (Join-Path $env:LOCALAPPDATA 'Programs/Swift'),
        'C:\Library\Developer\Toolchains'
    ) | Where-Object { Test-Path $_ }
    $swiftInstallations = @(foreach ($key in @('HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
        Get-ItemProperty $key -ErrorAction SilentlyContinue | Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -match '^Swift( |$)' } | Select-Object DisplayName, DisplayVersion, InstallLocation
    })
    $swiftAbsent = $commands.swift.Count -eq 0 -and $commands.swiftc.Count -eq 0 -and @($swiftDirectories).Count -eq 0 -and $swiftInstallations.Count -eq 0 -and [string]::IsNullOrEmpty($env:SDKROOT)
    $report.toolchains = @{ commandsBeforeIsolation = $commands; swiftKnownDirectories = @($swiftDirectories); swiftRegisteredInstallations = $swiftInstallations; swiftAbsentFromProbes = $swiftAbsent; absenceLimit = 'Command lookup, conventional installation paths and uninstall registry checked; not an exhaustive disk scan.' }
    if ($RequireNoSwiftToolchain) { Assert-That $swiftAbsent 'Swift toolchain detected before isolation; this is not a fresh no-Swift acceptance job.' }
    $report.isolation = @{ childPath = "$PackageDirectory;$env:SystemRoot\System32;$env:SystemRoot"; workingDirectory = $profileDirectory; childProfile = $profileDirectory; developerEnvironmentRemoved = $true; parentEnvironmentChanged = $false }
    Record-Check 'native-isolation' @{ noSwiftRequired = [bool]$RequireNoSwiftToolchain; swiftAbsentFromProbes = $swiftAbsent }

    $webview = @(foreach ($key in @('HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}')) {
        $entry = Get-ItemProperty $key -ErrorAction SilentlyContinue
        if ($entry -and $entry.PSObject.Properties['pv'] -and $entry.pv -and $entry.pv -ne '0.0.0.0') { [pscustomobject]@{ registry = $key; version = $entry.pv } }
    })
    $report.webview = @{ installed = $webview.Count -gt 0; installations = $webview; mode = 'Evergreen prerequisite; acceptance does not install it' }
    Assert-That ($webview.Count -gt 0) 'Microsoft Evergreen WebView2 Runtime is missing; use its official installer before testing this portable prototype.'
    Record-Check 'webview-prerequisite' $webview

    $worker = Start-Isolated 'xlog-prototype-worker.exe'
    try {
        $stderrTask = $worker.StandardError.ReadToEndAsync()
        $health = Send-Request $worker 'one' 'health' @{}
        Assert-That ($health.id -eq 'one' -and $health.ok -eq $true -and $health.result.platform -eq 'Windows' -and $health.result.mode -eq 'synthetic_only' -and $health.result.station_io -eq $false) 'Health contract failed.'
        $fragment = @{ id = 'two'; method = 'parse_adif'; params = @{ text = '<CALL:5>TEST1<QSO_DATE:8>20260101<TIME_ON:6>120000<BAND:3>20m<MODE:2>CW<EOR>' } } | ConvertTo-Json -Compress
        $worker.StandardInput.Write($fragment.Substring(0, 17)); $worker.StandardInput.Flush()
        $worker.StandardInput.WriteLine($fragment.Substring(17)); $worker.StandardInput.Flush()
        $parsed = Read-Response $worker
        Assert-That ($parsed.id -eq 'two' -and $parsed.ok -eq $true -and $parsed.result.record_count -eq 1 -and $parsed.result.records[0].qso.call -eq 'TEST1') 'Fragmented synthetic ADIF contract failed.'
        $selfTest = Send-Request $worker 'three' 'self_test' @{}
        Assert-That ($selfTest.id -eq 'three' -and $selfTest.ok -eq $true -and $selfTest.result.passed -eq $true -and $selfTest.result.network_contact -eq $false -and $selfTest.result.station_io -eq $false -and $selfTest.result.file_io -eq $false) 'Synthetic self_test contract failed.'
        Write-Json (Join-Path $EvidenceDirectory 'worker-valid-responses.json') @($health, $parsed, $selfTest)
        Record-Modules $worker 'worker-valid' -RequireWorkerRuntime
        Finish-Worker $worker $stderrTask
        Record-Check 'ndjson-open-stdin-fragment-correlation' @{ responses = 3; methods = @('health', 'parse_adif', 'self_test'); shutdown = 'EOF exit 0'; syntheticOnly = $true }
    } finally { if (-not $worker.HasExited) { $worker.Kill($true) }; $worker.Dispose() }

    $worker = Start-Isolated 'xlog-prototype-worker.exe'
    try {
        $stderrTask = $worker.StandardError.ReadToEndAsync()
        $worker.StandardInput.WriteLine('bad JSON')
        $worker.StandardInput.WriteLine(('x' * 32769))
        $worker.StandardInput.WriteLine('{"id":"recovered","method":"health","params":{}}')
        $worker.StandardInput.Flush()
        $responses = @((Read-Response $worker), (Read-Response $worker), (Read-Response $worker))
        Assert-That ($responses[0].ok -eq $false -and $responses[0].error.code -eq 'invalid_request') 'Malformed framing did not fail as expected.'
        Assert-That ($responses[1].ok -eq $false -and $responses[1].error.code -eq 'request_too_large') 'Oversized framing did not fail as expected.'
        Assert-That ($responses[2].id -eq 'recovered' -and $responses[2].ok -eq $true) 'Framing recovery failed.'
        Write-Json (Join-Path $EvidenceDirectory 'worker-recovery-responses.json') $responses
        Finish-Worker $worker $stderrTask
        Record-Check 'ndjson-malformed-oversized-recovery' @{ responses = 3; shutdown = 'EOF exit 0' }
    } finally { if (-not $worker.HasExited) { $worker.Kill($true) }; $worker.Dispose() }

    $worker = Start-Isolated 'xlog-prototype-worker.exe' @('--self-test')
    try {
        $stderrTask = $worker.StandardError.ReadToEndAsync()
        $response = Read-Response $worker
        Assert-That ($response.id -eq 'self-test' -and $response.ok -eq $true -and $response.result.passed -eq $true) 'Worker --self-test failed.'
        Finish-Worker $worker $stderrTask
        Write-Json (Join-Path $EvidenceDirectory 'worker-self-test.json') $response
        Record-Check 'worker-cli-self-test' @{ shutdown = 'exit 0'; syntheticOnly = $true }
    } finally { if (-not $worker.HasExited) { $worker.Kill($true) }; $worker.Dispose() }

    $guiReports = @()
    foreach ($run in 1..2) {
        $label = "gui-run-$run"
        $guiPath = Join-Path $EvidenceDirectory "$label.json"
        $gui = Start-Isolated 'xlog-prototype.exe' @('--acceptance-report', $guiPath)
        try {
            $stdoutTask = $gui.StandardOutput.ReadToEndAsync(); $stderrTask = $gui.StandardError.ReadToEndAsync()
            $deadline = [DateTime]::UtcNow.AddSeconds($GuiTimeoutSeconds)
            $guiReport = $null
            while ([DateTime]::UtcNow -lt $deadline) {
                if (Test-Path $guiPath) {
                    try { $guiReport = Get-Content $guiPath -Raw | ConvertFrom-Json -Depth 30 } catch { $guiReport = $null }
                    if ($guiReport) { break }
                }
                if ($gui.HasExited) { break }
                Start-Sleep -Milliseconds 100
            }
            if (-not $gui.HasExited) {
                $screenshot = Capture-Desktop $label
                if (-not $gui.HasExited) { Record-Modules $gui $label }
            } else { $screenshot = @{ status = 'unavailable'; reason = 'GUI exited before capture'; limitation = 'Manual Windows desktop rendering remains required.' } }
            $remaining = [Math]::Max(1, [int]($deadline - [DateTime]::UtcNow).TotalMilliseconds)
            Assert-That ($gui.WaitForExit($remaining)) "GUI acceptance timed out on run $run."
            $stdout = Wait-Task $stdoutTask 10 'GUI stdout did not close.'
            $stderr = Wait-Task $stderrTask 10 'GUI stderr did not close.'
            $stdout | Set-Content (Join-Path $EvidenceDirectory "$label-stdout.txt") -Encoding utf8NoBOM
            $stderr | Set-Content (Join-Path $EvidenceDirectory "$label-stderr.txt") -Encoding utf8NoBOM
            Write-Json (Join-Path $EvidenceDirectory "$label-screenshot.json") $screenshot
            Assert-That ($gui.ExitCode -eq 0) "GUI acceptance exited $($gui.ExitCode) on run $run; inspect stderr evidence."
            Assert-That ($null -ne $guiReport) "GUI did not produce an acceptance report on run $run."
            Assert-That ($guiReport.schema -eq 1 -and $guiReport.status -eq 'passed' -and $guiReport.embeddedUi -eq $true -and $guiReport.worker -eq $true) "GUI-to-worker acceptance contract failed on run $run."
            $nativeChecks = @($guiReport.checks.PSObject.Properties)
            Assert-That ($nativeChecks.Count -gt 0) 'GUI report contains no native acceptance checks.'
            foreach ($check in $nativeChecks) { Assert-That ($check.Value -eq $true) "GUI native check failed: $($check.Name)" }
            $guiReports += $guiReport
            Record-Check $label @{ exit = 0; nativeChecks = $nativeChecks.Count; report = "$label.json"; reportSha256 = Hash $guiPath; screenshot = $screenshot }
        } finally { if (-not $gui.HasExited) { $gui.Kill($true) }; $gui.Dispose() }
    }
    $report.guiReports = $guiReports
    $report.status = 'passed'
    $report.embeddedUi = $true
    $report.worker = $true
    $report.workerRegressionTests = 2
    $report.guiLaunches = 2
    $report.manualWindows11DesktopAcceptance = 'pending user download/launch; no remote deployment performed'
} catch {
    $report.status = 'failed'
    $report.error = $_.Exception.Message
    throw
} finally {
    $report.checks = $checks.ToArray()
    $report.finishedUtc = [DateTime]::UtcNow.ToString('o')
    Write-Json (Join-Path $EvidenceDirectory 'acceptance.json') $report
    Write-Host "Windows acceptance evidence: $EvidenceDirectory ($($report.status))"
}
