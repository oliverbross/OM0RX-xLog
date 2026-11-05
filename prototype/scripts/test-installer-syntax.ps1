#Requires -Version 7.0
[CmdletBinding()]
param([string]$WorkerReceiptResultPath)
$ErrorActionPreference = 'Stop'
$scripts = @(
    'package-windows.ps1', 'package-windows-installer.ps1',
    'accept-windows.ps1', 'accept-windows-installer.ps1', 'build-worker.ps1',
    'windows-installer-policy.ps1', 'test-windows-installer-policy.ps1',
    'diagnose-windows-local-self-test.ps1', 'test-windows-worker-receipts.ps1',
    'test-diagnose-windows-local-self-test.ps1'
)
foreach ($name in $scripts) {
    $tokens = $null
    $errors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile(
        (Join-Path $PSScriptRoot $name), [ref]$tokens, [ref]$errors)
    if ($errors.Count) {
        $errors | ForEach-Object { Write-Error "$name line $($_.Extent.StartLineNumber): $($_.Message)" }
        throw "Installer syntax failed: $name"
    }
}
Write-Host "PowerShell installer syntax passed ($($scripts.Count) scripts)."
& (Join-Path $PSScriptRoot 'test-windows-installer-policy.ps1')
$receiptArguments = @{}
if ($WorkerReceiptResultPath) { $receiptArguments.ResultPath = $WorkerReceiptResultPath }
& (Join-Path $PSScriptRoot 'test-windows-worker-receipts.ps1') @receiptArguments
if (-not $?) { throw 'Worker failure-receipt contract tests failed.' }
& (Join-Path $PSScriptRoot 'test-diagnose-windows-local-self-test.ps1')
if (-not $?) { throw 'Installed worker diagnostic contract tests failed.' }
