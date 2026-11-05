#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Installer,
    [Parameter(Mandatory)][string]$EvidenceDirectory,
    # Hosted Windows CI runs elevated. This permits that narrower test and
    # records ordinary-user/UAC acceptance as NOT RUN rather than a pass.
    [switch]$AllowElevatedHarness
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'windows-installer-policy.ps1')
if (-not $IsWindows) { throw 'Installer acceptance requires native Windows.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$elevated = [Security.Principal.WindowsPrincipal]::new($identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($elevated -and -not $AllowElevatedHarness) { throw 'Run acceptance from an ordinary non-elevated user shell; hosted CI may explicitly use -AllowElevatedHarness.' }
$Installer = (Resolve-Path $Installer).Path
$EvidenceDirectory = [IO.Path]::GetFullPath($EvidenceDirectory)
if (Test-Path $EvidenceDirectory) { throw 'EvidenceDirectory must be new.' }
New-Item -ItemType Directory $EvidenceDirectory | Out-Null
$preserved = Join-Path $env:LOCALAPPDATA "com.oliverbross.xlog.integration/installer-preservation-$([guid]::NewGuid()).txt"
$marker = [guid]::NewGuid().ToString()
$markerCreated = $false
$report = [ordered]@{
    schema = 2; passed = $false; installer = Split-Path $Installer -Leaf
    harnessElevated = $elevated; interactiveUAC = 'NOT RUN (silent harness)'
    ordinaryUserRuntime = 'NOT RUN'; interactiveDefaultPath = 'NOT RUN (silent harness)'
    upgrade = 'NOT RUN'; reinstallRollback = 'NOT RUN'; externalMediaRetention = 'NOT RUN'
}
function Hash([string]$File) { (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant() }
try {
    $provenance = Get-Content -LiteralPath "$Installer.provenance.json" -Raw | ConvertFrom-Json -Depth 20
    if ($provenance.schema -ne 2 -or $provenance.installer -ne (Split-Path $Installer -Leaf) -or
        (Hash $Installer) -ne $provenance.sha256) { throw 'Installer differs from its build provenance.' }
    $policy = Get-XLogInstallerScope $provenance.installation.mode
    foreach ($key in $policy.Keys) {
        if ($provenance.installation.$key -cne $policy[$key]) { throw "Installer scope provenance mismatch: $key" }
    }
    if (-not $Installer.EndsWith("-$($policy.artifactLabel)-setup.exe", [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Installer filename does not identify its declared scope.'
    }
    $installRoot = if ($policy.mode -eq 'currentUser') { $env:LOCALAPPDATA } else { $env:ProgramW6432 }
    if (-not $installRoot -or -not [Environment]::Is64BitOperatingSystem) { throw 'Acceptance requires x64 Windows known folders.' }
    $install = Join-Path $installRoot 'OM0RX-xLog'
    if (Test-Path -LiteralPath $install) { throw 'Default installation directory already exists; preserve it and use a disposable Windows account/VM.' }
    $shortcut = Join-Path ([Environment]::GetFolderPath($policy.startMenu)) 'OM0RX-xLog.lnk'
    foreach ($folder in @('Programs', 'CommonPrograms', 'DesktopDirectory', 'CommonDesktopDirectory')) {
        $existingShortcut = Join-Path ([Environment]::GetFolderPath($folder)) 'OM0RX-xLog.lnk'
        if (Test-Path -LiteralPath $existingShortcut) { throw 'An existing xLog shortcut must be preserved; use a disposable Windows account/VM.' }
    }
    $registryKey = "$($policy.registryHive):\Software\Microsoft\Windows\CurrentVersion\Uninstall\OM0RX-xLog"
    $otherHive = if ($policy.registryHive -eq 'HKCU') { 'HKLM' } else { 'HKCU' }
    $otherRegistryKey = "${otherHive}:\Software\Microsoft\Windows\CurrentVersion\Uninstall\OM0RX-xLog"
    $existing = @(foreach ($key in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
        Get-ItemProperty $key -ErrorAction SilentlyContinue | Where-Object {
            $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -match '^OM0RX-xLog(?:\s|$)'
        }
    })
    if ($existing.Count) { throw 'Installer acceptance requires a fresh Windows user with no existing OM0RX-xLog installation.' }
    $tauriConfiguration = Get-Content (Join-Path $PSScriptRoot '../src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json -Depth 30
    # An uninstalled old custom location can survive every check above and cause
    # NSIS to write there before our default-path assertion. Never clear it.
    Assert-XLogFreshInstallerLocations -Configuration $tauriConfiguration
    New-Item -ItemType Directory -Force (Split-Path $preserved) | Out-Null
    [IO.File]::WriteAllText($preserved, $marker)
    $markerCreated = $true
    $report.version = $provenance.version
    $report.sourceCommit = $provenance.sourceCommit
    $report.installerSHA256 = $provenance.sha256
    $report.installationScope = $policy.mode
    $report.expectedDefaultDirectory = $install
    $report.registryHive = $policy.registryHive
    $report.payloadManifestSHA256 = $provenance.payloadManifestSHA256
    # No /D override: exercise the installer's real resolved default.
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Installer
    $info.Arguments = '/S'
    $info.UseShellExecute = $policy.requiresAdministrator -and -not $elevated
    if ($info.UseShellExecute) { $info.Verb = 'runas' }
    $process = [Diagnostics.Process]::Start($info)
    if (-not $process.WaitForExit(180000) -or $process.ExitCode -ne 0) { throw 'NSIS installation failed or timed out.' }
    $process.Dispose()
    if (-not (Test-Path (Join-Path $install 'xlog-prototype.exe'))) { throw 'Installed main executable is missing.' }
    $registration = Get-ItemProperty -LiteralPath $registryKey -ErrorAction Stop
    if ($registration.DisplayVersion -ne $provenance.version -or
        $registration.UninstallString -notlike "*$install*" -or (Test-Path -LiteralPath $otherRegistryKey)) {
        throw 'Uninstall registration version/path/scope differs from the installer.'
    }
    if (-not (Test-Path -LiteralPath $shortcut)) { throw 'Expected scope-specific Start Menu shortcut is missing.' }
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($shortcut)
    if (-not $link.TargetPath.Equals((Join-Path $install 'xlog-prototype.exe'), [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Start Menu shortcut does not launch the accepted installed executable.'
    }
    $report.actualDirectory = $install
    $report.shortcutTarget = $link.TargetPath
    $report.defaultPathPassed = $true
    $report.registryScopePassed = $true
    $report.startMenuScopePassed = $true
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
    if (-not $elevated) { $report.ordinaryUserRuntime = 'PASS (non-elevated harness child)' }
    $uninstaller = Join-Path $install 'uninstall.exe'
    if (-not (Test-Path -LiteralPath $uninstaller)) { throw 'NSIS uninstaller is missing.' }
    $uninstallArguments = @{ FilePath = $uninstaller; ArgumentList = '/S'; PassThru = $true; Wait = $true }
    if ($policy.requiresAdministrator -and -not $elevated) { $uninstallArguments.Verb = 'runas' }
    $uninstall = Start-Process @uninstallArguments
    if ($uninstall.ExitCode -ne 0) { throw 'NSIS uninstallation failed.' }
    $ownedPaths = @($installedManifest.files | ForEach-Object { $_.path }) + @('payload-manifest.json', 'uninstall.exe')
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    $remaining = @($ownedPaths | Where-Object { Test-Path -LiteralPath (Join-Path $install $_) })
    while ($remaining.Count -gt 0 -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 200
        $remaining = @($ownedPaths | Where-Object { Test-Path -LiteralPath (Join-Path $install $_) })
    }
    if ($remaining.Count) { throw 'Uninstaller retained installed payload files.' }
    if ((Test-Path -LiteralPath $registryKey) -or (Test-Path -LiteralPath $shortcut)) {
        throw 'Uninstaller retained its uninstall registration or Start Menu shortcut.'
    }
    if (-not (Test-Path $preserved) -or [IO.File]::ReadAllText($preserved) -ne $marker) {
        throw 'Uninstall removed or changed user-profile data.'
    }
    $report.passed = $true
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
