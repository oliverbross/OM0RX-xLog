#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Installer,
    [Parameter(Mandatory)][string]$EvidenceDirectory
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'Installer acceptance requires native Windows.' }
$Installer = (Resolve-Path $Installer).Path
$EvidenceDirectory = [IO.Path]::GetFullPath($EvidenceDirectory)
if (Test-Path $EvidenceDirectory) { throw 'EvidenceDirectory must be new.' }
New-Item -ItemType Directory $EvidenceDirectory | Out-Null
$install = Join-Path $EvidenceDirectory 'installed application'
$preserved = Join-Path $env:LOCALAPPDATA "com.oliverbross.xlog.integration/installer-preservation-$([guid]::NewGuid()).txt"
$marker = [guid]::NewGuid().ToString()
$markerCreated = $false
$report = [ordered]@{ schema = 1; passed = $false; installer = Split-Path $Installer -Leaf }
function Hash([string]$File) { (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant() }
try {
    $provenance = Get-Content -LiteralPath "$Installer.provenance.json" -Raw | ConvertFrom-Json -Depth 20
    if ($provenance.schema -ne 1 -or $provenance.installer -ne (Split-Path $Installer -Leaf) -or
        (Hash $Installer) -ne $provenance.sha256) { throw 'Installer differs from its build provenance.' }
    $existing = @(foreach ($key in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
        Get-ItemProperty $key -ErrorAction SilentlyContinue | Where-Object {
            $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -match '^OM0RX-xLog(?:\s|$)'
        }
    })
    if ($existing.Count) { throw 'Installer acceptance requires a fresh Windows user with no existing OM0RX-xLog installation.' }
    New-Item -ItemType Directory -Force (Split-Path $preserved) | Out-Null
    [IO.File]::WriteAllText($preserved, $marker)
    $markerCreated = $true
    $report.version = $provenance.version
    $report.sourceCommit = $provenance.sourceCommit
    $report.installerSHA256 = $provenance.sha256
    # NSIS consumes /D as the final raw argument, including a directory with spaces.
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Installer
    $info.Arguments = "/S /D=$install"
    $info.UseShellExecute = $false
    $process = [Diagnostics.Process]::Start($info)
    if (-not $process.WaitForExit(180000) -or $process.ExitCode -ne 0) { throw 'NSIS installation failed or timed out.' }
    $process.Dispose()
    if (-not (Test-Path (Join-Path $install 'xlog-prototype.exe'))) { throw 'Installed main executable is missing.' }
    if ((Hash (Join-Path $install 'payload-manifest.json')) -ne $provenance.payloadManifestSHA256 -or
        (Hash (Join-Path $install 'xlog-prototype.exe')) -ne $provenance.mainExecutableSHA256) {
        throw 'Installed payload differs from the audited portable payload.'
    }
    $installedManifest = Get-Content -LiteralPath (Join-Path $install 'payload-manifest.json') -Raw | ConvertFrom-Json -Depth 30
    $acceptArguments = @{
        PackageDirectory = $install
        EvidenceDirectory = Join-Path $EvidenceDirectory 'native-runtime'
        RequireNoSwiftToolchain = $true
        Installed = $true
    }
    & (Join-Path $PSScriptRoot 'accept-windows.ps1') @acceptArguments
    # PowerShell script failures throw; LASTEXITCODE belongs to native commands.
    $runtimeReport = Get-Content -LiteralPath (Join-Path $EvidenceDirectory 'native-runtime/acceptance.json') -Raw | ConvertFrom-Json -Depth 30
    if ($runtimeReport.status -ne 'passed') { throw 'Installed runtime acceptance failed.' }
    $uninstaller = Join-Path $install 'uninstall.exe'
    if (-not (Test-Path -LiteralPath $uninstaller)) { throw 'NSIS uninstaller is missing.' }
    $uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/S' -PassThru -Wait
    if ($uninstall.ExitCode -ne 0) { throw 'NSIS uninstallation failed.' }
    $ownedPaths = @($installedManifest.files | ForEach-Object { $_.path }) + @('payload-manifest.json', 'uninstall.exe')
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    $remaining = @($ownedPaths | Where-Object { Test-Path -LiteralPath (Join-Path $install $_) })
    while ($remaining.Count -gt 0 -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 200
        $remaining = @($ownedPaths | Where-Object { Test-Path -LiteralPath (Join-Path $install $_) })
    }
    if ($remaining.Count) { throw 'Uninstaller retained installed payload files.' }
    if (-not (Test-Path $preserved) -or [IO.File]::ReadAllText($preserved) -ne $marker) {
        throw 'Uninstall removed or changed user-profile data.'
    }
    $report.passed = $true
    $report.installDirectoryWithSpaces = $true
    $report.nativeRuntimePassed = $true
    $report.uninstallPassed = $true
    $report.userProfilePreserved = $true
    $report.preservationScope = 'Harness-owned marker in current-user LocalAppData; existing logbooks and account settings were not read'
} catch {
    $report.error = $_.Exception.Message
    throw
} finally {
    if ($markerCreated -and (Test-Path -LiteralPath $preserved)) { Remove-Item -LiteralPath $preserved }
    $report | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $EvidenceDirectory 'installer-acceptance.json') -Encoding utf8NoBOM
}
