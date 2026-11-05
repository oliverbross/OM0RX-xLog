# Shared by packaging and native acceptance; no platform operations at import.
function Get-XLogInstallerLocationKeys {
    param([Parameter(Mandatory)]$Configuration)
    # tauri-cli-v2.12.2 nsis/mod.rs: explicit publisher, otherwise identifier's
    # second component. installer.nsi retains MANUPRODUCTKEY's default location
    # when uninstalling without Delete app data, and restores it on next install.
    $publisher = $Configuration.bundle.PSObject.Properties['publisher']
    $manufacturer = if ($publisher -and $null -ne $publisher.Value) { [string]$publisher.Value } else {
        $identifier = [string]$Configuration.identifier
        $parts = $identifier.Split('.')
        if ($parts.Count -gt 1) { $parts[1] } else { $identifier }
    }
    $path = "Software\$manufacturer\$($Configuration.productName)"
    return @("HKCU:\$path", "HKLM:\$path")
}

function Assert-XLogFreshInstallerLocations {
    param(
        [Parameter(Mandatory)]$Configuration,
        [scriptblock]$ReadLocation = {
            param($Key)
            if (Test-Path -LiteralPath $Key -ErrorAction Stop) {
                (Get-Item -LiteralPath $Key -ErrorAction Stop).GetValue('')
            }
        }
    )
    foreach ($key in (Get-XLogInstallerLocationKeys $Configuration)) {
        $location = & $ReadLocation $key
        if (-not [string]::IsNullOrEmpty([string]$location)) {
            throw "Retained installer location exists at $key; preserve it and use a fresh disposable Windows account/VM."
        }
    }
}

function Get-XLogInstallerScope {
    param([Parameter(Mandatory)][ValidateSet('currentUser', 'perMachine')][string]$Scope)
    if ($Scope -eq 'currentUser') {
        return @{
            mode = $Scope; artifactLabel = 'current-user'; executionLevel = 'user'
            defaultDirectory = '%LOCALAPPDATA%\OM0RX-xLog'; registryHive = 'HKCU'
            startMenu = 'Programs'; requiresAdministrator = $false
        }
    }
    return @{
        mode = $Scope; artifactLabel = 'all-users'; executionLevel = 'admin'
        defaultDirectory = '%ProgramFiles%\OM0RX-xLog'; registryHive = 'HKLM'
        startMenu = 'CommonPrograms'; requiresAdministrator = $true
    }
}

function New-XLogInstallerConfiguration {
    param(
        [Parameter(Mandatory)][ValidateSet('currentUser', 'perMachine')][string]$Scope,
        [Parameter(Mandatory)][hashtable]$Resources
    )
    return @{
        bundle = @{
            active = $true; targets = @('nsis'); externalBin = @(); resources = $Resources
            windows = @{
                nsis = @{ installMode = $Scope; displayLanguageSelector = $false; languages = @('English') }
                webviewInstallMode = @{ type = 'embedBootstrapper'; silent = $true }
            }
        }
    }
}
