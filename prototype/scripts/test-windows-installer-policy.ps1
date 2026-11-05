#Requires -Version 7.0
# Host-independent scope contract; not Windows acceptance.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'windows-installer-policy.ps1')
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
$resources = @{ 'C:/audited/worker.exe' = 'worker.exe'; 'C:/audited/payload-manifest.json' = 'payload-manifest.json' }
$user = Get-XLogInstallerScope currentUser
$machine = Get-XLogInstallerScope perMachine
Assert (-not $user.requiresAdministrator -and $user.executionLevel -eq 'user' -and $user.registryHive -eq 'HKCU') 'Current-user install must not require elevation.'
Assert ($machine.requiresAdministrator -and $machine.executionLevel -eq 'admin' -and $machine.registryHive -eq 'HKLM') 'All-users install must require elevation.'
Assert ($user.artifactLabel -ne $machine.artifactLabel) 'Scopes need distinct artifact identities.'
Assert ($user.defaultDirectory -eq '%LOCALAPPDATA%\OM0RX-xLog') 'Unexpected per-user default.'
Assert ($machine.defaultDirectory -eq '%ProgramFiles%\OM0RX-xLog') 'Unexpected all-users default.'
foreach ($scope in @('currentUser', 'perMachine')) {
    $config = New-XLogInstallerConfiguration -Scope $scope -Resources $resources
    $json = $config | ConvertTo-Json -Depth 20 | ConvertFrom-Json -Depth 20
    Assert ($json.bundle.windows.nsis.installMode -ceq $scope) 'Scope lost in Tauri JSON.'
    Assert ($json.bundle.externalBin.Count -eq 0) 'Audited helpers must not be restaged from build outputs.'
    Assert ($json.bundle.resources.'C:/audited/worker.exe' -ceq 'worker.exe') 'Audited resource mapping changed.'
}
$rejected = $false
try { $null = New-XLogInstallerConfiguration -Scope both -Resources $resources } catch { $rejected = $true }
Assert $rejected 'The elevating both mode must not be accepted as a no-admin route.'
$configuration = Get-Content (Join-Path $PSScriptRoot '../src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json -Depth 30
$locationKeys = @(Get-XLogInstallerLocationKeys $configuration)
Assert ($locationKeys.Count -eq 2 -and $locationKeys[0] -ceq 'HKCU:\Software\oliverbross\OM0RX-xLog' -and
    $locationKeys[1] -ceq 'HKLM:\Software\oliverbross\OM0RX-xLog') 'Installer-location keys differ from pinned Tauri manufacturer/product derivation.'
foreach ($retainedKey in $locationKeys) {
    $script:locations = @{ $retainedKey = 'D:\retained custom install' }
    $launched = $false; $rejected = $false
    try {
        Assert-XLogFreshInstallerLocations -Configuration $configuration -ReadLocation { param($Key) $script:locations[$Key] }
        $launched = $true
    } catch { $rejected = $true }
    Assert ($rejected -and -not $launched) 'A retained location must reject acceptance before installer launch, even without files/uninstall registration.'
    Assert ($script:locations[$retainedKey] -ceq 'D:\retained custom install') 'Freshness checks must preserve the old location.'
}
Assert-XLogFreshInstallerLocations -Configuration $configuration -ReadLocation { param($Key) $null }
$publisherConfiguration = '{"identifier":"com.example.app","productName":"Fixture","bundle":{"publisher":"Explicit publisher"}}' | ConvertFrom-Json
Assert ((Get-XLogInstallerLocationKeys $publisherConfiguration)[0] -ceq 'HKCU:\Software\Explicit publisher\Fixture') 'Explicit publisher must override identifier-derived manufacturer.'
Write-Host 'PASS: installer scope policy (native Windows installation NOT RUN).'
