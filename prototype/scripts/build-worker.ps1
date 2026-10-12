$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$env:XLOG_PORTABLE_ONLY = '1'
$scratch = Join-Path $repoRoot '.build/prototype-worker'
$arguments = @('--package-path', $repoRoot, '--scratch-path', $scratch, '-c', 'release')
# vcpkg install sqlite3:x64-windows; set XLOG_SQLITE_PREFIX to installed/x64-windows.
if ($env:XLOG_SQLITE_PREFIX) {
    $arguments += @('-Xcc', "-I$env:XLOG_SQLITE_PREFIX/include", '-Xlinker', "/LIBPATH:$env:XLOG_SQLITE_PREFIX/lib")
}
& swift build @arguments --product xlog-prototype-worker
if ($LASTEXITCODE -ne 0) { throw 'Worker build failed.' }
$binaryDir = (& swift build @arguments --show-bin-path | Select-Object -Last 1).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Worker path lookup failed.' }
if ($env:XLOG_SQLITE_PREFIX) {
    $sqliteDLL = Join-Path $env:XLOG_SQLITE_PREFIX 'bin/sqlite3.dll'
    if (Test-Path $sqliteDLL) { Copy-Item $sqliteDLL $binaryDir -Force }
}
& (Join-Path $binaryDir 'xlog-prototype-worker.exe') --self-test
if ($LASTEXITCODE -ne 0) { throw 'Worker self-test failed.' }
Write-Host "Worker built: $binaryDir/xlog-prototype-worker.exe"
