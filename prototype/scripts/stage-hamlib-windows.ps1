#Requires -Version 7.0
# Stage the checksum-pinned upstream Windows distribution. Never install it
# globally, probe devices or run a daemon; --version is the only execution.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'Native Windows required.' }
$version = '4.7.2'
$sha256 = '8553bc6c5c6032e8debf99c017e98f58fed7e07e7c25d04815dc3e8bbe3304c7'
$url = "https://github.com/Hamlib/Hamlib/releases/download/$version/hamlib-w64-$version.zip"
$target = ((& rustc -vV) | Select-String '^host: ').ToString().Substring(6).Trim()
if ($LASTEXITCODE -ne 0 -or $target -ne 'x86_64-pc-windows-msvc') { throw 'Windows x64 MSVC Rust host required.' }
$work = Join-Path ([IO.Path]::GetTempPath()) ('xlog-hamlib-' + [guid]::NewGuid().ToString())
$null = New-Item -ItemType Directory -Path $work
$binaries = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../src-tauri/binaries'))
try {
    $archive = Join-Path $work 'hamlib.zip'
    Invoke-WebRequest -Uri $url -OutFile $archive
    if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sha256) { throw 'Hamlib archive checksum mismatch.' }
    Expand-Archive -LiteralPath $archive -DestinationPath $work
    $source = Join-Path $work "hamlib-w64-$version"
    $null = New-Item -ItemType Directory -Path $binaries -Force
    $runtime = Join-Path $binaries 'hamlib-windows-runtime'
    $null = New-Item -ItemType Directory -Path $runtime -Force
    $dlls = @('libhamlib-4.dll', 'libusb-1.0.dll', 'libgcc_s_seh-1.dll', 'libwinpthread-1.dll')
    foreach ($name in $dlls) {
        Copy-Item -LiteralPath (Join-Path $source "bin/$name") -Destination (Join-Path $runtime $name)
        Copy-Item -LiteralPath (Join-Path $runtime $name) -Destination (Join-Path $binaries $name)
    }
    foreach ($name in @('rigctld', 'rotctld')) {
        $exe = Join-Path $source "bin/$name.exe"
        $versionOutput = @(& $exe --version 2>&1) -join "`n"
        if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch 'Hamlib 4\.7\.2\b') { throw "Incorrect $name version." }
        Copy-Item -LiteralPath $exe -Destination (Join-Path $binaries "$name-$target.exe")
    }
    # Tauri copies declared sidecar executables, but does not infer their DLLs.
    foreach ($configuration in @('debug', 'release')) {
        $destination = Join-Path $PSScriptRoot "../src-tauri/target/$configuration"
        $null = New-Item -ItemType Directory -Path $destination -Force
        foreach ($name in $dlls) { Copy-Item -LiteralPath (Join-Path $runtime $name) -Destination (Join-Path $destination $name) }
    }
    $notices = Join-Path $binaries "hamlib-$version-notices"
    $null = New-Item -ItemType Directory -Path $notices -Force
    foreach ($file in Get-ChildItem -LiteralPath $source -Filter '*.txt' -File) { Copy-Item -LiteralPath $file.FullName -Destination $notices }
    foreach ($required in @('COPYING.txt', 'COPYING.LIB.txt', 'LICENSE.txt', 'README.w64-bin.txt')) {
        if (-not (Test-Path (Join-Path $notices $required))) { throw "Required upstream notice missing: $required" }
    }
    $payload = @($dlls | ForEach-Object { @{ name = $_; sha256 = (Get-FileHash (Join-Path $runtime $_) -Algorithm SHA256).Hash.ToLowerInvariant() } })
    $helpers = @(@('rigctld', 'rotctld') | ForEach-Object { @{ name = "$_.exe"; sha256 = (Get-FileHash (Join-Path $binaries "$_-$target.exe") -Algorithm SHA256).Hash.ToLowerInvariant() } })
    @{ version = $version; archive = $url; archiveSha256 = $sha256; target = $target; runtime = $payload;
       helpers = $helpers;
       sourceArchive = "https://github.com/Hamlib/Hamlib/releases/download/$version/hamlib-$version.tar.gz" } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $notices 'PROVENANCE.json') -Encoding utf8NoBOM
} finally {
    # This unique directory was created above by this invocation, never supplied
    # by a caller. No app, operator data or toolchain directory is a cleanup target.
    Remove-Item -LiteralPath $work -Recurse -Force
}
