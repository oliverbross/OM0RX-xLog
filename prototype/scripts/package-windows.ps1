#Requires -Version 7.0
<#
Build an isolated x86_64 Windows portable prototype, then audit its PE import
closure on the native Windows builder. This script does not run a local ELF/PE
inspector on another host, install prerequisites, or modify installed apps.
#>
[CmdletBinding()]
param(
    [string]$OutputRoot,
    [switch]$SkipBuild,
    [string]$DumpbinPath,
    [string]$VCRedistDirectory,
    [string[]]$AdditionalRuntimeDirectory = @()
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'Run this packaging audit on native Windows.' }
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if (-not $OutputRoot) { $OutputRoot = Join-Path $repoRoot 'dist/prototype-windows' }
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
$packageName = 'OM0RX-xLog-Prototype-windows-x86_64'
$package = Join-Path $OutputRoot $packageName
$archive = "$package.zip"
if ((Test-Path $package) -or (Test-Path $archive)) { throw "Output already exists: $package. Choose a fresh OutputRoot." }

function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    $result = @(& $Program @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "$Program failed ($LASTEXITCODE): $($result -join [Environment]::NewLine)" }
    return $result
}
function Write-Json([string]$Path, $Value) {
    $Value | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $Path -Encoding utf8NoBOM
}
function Hash([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }

Push-Location $repoRoot
try {
    $swift = (Get-Command swiftc -ErrorAction Stop).Source
    $swiftVersion = (Invoke-Checked $swift @('--version')) -join "`n"
    if ($swiftVersion -notmatch 'Swift version 6\.3\.3\b') { throw 'This packaging baseline and pinned Swift notices require Swift 6.3.3.' }
    $targetInfo = ((Invoke-Checked $swift @('-print-target-info')) -join "`n") | ConvertFrom-Json
    if ($targetInfo.target.triple -notlike 'x86_64-*-windows-msvc*') { throw "Unsupported Swift target: $($targetInfo.target.triple)" }
    $commit = ((Invoke-Checked git @('rev-parse', 'HEAD')) -join '').Trim()
    if ($env:GITHUB_SHA -and $env:GITHUB_SHA -ne $commit) { throw 'GITHUB_SHA differs from checked out HEAD; package provenance would be ambiguous.' }
    $epoch = [long](((Invoke-Checked git @('show', '-s', '--format=%ct', 'HEAD')) -join '').Trim())
    if ($env:SOURCE_DATE_EPOCH) { $epoch = [long]$env:SOURCE_DATE_EPOCH }
    $timestamp = [DateTimeOffset]::FromUnixTimeSeconds($epoch)
    if ($timestamp.Year -lt 1980 -or $timestamp.Year -gt 2107) { throw 'SOURCE_DATE_EPOCH is outside ZIP timestamp range.' }

    if (-not $SkipBuild) {
        & (Join-Path $PSScriptRoot 'build-worker.ps1')
        if ($LASTEXITCODE -ne 0) { throw 'Worker build failed.' }
        $null = Invoke-Checked node @('prototype/scripts/stage-worker.mjs')
        Push-Location (Join-Path $repoRoot 'prototype')
        try { $null = Invoke-Checked npx.cmd @('tauri', 'build', '--no-bundle') } finally { Pop-Location }
    }
    $release = Join-Path $repoRoot 'prototype/src-tauri/target/release'
    foreach ($name in @('xlog-prototype.exe', 'xlog-prototype-worker.exe')) {
        if (-not (Test-Path (Join-Path $release $name))) { throw "Missing release payload: $name" }
    }
    $sharedMetadata = Join-Path $repoRoot 'prototype/distribution-metadata'
    if (-not (Test-Path (Join-Path $sharedMetadata 'components.json'))) {
        throw 'Run node prototype/scripts/distribution-metadata.mjs before packaging; shared notices are required.'
    }
    if (-not $env:XLOG_SQLITE_PREFIX) { throw 'XLOG_SQLITE_PREFIX must identify the vcpkg x64-windows SQLite used to build the worker.' }
    $sqlite = Join-Path $env:XLOG_SQLITE_PREFIX 'bin/sqlite3.dll'
    if (-not (Test-Path $sqlite)) { throw "Missing SQLite runtime: $sqlite" }

    # Native audit uses Microsoft's installed build tools. Never fall back to a
    # denied inspector, binary string scan, or custom PE parser.
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
    $vsRoot = $null
    if (Test-Path $vswhere) {
        $vsRoot = ((Invoke-Checked $vswhere @('-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath')) -join '').Trim()
    }
    if (-not $DumpbinPath) {
        $command = Get-Command dumpbin.exe -ErrorAction SilentlyContinue
        if ($command) { $DumpbinPath = $command.Source }
        elseif ($vsRoot) {
            $toolset = Get-ChildItem (Join-Path $vsRoot 'VC/Tools/MSVC') -Directory | Sort-Object Name -Descending | Select-Object -First 1
            $DumpbinPath = Join-Path $toolset.FullName 'bin/Hostx64/x64/dumpbin.exe'
        }
    }
    if (-not $DumpbinPath -or -not (Test-Path $DumpbinPath)) { throw 'Native Windows audit requires installed Visual Studio dumpbin.exe.' }
    if (-not $VCRedistDirectory) {
        $searchedRedistRoots = [Collections.Generic.List[string]]::new()
        function Get-CrtDirectories([string]$Root) {
            $searchedRedistRoots.Add($Root)
            $architecture = Join-Path $Root 'x64'
            $searchedRedistRoots.Add($architecture)
            if (-not (Test-Path -LiteralPath $architecture -PathType Container)) { return }
            Get-ChildItem -LiteralPath $architecture -Directory -Filter 'Microsoft.VC*.CRT' |
                Where-Object {
                    $_.FullName -match '(?i)[\\/]redist[\\/].*[\\/]x64[\\/]Microsoft\.VC\d+\.CRT$' -and
                    (Test-Path -LiteralPath (Join-Path $_.FullName 'vcruntime140.dll') -PathType Leaf)
                }
        }
        $crt = $null
        # Developer environments sometimes expose an alias or a stale path.
        # Prefer this input only when it contains an actual redistributable CRT.
        if ($env:VCToolsRedistDir) {
            $crt = Get-CrtDirectories $env:VCToolsRedistDir | Sort-Object Name -Descending | Select-Object -First 1
        }
        if (-not $crt -and $vsRoot) {
            $redistTree = Join-Path $vsRoot 'VC/Redist/MSVC'
            if (Test-Path -LiteralPath $redistTree -PathType Container) {
                # Numeric toolset versions outrank alias folders such as v143.
                # Check each actual x64 tree; never assume the highest name has one.
                $roots = Get-ChildItem -LiteralPath $redistTree -Directory | Sort-Object -Property @{
                    Expression = { $version = [version]'0.0'; if ([version]::TryParse($_.Name, [ref]$version)) { $version } else { [version]'0.0' } }
                    Descending = $true
                }, Name
                foreach ($root in $roots) {
                    $crt = Get-CrtDirectories $root.FullName | Sort-Object Name -Descending | Select-Object -First 1
                    if ($crt) { break }
                }
            } else { $searchedRedistRoots.Add($redistTree) }
        }
        if (-not $crt) {
            foreach ($root in $searchedRedistRoots | Select-Object -Unique) {
                $children = if (Test-Path -LiteralPath $root -PathType Container) { @(Get-ChildItem -LiteralPath $root -Directory | ForEach-Object Name) -join ', ' } else { '(directory missing)' }
                Write-Host "CRT discovery inspected: $root; immediate directories: $children"
            }
            throw 'Cannot locate an actual official x64 Microsoft.VC*.CRT directory with vcruntime140.dll in the selected Visual Studio REDIST tree.'
        }
        $VCRedistDirectory = $crt.FullName
    }
    if (-not (Test-Path -LiteralPath $VCRedistDirectory -PathType Container)) { throw "CRT redist directory does not exist: $VCRedistDirectory" }
    if ($VCRedistDirectory -notmatch '(?i)[\\/]redist[\\/].*[\\/]x64[\\/]Microsoft\.VC\d+\.CRT$') {
        throw 'VCRedistDirectory must be an official VS REDIST x64 Microsoft.VC*.CRT directory, not System32.'
    }

    $runtimeDirectories = [Collections.Generic.List[string]]::new()
    $runtimeKinds = @{}
    $compilerDirectory = Split-Path $swift
    $runtimeDirectories.Add($compilerDirectory)
    $runtimeKinds[$compilerDirectory] = 'swift-compiler-host-runtime'
    # Official Windows toolset separates Runtimes from SDKs and Toolchains.
    # Discover the selected installed 6.3.3 runtime component from this compiler
    # vendor root, rather than inheriting its PATH entries.
    if ($swift -match '^(.*)[\\/]Toolchains[\\/]') {
        $vendorRoot = $Matches[1]
        $runtimesRoot = Join-Path $vendorRoot 'Runtimes'
        if (Test-Path $runtimesRoot) {
            foreach ($runtime in Get-ChildItem $runtimesRoot -Directory | Where-Object Name -Match '^6\.3\.3([+-]|$)') {
                foreach ($file in Get-ChildItem $runtime.FullName -Filter '*.dll' -File -Recurse | Where-Object FullName -NotMatch '[\\/](arm64|aarch64|x86|i686)[\\/]') {
                    $runtimeDirectories.Add($file.DirectoryName)
                    $runtimeKinds[$file.DirectoryName] = 'swift-distribution-runtime'
                }
            }
        }
    }
    foreach ($path in $targetInfo.paths.runtimeLibraryPaths) {
        if (Test-Path $path) {
            $directory = [IO.Path]::GetFullPath($path)
            $runtimeDirectories.Add($directory)
            if (-not $runtimeKinds.ContainsKey($directory)) { $runtimeKinds[$directory] = 'swift-sdk-runtime' }
        }
    }
    if ($env:SDKROOT) {
        foreach ($suffix in @('usr/bin', 'usr/lib/swift/windows', 'usr/lib/swift/windows/x86_64')) {
            $path = Join-Path $env:SDKROOT $suffix
            if (Test-Path $path) {
                $directory = [IO.Path]::GetFullPath($path)
                $runtimeDirectories.Add($directory)
                if (-not $runtimeKinds.ContainsKey($directory)) { $runtimeKinds[$directory] = 'swift-sdk-runtime' }
            }
        }
    }
    # Explicit build-runtime directories are recorded; never search developer
    # PATH or arbitrary disk locations to make unresolved imports disappear.
    foreach ($path in $AdditionalRuntimeDirectory) {
        $directory = (Resolve-Path $path -ErrorAction Stop).Path
        $runtimeDirectories.Add($directory)
        if (-not $runtimeKinds.ContainsKey($directory)) { $runtimeKinds[$directory] = 'explicit-runtime-directory' }
    }
    $runtimeDirectories = @($runtimeDirectories | Sort-Object -Unique)
    $candidates = @{}
    function Register-Candidates([string]$Directory, [string]$Origin, [int]$Priority) {
        foreach ($file in Get-ChildItem -LiteralPath $Directory -Filter '*.dll' -File) {
            $key = $file.Name.ToLowerInvariant()
            if ($Origin -eq 'visual-studio-redist-crt') {
                # Use the licensed VS REDIST source for CRT payloads, even if a
                # compiler directory carries another executable's CRT copy.
                $candidates[$key] = [Collections.Generic.List[object]]::new()
            }
            if (-not $candidates.ContainsKey($key)) { $candidates[$key] = [Collections.Generic.List[object]]::new() }
            $candidates[$key].Add([pscustomobject]@{ path = $file.FullName; origin = $Origin; priority = $Priority })
        }
    }
    foreach ($path in $runtimeDirectories) {
        $kind = $runtimeKinds[$path]
        $priority = switch ($kind) {
            'swift-distribution-runtime' { 30 }
            'explicit-runtime-directory' { 20 }
            'swift-sdk-runtime' { 10 }
            default { 0 }
        }
        Register-Candidates $path $kind $priority
    }
    Register-Candidates $VCRedistDirectory 'visual-studio-redist-crt' 40
    # SQLite must come from the exact selected prefix, not a stale staged DLL.
    $candidates['sqlite3.dll'] = @([pscustomobject]@{ path = $sqlite; origin = 'vcpkg-sqlite3-x64-windows'; priority = 40 })

    New-Item -ItemType Directory -Path $package -Force | Out-Null
    $notices = New-Item -ItemType Directory -Path (Join-Path $package 'notices')
    Copy-Item -LiteralPath $sharedMetadata -Destination (Join-Path $notices.FullName 'shared') -Recurse
    $coreResources = Join-Path $release 'OM0RXXLogPrototype_XLogPortableCore.resources'
    if (-not (Test-Path -LiteralPath $coreResources -PathType Container)) { throw 'Local logbook CTY and awards resources are missing.' }
    Copy-Item -LiteralPath $coreResources -Destination (Join-Path $package 'OM0RXXLogPrototype_XLogPortableCore.resources') -Recurse
    $auditDirectory = New-Item -ItemType Directory -Path (Join-Path $package 'evidence/native-imports')
    $origins = @{}
    $queue = [Collections.Generic.Queue[string]]::new()
    foreach ($name in @('xlog-prototype.exe', 'xlog-prototype-worker.exe')) {
        $source = Join-Path $release $name
        Copy-Item -LiteralPath $source -Destination (Join-Path $package $name)
        $origins[$name.ToLowerInvariant()] = [pscustomobject]@{ path = $source; origin = 'prototype-build' }
        $queue.Enqueue($name)
    }
    $edges = [Collections.Generic.List[object]]::new()
    $runtimeSelections = [Collections.Generic.List[object]]::new()
    $visited = @{}
    while ($queue.Count -gt 0) {
        $name = $queue.Dequeue()
        $key = $name.ToLowerInvariant()
        if ($visited.ContainsKey($key)) { continue }
        $visited[$key] = $true
        $payload = Join-Path $package $name
        $headers = (Invoke-Checked $DumpbinPath @('/NOLOGO', '/HEADERS', $payload)) -join "`n"
        if ($headers -notmatch '(?im)^\s*8664 machine \(x64\)') { throw "Payload is not x64 PE: $name" }
        $imports = (Invoke-Checked $DumpbinPath @('/NOLOGO', '/DEPENDENTS', $payload)) -join "`n"
        $imports | Set-Content (Join-Path $auditDirectory.FullName "$name.txt") -Encoding utf8NoBOM
        $dependencies = @([regex]::Matches($imports, '(?im)^\s+([^\s]+\.dll)\s*$') | ForEach-Object { $_.Groups[1].Value.ToLowerInvariant() } | Sort-Object -Unique)
        if ($dependencies.Count -eq 0) { throw "No imports parsed for $name; inspect the native audit output." }
        foreach ($dependency in $dependencies) {
            if ($dependency -match '^(api-ms-win-|ext-ms-win-)') {
                $edges.Add([pscustomobject]@{ from = $name; import = $dependency; resolution = 'windows-api-set'; source = 'Windows loader API-set contract'; sha256 = $null })
                continue
            }
            if ($origins.ContainsKey($dependency)) {
                $edges.Add([pscustomobject]@{ from = $name; import = $dependency; resolution = 'app-local'; source = $origins[$dependency].path; sha256 = Hash (Join-Path $package $dependency) })
                continue
            }
            if ($candidates.ContainsKey($dependency)) {
                $allChoices = @($candidates[$dependency] | ForEach-Object { $_ } | Sort-Object priority -Descending)
                # Swift's Runtimes component is the application redistributable;
                # compiler-host copies can differ (e.g. BlocksRuntime). Keep
                # ambiguity checks within the chosen authoritative source tier.
                $choices = @($allChoices | Where-Object priority -eq $allChoices[0].priority)
                $hashes = @($choices | ForEach-Object { Hash $_.path } | Sort-Object -Unique)
                if ($hashes.Count -ne 1) { throw "Ambiguous runtime import $dependency from: $($choices.path -join ', '). Select consistent toolchain directories." }
                $choice = $choices[0]
                Copy-Item -LiteralPath $choice.path -Destination (Join-Path $package $dependency)
                $origins[$dependency] = $choice
                $queue.Enqueue($dependency)
                $shadowed = @($allChoices | Where-Object priority -lt $choice.priority | ForEach-Object {
                    [pscustomobject]@{ path = $_.path; origin = $_.origin; priority = $_.priority; sha256 = Hash $_.path }
                })
                $runtimeSelections.Add([pscustomobject]@{ import = $dependency; selected = $choice; sha256 = $hashes[0]; shadowed = $shadowed })
                $edges.Add([pscustomobject]@{ from = $name; import = $dependency; resolution = 'app-local'; source = $choice.path; sha256 = $hashes[0] })
                continue
            }
            $system = Join-Path ([Environment]::GetFolderPath('System')) $dependency
            # Never allow a centrally installed CRT/Swift/SQLite runtime to hide
            # a missing redistributable in this portable prototype.
            if ($dependency -match '^(swift|foundation|_foundation|dispatch|blocks|sqlite|msvcp|vcruntime|concrt|vcomp|icu|libcurl|libxml|libssl|libcrypto)') {
                throw "Unresolved redistributable import $dependency required by $name. Add its official installed runtime directory explicitly."
            }
            if (-not (Test-Path $system)) { throw "Unresolved import $dependency required by $name; not bundled or provided by Windows System32." }
            $signature = Get-AuthenticodeSignature -FilePath $system
            if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft') {
                throw "Import $dependency resolves to a non-Microsoft System32 file; explicit redistribution audit is required."
            }
            $edges.Add([pscustomobject]@{ from = $name; import = $dependency; resolution = 'windows-system'; source = $system; sha256 = Hash $system })
        }
    }
    if (-not $origins.ContainsKey('sqlite3.dll') -or -not $origins.ContainsKey('swiftcore.dll')) { throw 'Audit did not stage expected SQLite and Swift core runtimes.' }

    # Keep complete primary-source notices with retrieval hashes. Installed
    # vcpkg's copyright accompanies the exact SQLite build as well.
    $noticeSources = [ordered]@{
        'Swift-LICENSE.txt' = 'https://raw.githubusercontent.com/swiftlang/swift/swift-6.3.3-RELEASE/LICENSE.txt'
        'Swift-Foundation-LICENSE.txt' = 'https://raw.githubusercontent.com/swiftlang/swift-corelibs-foundation/swift-6.3.3-RELEASE/LICENSE'
        'Swift-Foundation-Essentials-LICENSE.md' = 'https://raw.githubusercontent.com/swiftlang/swift-foundation/swift-6.3.3-RELEASE/LICENSE.md'
        'Swift-Foundation-NOTICE.txt' = 'https://raw.githubusercontent.com/swiftlang/swift-foundation/swift-6.3.3-RELEASE/NOTICE.txt'
        'Swift-Dispatch-LICENSE.txt' = 'https://raw.githubusercontent.com/swiftlang/swift-corelibs-libdispatch/swift-6.3.3-RELEASE/LICENSE'
        'LLVM-compiler-rt-LICENSE.txt' = 'https://raw.githubusercontent.com/swiftlang/llvm-project/swift-6.3.3-RELEASE/compiler-rt/LICENSE.TXT'
        'Visual-Studio-REDIST.html' = 'https://learn.microsoft.com/en-us/visualstudio/releases/2022/redistribution'
        'SQLite-public-domain.html' = 'https://www.sqlite.org/copyright.html'
    }
    # Third-party license snapshots are disclosed separately from exact binary
    # provenance; they are not a claim of source-version or shipping clearance.
    $noticePatterns = @(
        @('icu', 'ICU-LICENSE.txt', 'https://raw.githubusercontent.com/unicode-org/icu/main/LICENSE'),
        @('curl', 'curl-COPYING.txt', 'https://raw.githubusercontent.com/curl/curl/master/COPYING'),
        @('xml2', 'libxml2-COPYING.txt', 'https://raw.githubusercontent.com/GNOME/libxml2/master/Copyright'),
        @('(ssl|crypto)', 'OpenSSL-LICENSE.txt', 'https://raw.githubusercontent.com/openssl/openssl/master/LICENSE.txt'),
        @('zlib', 'zlib-LICENSE.txt', 'https://raw.githubusercontent.com/madler/zlib/master/LICENSE'),
        @('nghttp2', 'nghttp2-COPYING.txt', 'https://raw.githubusercontent.com/nghttp2/nghttp2/master/COPYING'),
        @('ssh2', 'libssh2-COPYING.txt', 'https://raw.githubusercontent.com/libssh2/libssh2/master/COPYING'),
        @('zstd', 'zstd-LICENSE.txt', 'https://raw.githubusercontent.com/facebook/zstd/dev/LICENSE'),
        @('brotli', 'brotli-LICENSE.txt', 'https://raw.githubusercontent.com/google/brotli/master/LICENSE')
    )
    foreach ($entry in $noticePatterns) {
        if (@($origins.Keys | Where-Object { $_ -match $entry[0] }).Count -gt 0) { $noticeSources[$entry[1]] = $entry[2] }
    }
    $noticeEvidence = @()
    foreach ($name in $noticeSources.Keys) {
        $destination = Join-Path $notices.FullName $name
        $uri = [string]$noticeSources[$name]
        try {
            Invoke-WebRequest -Uri $uri -OutFile $destination -TimeoutSec 30 -MaximumRetryCount 2 -RetryIntervalSec 2 -ErrorAction Stop
        } catch {
            $status = 'network error'
            $response = $_.Exception.PSObject.Properties['Response']
            if ($response -and $response.Value -and $response.Value.PSObject.Properties['StatusCode']) { $status = [int]$response.Value.StatusCode }
            throw "Notice download failed: $name; HTTP/status $status; source $uri. Portable archive was not emitted."
        }
        $noticeEvidence += [pscustomobject]@{ path = "notices/$name"; source = $noticeSources[$name]; sha256 = Hash $destination }
    }
    $sqliteCopyright = Join-Path $env:XLOG_SQLITE_PREFIX 'share/sqlite3/copyright'
    if (-not (Test-Path $sqliteCopyright)) { throw 'Exact selected vcpkg SQLite copyright file is missing.' }
    Copy-Item $sqliteCopyright (Join-Path $notices.FullName 'vcpkg-sqlite3-copyright.txt')
    foreach ($name in @('LICENSE', 'NOTICE')) { Copy-Item (Join-Path $repoRoot $name) (Join-Path $notices.FullName "OM0RX-xLog-$name.txt") }
    foreach ($name in @('Package.resolved', 'prototype/package-lock.json', 'prototype/src-tauri/Cargo.lock')) {
        if (Test-Path (Join-Path $repoRoot $name)) { Copy-Item (Join-Path $repoRoot $name) (Join-Path $package "evidence/$(Split-Path $name -Leaf)") }
    }
    Copy-Item (Join-Path $PSScriptRoot 'accept-windows.ps1') (Join-Path $package 'accept-windows.ps1')
    @'
OM0RX-xLog P1 portable architecture prototype - synthetic fixtures only
Intended desktop target: x86_64 Windows 11, pending user desktop acceptance.
Native CI reference: Windows Server 2022. Windows 10 is not accepted here.
Launch xlog-prototype.exe from this extracted directory. Both executables and
all bundled DLLs must stay together. No Swift, Node, Rust or vcpkg is needed by
the packaged executable. Microsoft Evergreen WebView2 Runtime is required;
this portable archive does not install it or silently alter the machine.
Official runtime setup: https://developer.microsoft.com/microsoft-edge/webview2/

Run acceptance in PowerShell 7: ./accept-windows.ps1 -PackageDirectory .
The acceptance report distinguishes toolchain absence, restricted PATH,
module origins and synthetic UI-to-worker tests. A GitHub Windows Server
runner is not a pristine Windows 11 consumer installation. Inspect evidence.

Unsigned internal test package. Not an installer, public release, hardware
test, station migration, complete SBOM or license/signing approval. Runtime
updates require rebuilding the archive; app-local CRT is not centrally serviced.
See provenance.json, dependencies.json, payload-manifest.json and notices/.
Full build-source path and version details are intentionally recorded there.
'@ | Set-Content (Join-Path $package 'README.txt') -Encoding utf8NoBOM
    $payloads = @($origins.Keys | Sort-Object | ForEach-Object {
        $file = Get-Item (Join-Path $package $_)
        [pscustomobject]@{ path = $_; origin = $origins[$_].origin; source = $origins[$_].path; sha256 = Hash $file.FullName; bytes = $file.Length; fileVersion = $file.VersionInfo.FileVersion; productVersion = $file.VersionInfo.ProductVersion }
    })
    Write-Json (Join-Path $package 'dependencies.json') ([ordered]@{ schema = 1; audit = 'native Visual Studio dumpbin /DEPENDENTS, recursive app-local imports'; inspector = $DumpbinPath; inspectorSha256 = Hash $DumpbinPath; edges = $edges.ToArray(); limitation = 'Import closure does not enumerate runtime LoadLibrary paths; acceptance records loaded modules.' })
    Write-Json (Join-Path $package 'provenance.json') ([ordered]@{
        schema = 1; product = 'OM0RX-xLog Prototype'; commit = $commit; platform = 'windows-x86_64'; sourceDateEpoch = $epoch
        swiftVersion = $swiftVersion; swiftTargetInfo = $targetInfo; swiftRuntimeDirectories = $runtimeDirectories; vcRedistDirectory = $VCRedistDirectory
        runtimeSelections = $runtimeSelections.ToArray(); runtimeSelectionPolicy = 'Official Swift 6.3.3 Runtimes component before explicit runtime directories, SDK runtime directories, then compiler-host fallback. Conflicting copies within a source tier fail. CRT and SQLite use their canonical selected sources.'
        webview = @{ mode = 'evergreen-prerequisite'; source = 'https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution'; bundled = $false }
        payloads = $payloads; notices = $noticeEvidence; noticeLimit = 'Non-Swift third-party upstream license snapshots must be checked against exact packaged versions before public distribution.'
        signing = 'unsigned internal prototype'; hamlib = 'not included'; acceptance = 'pending native clean-job acceptance'
    })
    $files = @(Get-ChildItem $package -File -Recurse | Sort-Object FullName | ForEach-Object {
        [pscustomobject]@{ path = [IO.Path]::GetRelativePath($package, $_.FullName).Replace('\', '/'); bytes = $_.Length; sha256 = Hash $_.FullName }
    })
    Write-Json (Join-Path $package 'payload-manifest.json') ([ordered]@{ schema = 1; files = $files; excludes = @('payload-manifest.json'); purpose = 'Detect artifact payload corruption; this unsigned manifest is not an authenticity signature.' })
    # Sorted entries and fixed ZIP timestamps avoid filesystem-time variation.
    $stream = [IO.File]::Open($archive, [IO.FileMode]::CreateNew)
    $zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in Get-ChildItem $package -File -Recurse | Sort-Object FullName) {
            $entryName = "$packageName/$([IO.Path]::GetRelativePath($package, $file.FullName).Replace('\', '/'))"
            $entry = $zip.CreateEntry($entryName, [IO.Compression.CompressionLevel]::Optimal)
            $entry.LastWriteTime = $timestamp
            $inputStream = $file.OpenRead(); $entryStream = $entry.Open()
            try { $inputStream.CopyTo($entryStream) } finally { $entryStream.Dispose(); $inputStream.Dispose() }
        }
    } finally { $zip.Dispose(); $stream.Dispose() }
    "$(Hash $archive)  $(Split-Path $archive -Leaf)" | Set-Content "$archive.sha256" -Encoding utf8NoBOM
    Write-Host "Windows prototype package: $package"
    Write-Host "Portable archive: $archive"
} finally { Pop-Location }
