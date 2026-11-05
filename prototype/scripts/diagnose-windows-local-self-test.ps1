#Requires -Version 7.0
<#
.SYNOPSIS
Captures paired TEMP-only diagnostics for the unchanged packaged 1.5.20 worker.
.DESCRIPTION
Diagnosis only. Requires verified default-install and payload receipts. AB runs
four children; -ABA runs six. Every child receives only --local-logbook-self-test,
which owns disposable data. Nothing changes acceptance TEMP, award count 192,
application code, installation, permissions, registry, network or hardware.

Every child is created suspended, then OS image/argv/PPID are proved before its
one ResumeThread. The unchanged 10-second response budget includes the loader.
Only an owned timed-out child or a never-resumed owned child may be terminated.
Raw private evidence is preserved; a complete matrix is not acceptance success.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$PortableDirectory,
    [Parameter(Mandatory)][string]$InstalledDirectory,
    [Parameter(Mandatory)][string]$InstallerReceipt,
    [Parameter(Mandatory)][string]$RunnerTemp,
    [Parameter(Mandatory)][string]$OriginalNestedTemp,
    [Parameter(Mandatory)][string]$WorkingDirectory,
    [Parameter(Mandatory)][string]$EvidenceDirectory,
    [switch]$ABA
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-XLogDiagnostic([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
function Get-XLogDiagnosticHash([string]$Path) {
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Write-XLogDiagnosticJson([string]$Path, $Value) {
    $text = $Value | ConvertTo-Json -Depth 40
    $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try {
        $bytes = [Text.UTF8Encoding]::new($false).GetBytes($text + "`n")
        $stream.Write($bytes, 0, $bytes.Length)
    } finally { $stream.Dispose() }
}
function Test-XLogDiagnosticSamePath([string]$A, [string]$B) {
    $A.TrimEnd('\').Equals($B.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)
}
function Assert-XLogDiagnosticInside([string]$Path, [string]$Root) {
    Assert-XLogDiagnostic ($Path.StartsWith($Root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) 'Diagnostic coordinate escapes the explicit runner temporary root.'
}
function Resolve-XLogDiagnosticDirectory([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    Assert-XLogDiagnostic ($full -match '^[A-Za-z]:\\' -and -not $full.StartsWith('\\')) 'Use an ordinary absolute local Windows path, without UNC/extended-path substitution.'
    $item = Get-Item -LiteralPath $full -Force
    Assert-XLogDiagnostic $item.PSIsContainer 'Expected an existing directory.'
    $cursor = $item
    while ($null -ne $cursor) {
        Assert-XLogDiagnostic (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'Reparse-point coordinates are not admitted.'
        $cursor = $cursor.Parent
    }
    return $item.FullName.TrimEnd('\')
}
function Assert-XLogDiagnosticReceipt($Receipt, [string]$Installed, [string]$ExpectedDefault) {
    foreach ($key in @('schema', 'sourceCommit', 'version', 'installationScope', 'registryHive', 'actualDirectory',
        'expectedDefaultDirectory', 'shortcutTarget', 'defaultPathPassed', 'registryScopePassed', 'startMenuScopePassed', 'payloadManifestSHA256')) {
        Assert-XLogDiagnostic ($null -ne $Receipt.PSObject.Properties[$key]) "Installer receipt lacks $key."
    }
    Assert-XLogDiagnostic ($Receipt.schema -eq 2 -and $Receipt.sourceCommit -ceq '3d9cb0981c30764f1188db350ffebc22a5f328a7' -and $Receipt.version -ceq '1.5.20') 'Receipt is not the unchanged 1.5.20 source.'
    $expectedHive = switch ($Receipt.installationScope) { 'currentUser' { 'HKCU' }; 'perMachine' { 'HKLM' }; default { throw 'Unknown installation scope.' } }
    Assert-XLogDiagnostic ($Receipt.registryHive -ceq $expectedHive) 'Receipt scope/hive mismatch.'
    foreach ($key in @('defaultPathPassed', 'registryScopePassed', 'startMenuScopePassed')) {
        Assert-XLogDiagnostic ($Receipt.$key -is [bool] -and $Receipt.$key) "Receipt does not prove $key."
    }
    Assert-XLogDiagnostic ((Test-XLogDiagnosticSamePath $Receipt.actualDirectory $Installed) -and
        (Test-XLogDiagnosticSamePath $Receipt.expectedDefaultDirectory $ExpectedDefault) -and
        (Test-XLogDiagnosticSamePath $Installed $ExpectedDefault)) 'Installed coordinate differs from the real verified scope default.'
    Assert-XLogDiagnostic (Test-XLogDiagnosticSamePath $Receipt.shortcutTarget ($Installed.TrimEnd('\') + '\xlog-prototype.exe')) 'Receipt shortcut target differs from the verified installed app.'
    Assert-XLogDiagnostic ($Receipt.payloadManifestSHA256 -ceq '448ca94af62660acf51cd201eee791367fa0898a6ab355f3559e41d4a9c2060d') 'Receipt does not name the exact 1.5.20 payload manifest.'
}
function Assert-XLogDiagnosticPayload([string]$Directory, [bool]$Installed) {
    $manifestPath = Join-Path $Directory 'payload-manifest.json'
    Assert-XLogDiagnostic ((Get-XLogDiagnosticHash $manifestPath) -ceq '448ca94af62660acf51cd201eee791367fa0898a6ab355f3559e41d4a9c2060d') 'Payload manifest differs from the fixed 1.5.20 input.'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -Depth 30
    $provenance = Get-Content -LiteralPath (Join-Path $Directory 'provenance.json') -Raw | ConvertFrom-Json -Depth 30
    Assert-XLogDiagnostic ($manifest.schema -eq 1 -and @($manifest.files).Count -eq 3270 -and $provenance.schema -eq 1 -and
        $provenance.commit -ceq '3d9cb0981c30764f1188db350ffebc22a5f328a7' -and $provenance.version -ceq '1.5.20') 'Wrong package source/version/manifest population.'
    $entries = @((Get-Item -LiteralPath $Directory -Force)) + @(Get-ChildItem -LiteralPath $Directory -Recurse -Force)
    Assert-XLogDiagnostic (@($entries | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count -eq 0) 'Payload contains a reparse point.'
    if ($Installed) { Assert-XLogDiagnostic (Test-Path -LiteralPath (Join-Path $Directory 'uninstall.exe') -PathType Leaf) 'Verified installed payload lacks its uninstaller.' }
    $expected = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($file in $manifest.files) {
        $relative = [string]$file.path
        Assert-XLogDiagnostic (-not [IO.Path]::IsPathRooted($relative) -and -not $relative.Contains(':') -and ($relative -split '[/\\]') -notcontains '..') 'Unsafe payload manifest coordinate.'
        $path = [IO.Path]::GetFullPath((Join-Path $Directory $relative))
        Assert-XLogDiagnosticInside $path $Directory
        Assert-XLogDiagnostic ($relative -ceq [IO.Path]::GetRelativePath($Directory, $path).Replace('\', '/') -and $expected.Add($relative)) 'Noncanonical/duplicate payload coordinate.'
        $item = Get-Item -LiteralPath $path -Force
        Assert-XLogDiagnostic (-not $item.PSIsContainer -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0 -and
            $item.Length -eq $file.bytes -and (Get-XLogDiagnosticHash $path) -ceq $file.sha256) 'Payload byte/hash/type mismatch.'
    }
    $actual = @(Get-ChildItem -LiteralPath $Directory -Recurse -Force -File | Where-Object {
        $relative = [IO.Path]::GetRelativePath($Directory, $_.FullName).Replace('\', '/')
        $relative -ine 'payload-manifest.json' -and -not ($Installed -and $relative -ieq 'uninstall.exe')
    })
    Assert-XLogDiagnostic ($actual.Count -eq $expected.Count) 'Unmanifested payload files.'
    foreach ($item in $actual) { Assert-XLogDiagnostic ($expected.Contains([IO.Path]::GetRelativePath($Directory, $item.FullName).Replace('\', '/'))) 'Unmanifested payload coordinate.' }
    $worker = Join-Path $Directory 'xlog-prototype-worker.exe'
    Assert-XLogDiagnostic ((Get-XLogDiagnosticHash $worker) -ceq '2dd9a007937b0cee8240bc73785a76ce2fbe4cc6a6dbe9dcde5114abce5593e5') 'Worker is not the exact unchanged packaged 1.5.20 executable.'
    return @{ worker = $worker; manifestFiles = $expected.Count; manifestSHA256 = Get-XLogDiagnosticHash $manifestPath; provenanceSHA256 = Get-XLogDiagnosticHash (Join-Path $Directory 'provenance.json') }
}
function New-XLogDiagnosticEnvironment([Collections.IDictionary]$Parent, [string]$Profile, [string]$CommonPath, [string]$Temp) {
    $values = [Collections.Generic.SortedDictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($name in $Parent.Keys) {
        if ($name -notmatch '^(SWIFT|SDKROOT$|DEVELOPER_DIR$|VCTools|VCINSTALL|VCPKG|XLOG_|CARGO|RUST|NODE|NPM|LIB$|LIBPATH$|INCLUDE$|WEBVIEW2_|PYTHON|VIRTUAL_ENV$|CONDA|SSL_CERT_FILE$|SSL_CERT_DIR$)') { $values[[string]$name] = [string]$Parent[$name] }
    }
    $values['PATH'] = $CommonPath
    $values['USERPROFILE'] = $Profile
    $values['APPDATA'] = $Profile.TrimEnd('\') + '\AppData\Roaming'
    $values['LOCALAPPDATA'] = $Profile.TrimEnd('\') + '\AppData\Local'
    $values['WEBVIEW2_USER_DATA_FOLDER'] = $Profile.TrimEnd('\') + '\WebView2'
    $values['TEMP'] = $Temp; $values['TMP'] = $Temp
    return $values
}
function Get-XLogDiagnosticEnvironmentEntries($Values, [switch]$WithoutTemp) {
    return @($Values.Keys | Where-Object { -not $WithoutTemp -or $_ -notin @('TEMP', 'TMP') } | ForEach-Object { "$_=$($Values[$_])" })
}
function Get-XLogDiagnosticTextHash([string]$Text) {
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::Unicode.GetBytes($Text))).ToLowerInvariant()
}
function Get-XLogDiagnosticProbeError($Failure) {
    $exception = $Failure.Exception.GetBaseException()
    $message = [string]$exception.Message
    return @{ type = $exception.GetType().FullName; message = $message.Substring(0, [Math]::Min(1024, $message.Length));
        hResult = $exception.HResult; nativeErrorCode = $(if ($exception -is [ComponentModel.Win32Exception]) { $exception.NativeErrorCode } else { $null }) }
}
function Get-XLogDiagnosticIdentityObservations([scriptblock]$QueryCim, [scriptblock]$QueryImage, [scriptblock]$QueryCreationTime) {
    $observations = [ordered]@{ observedUtc = [DateTime]::UtcNow.ToString('o');
        cim = @{ status = 'not-queried'; instanceCount = $null; instances = @(); error = $null };
        image = @{ status = 'not-queried'; value = $null; error = $null };
        creationTime = @{ status = 'not-queried'; value = $null; error = $null } }
    $cim = $null; $image = $null; $created = $null
    try {
        $cim = & $QueryCim
        $instances = @($cim | Where-Object { $null -ne $_ })
        $observations.cim.status = 'observed'
        $observations.cim.instanceCount = $instances.Count
        $observations.cim.instances = @(foreach ($instance in $instances) {
            $fields = [ordered]@{}
            foreach ($name in @('ProcessId','ParentProcessId','ExecutablePath','CommandLine')) {
                $field = @{ present = $false; value = $null; error = $null }
                try {
                    $property = $instance.PSObject.Properties[$name]
                    $field.present = $null -ne $property
                    if ($field.present) { $field.value = $property.Value }
                } catch { $field.error = Get-XLogDiagnosticProbeError $_ }
                $fields[$name] = $field
            }
            $fields
        })
    } catch { $observations.cim.status = 'error'; $observations.cim.error = Get-XLogDiagnosticProbeError $_ }
    # These queries must run independently, even if CIM is missing or failed.
    try { $image = & $QueryImage; $observations.image.status = 'observed'; $observations.image.value = $image }
    catch { $observations.image.status = 'error'; $observations.image.error = Get-XLogDiagnosticProbeError $_ }
    try { $created = & $QueryCreationTime; $observations.creationTime.status = 'observed'; $observations.creationTime.value = $created }
    catch { $observations.creationTime.status = 'error'; $observations.creationTime.error = Get-XLogDiagnosticProbeError $_ }
    return [pscustomobject]@{ Observations = $observations; CimInstance = $cim; ImagePath = $image; CreationFileTime = $created }
}
function Test-XLogDiagnosticReply($Reply) {
    # This is the existing hardcoded acceptance contract, not a relaxed variant.
    if ($null -eq $Reply -or -not $Reply.PSObject.Properties['id'] -or -not $Reply.PSObject.Properties['ok'] -or
        -not $Reply.PSObject.Properties['result'] -or $null -eq $Reply.result) { return $false }
    foreach ($name in @('passed','award_programmes','network_contact','station_io')) {
        if (-not $Reply.result.PSObject.Properties[$name]) { return $false }
    }
    return ($Reply.id -ceq 'local-logbook-self-test' -and $Reply.ok -eq $true -and $Reply.result.passed -eq $true -and
        $Reply.result.award_programmes -eq 192 -and $Reply.result.network_contact -eq $false -and $Reply.result.station_io -eq $false)
}

# Public Win32 API references: CreateProcessW, Process Creation Flags and
# Creating a Child Process with Redirected Input and Output, Microsoft Learn.
# https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw
# https://learn.microsoft.com/windows/win32/procthread/process-creation-flags
# https://learn.microsoft.com/windows/win32/procthread/creating-a-child-process-with-redirected-input-and-output
$nativeSource = @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
namespace XLogLocalDiagnostic {
  public sealed class Child : IDisposable {
    [StructLayout(LayoutKind.Sequential)] public struct SecurityAttributes { public int length; public IntPtr descriptor; [MarshalAs(UnmanagedType.Bool)] public bool inherit; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct StartupInfo {
      public int cb; public string reserved, desktop, title; public uint x,y,xSize,ySize,xChars,yChars,fill,flags;
      public ushort show,reservedBytes; public IntPtr reservedPointer,input,output,error;
    }
    [StructLayout(LayoutKind.Sequential)] public struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcessW(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr environment,string cwd,ref StartupInfo si,out ProcessInfo pi);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool CreatePipe(out IntPtr read,out IntPtr write,ref SecurityAttributes attributes,uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr process,out long created,out long exited,out long kernel,out long user);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool QueryFullProcessImageNameW(IntPtr process,uint flags,StringBuilder path,ref uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool PeekNamedPipe(IntPtr pipe,IntPtr buffer,uint size,IntPtr read,out uint available,IntPtr left);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool ReadFile(IntPtr file,[Out] byte[] buffer,uint count,out uint read,IntPtr overlapped);
    [DllImport("shell32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CommandLineToArgvW(string command,out int count);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
    const int Limit=65536,ResponseDeadlineMilliseconds=10000;
    IntPtr process,thread,outRead,errRead;
    readonly MemoryStream stdout=new MemoryStream(),stderr=new MemoryStream();
    readonly Stopwatch elapsed=new Stopwatch();
    bool outClosed,errClosed,disposed,terminationAttempted;
    public uint Pid {get;private set;}
    public string CommandLine {get;private set;}
    public bool Resumed {get;private set;}
    public bool TimedOut {get;private set;}
    public bool AbortedBeforeResume {get;private set;}
    public bool ExitConfirmed {get;private set;}
    public bool DrainComplete {get;private set;}
    public uint ExitCode {get;private set;}
    public long StdoutTotal {get;private set;}
    public long StderrTotal {get;private set;}
    public byte[] StdoutBytes {get{return stdout.ToArray();}}
    public byte[] StderrBytes {get{return stderr.ToArray();}}
    static void Check(bool ok) { if(!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    static void Close(ref IntPtr h) { if(h!=IntPtr.Zero) { CloseHandle(h); h=IntPtr.Zero; } }
    public static int[] LayoutSizes() { return new int[]{Marshal.SizeOf(typeof(SecurityAttributes)),Marshal.SizeOf(typeof(StartupInfo)),Marshal.SizeOf(typeof(ProcessInfo))}; }
    public static string MakeCommandLine(string exe) {
      if(String.IsNullOrWhiteSpace(exe) || exe.IndexOfAny(new char[]{'"','\r','\n','\0'})>=0) throw new ArgumentException("Unsafe executable coordinate");
      return "\""+exe+"\" --local-logbook-self-test";
    }
    public static string[] SplitCommandLine(string command) {
      int count; IntPtr data=CommandLineToArgvW(command,out count); Check(data!=IntPtr.Zero);
      try { string[] result=new string[count]; for(int i=0;i<count;i++) result[i]=Marshal.PtrToStringUni(Marshal.ReadIntPtr(data,i*IntPtr.Size)); return result; }
      finally { LocalFree(data); }
    }
    public static Child Create(string exe,string cwd,string[] environment) {
      Child child=new Child(); IntPtr inRead=IntPtr.Zero,inWrite=IntPtr.Zero,outWrite=IntPtr.Zero,errWrite=IntPtr.Zero,block=IntPtr.Zero;
      try {
        SecurityAttributes sa=new SecurityAttributes{length=Marshal.SizeOf(typeof(SecurityAttributes)),inherit=true};
        Check(CreatePipe(out inRead,out inWrite,ref sa,65536)); Check(SetHandleInformation(inWrite,1,0));
        Check(CreatePipe(out child.outRead,out outWrite,ref sa,65536)); Check(SetHandleInformation(child.outRead,1,0));
        Check(CreatePipe(out child.errRead,out errWrite,ref sa,65536)); Check(SetHandleInformation(child.errRead,1,0));
        StartupInfo si=new StartupInfo{cb=Marshal.SizeOf(typeof(StartupInfo)),flags=0x100,input=inRead,output=outWrite,error=errWrite};
        child.CommandLine=MakeCommandLine(exe);
        block=Marshal.StringToHGlobalUni(String.Join("\0",environment)+"\0\0");
        ProcessInfo pi;
        Check(CreateProcessW(exe,new StringBuilder(child.CommandLine),IntPtr.Zero,IntPtr.Zero,true,0x4|0x400|0x08000000,block,cwd,ref si,out pi));
        child.process=pi.process;child.thread=pi.thread;child.Pid=pi.pid;
        return child;
      } catch { child.Dispose(); throw; }
      finally { Close(ref inRead);Close(ref inWrite);Close(ref outWrite);Close(ref errWrite);if(block!=IntPtr.Zero) Marshal.FreeHGlobal(block); }
    }
    public string ImagePath() { uint size=32768;StringBuilder p=new StringBuilder((int)size);Check(QueryFullProcessImageNameW(process,0,p,ref size));return p.ToString(); }
    public long CreationFileTime() { long a,b,c,d;Check(GetProcessTimes(process,out a,out b,out c,out d));return a; }
    public void ResumeOnce() {
      if(Resumed || AbortedBeforeResume || disposed) throw new InvalidOperationException("Cannot resume this child");
      elapsed.Start();uint prior=ResumeThread(thread);if(prior==UInt32.MaxValue) throw new Win32Exception(Marshal.GetLastWin32Error());
      Resumed=true;Close(ref thread);if(prior!=1) throw new InvalidOperationException("Unexpected primary-thread suspend count");
    }
    bool Poll(IntPtr pipe,MemoryStream saved,out long bytes) {
      bytes=0;uint available;
      if(!PeekNamedPipe(pipe,IntPtr.Zero,0,IntPtr.Zero,out available,IntPtr.Zero)) { int e=Marshal.GetLastWin32Error();if(e==109 || e==232) return true;throw new Win32Exception(e); }
      if(available==0) return false;
      byte[] buffer=new byte[Math.Min(4096,(int)Math.Min(available,4096u))];uint read;
      if(!ReadFile(pipe,buffer,(uint)buffer.Length,out read,IntPtr.Zero)) {int e=Marshal.GetLastWin32Error();if(e==109 || e==232)return true;throw new Win32Exception(e);}
      bytes=read;int keep=Math.Min((int)read,Limit-(int)saved.Length);if(keep>0)saved.Write(buffer,0,keep);return read==0;
    }
    void Drain() {long n;if(!outClosed){outClosed=Poll(outRead,stdout,out n);StdoutTotal+=n;}if(!errClosed){errClosed=Poll(errRead,stderr,out n);StderrTotal+=n;} }
    void ReadExitCode() {if(ExitConfirmed){uint code;Check(GetExitCodeProcess(process,out code));ExitCode=code;}}
    void RetireWithinOriginalDeadline() {
      uint remaining=(uint)Math.Max(0,ResponseDeadlineMilliseconds-elapsed.ElapsedMilliseconds);
      uint wait=WaitForSingleObject(process,remaining);
      if(wait==0) {ExitConfirmed=true;ReadExitCode();return;}
      if(wait==UInt32.MaxValue)throw new Win32Exception(Marshal.GetLastWin32Error());
      TimedOut=true;
      if(!terminationAttempted) {terminationAttempted=true;bool killed=TerminateProcess(process,124);if(!killed && WaitForSingleObject(process,0)!=0)Check(false);}
      ExitConfirmed=WaitForSingleObject(process,3000)==0;ReadExitCode();
    }
    public void Complete() {
      if(!Resumed) throw new InvalidOperationException("Unverified child was not resumed");
      while(true) {
        if(elapsed.ElapsedMilliseconds>=ResponseDeadlineMilliseconds) {TimedOut=true;RetireWithinOriginalDeadline();break;}
        Drain();uint wait=WaitForSingleObject(process,0);if(wait==0){ExitConfirmed=true;if(elapsed.ElapsedMilliseconds>=ResponseDeadlineMilliseconds)TimedOut=true;break;}if(wait==UInt32.MaxValue)throw new Win32Exception(Marshal.GetLastWin32Error());
        System.Threading.Thread.Sleep(2);
      }
      if(ExitConfirmed){ReadExitCode();Stopwatch drain=Stopwatch.StartNew();while(!(outClosed&&errClosed)&&drain.ElapsedMilliseconds<2000){Drain();System.Threading.Thread.Sleep(1);}DrainComplete=outClosed&&errClosed;}
    }
    public void Dispose() {
      if(disposed)return;
      try {
        if(process!=IntPtr.Zero && !Resumed) {AbortedBeforeResume=true;terminationAttempted=true;Check(TerminateProcess(process,125));ExitConfirmed=WaitForSingleObject(process,3000)==0;ReadExitCode();}
        else if(process!=IntPtr.Zero && Resumed && !ExitConfirmed) RetireWithinOriginalDeadline();
      } finally {Close(ref thread);Close(ref process);Close(ref outRead);Close(ref errRead);disposed=true;}
    }
  }
}
'@

if (-not $IsWindows) { throw 'This diagnostic runs only on native Windows; parsing/unit tests do not run children.' }
Assert-XLogDiagnostic ([Environment]::Is64BitOperatingSystem -and [IntPtr]::Size -eq 8) 'Use the x64 runtime acceptance job.'
$RunnerTemp = Resolve-XLogDiagnosticDirectory $RunnerTemp
Assert-XLogDiagnostic (-not [string]::IsNullOrWhiteSpace($env:RUNNER_TEMP) -and (Test-XLogDiagnosticSamePath $RunnerTemp ([IO.Path]::GetFullPath($env:RUNNER_TEMP)))) 'RunnerTemp must equal this job RUNNER_TEMP.'
$WorkingDirectory = Resolve-XLogDiagnosticDirectory $WorkingDirectory
$OriginalNestedTemp = Resolve-XLogDiagnosticDirectory $OriginalNestedTemp
Assert-XLogDiagnosticInside $WorkingDirectory $RunnerTemp
Assert-XLogDiagnosticInside $OriginalNestedTemp $RunnerTemp
Assert-XLogDiagnostic (Test-XLogDiagnosticSamePath $OriginalNestedTemp (Join-Path $WorkingDirectory 'Temp')) 'OriginalNestedTemp must be the unchanged failed acceptance profile Temp.'
$EvidenceDirectory = [IO.Path]::GetFullPath($EvidenceDirectory)
Assert-XLogDiagnosticInside $EvidenceDirectory $RunnerTemp
Assert-XLogDiagnostic (-not (Test-Path -LiteralPath $EvidenceDirectory)) 'Preserve existing diagnostic evidence; choose a new output directory.'
$null = New-Item -ItemType Directory -Path $EvidenceDirectory
$EvidenceDirectory = Resolve-XLogDiagnosticDirectory $EvidenceDirectory
$parentEnvironment = [Environment]::GetEnvironmentVariables('Process')
$runs = [Collections.Generic.List[object]]::new()
$report = [ordered]@{ schema = 1; purpose = 'diagnostic only, not acceptance'; status = 'preflight'; startedUtc = [DateTime]::UtcNow.ToString('o'); sourceCommit = '3d9cb0981c30764f1188db350ffebc22a5f328a7'; version = '1.5.20'; responseDeadlineSeconds = 10; maximumRuns = $(if ($ABA) { 6 } else { 4 }); runs = @(); limitations = @('No long-path cause inferred by this helper; review paired raw outcomes.', 'Common suspended-create/resume-once launch differs from original acceptance and is recorded for every child.', 'Only TEMP/TMP differ within each worker A/B comparison; APPDATA, LOCALAPPDATA, USERPROFILE, PATH and CWD remain common.', 'Raw private environment evidence records controlled values and all variable value lengths, never unrelated inherited secret values.', 'Installed acceptance remains failed unless its unchanged full acceptance separately passes.') }
try {
    $InstallerReceipt = [IO.Path]::GetFullPath($InstallerReceipt)
    Assert-XLogDiagnosticInside $InstallerReceipt $RunnerTemp
    $receipt = Get-Content -LiteralPath $InstallerReceipt -Raw | ConvertFrom-Json -Depth 30
    # Receipt/default proof precedes any installed worker/payload hash or launch.
    Assert-XLogDiagnostic ($null -ne $receipt.PSObject.Properties['installationScope']) 'Missing installer scope receipt.'
    $knownRoot = switch ($receipt.installationScope) { 'currentUser' { $env:LOCALAPPDATA }; 'perMachine' { $env:ProgramW6432 }; default { throw 'Unknown installer scope.' } }
    Assert-XLogDiagnostic (-not [string]::IsNullOrWhiteSpace($knownRoot)) 'Expected scope known-folder unavailable.'
    $InstalledDirectory = [IO.Path]::GetFullPath($InstalledDirectory).TrimEnd('\')
    Assert-XLogDiagnosticReceipt $receipt $InstalledDirectory ([IO.Path]::GetFullPath((Join-Path $knownRoot 'OM0RX-xLog')))
    $nativeReceiptPath = Join-Path (Split-Path $WorkingDirectory -Parent) 'acceptance.json'
    $native = Get-Content -LiteralPath $nativeReceiptPath -Raw | ConvertFrom-Json -Depth 40
    $payloadProof = @($native.checks | Where-Object { $_.name -ceq 'payload-hashes' -and $_.passed -eq $true })
    Assert-XLogDiagnostic ($native.schema -eq 1 -and $native.commit -ceq $report.sourceCommit -and
        (Test-XLogDiagnosticSamePath $native.package $InstalledDirectory) -and $payloadProof.Count -eq 1 -and
        $payloadProof[0].evidence.files -eq 3270 -and $payloadProof[0].evidence.manifestSha256 -ceq $receipt.payloadManifestSHA256) 'Original native receipt does not prove the installed payload manifest.'
    Assert-XLogDiagnostic ((Test-XLogDiagnosticSamePath $native.isolation.workingDirectory $WorkingDirectory) -and
        (Test-XLogDiagnosticSamePath $native.isolation.childProfile $WorkingDirectory)) 'CWD/profile differs from the original acceptance receipt.'
    $commonPath = "$InstalledDirectory;$env:SystemRoot\System32;$env:SystemRoot"
    Assert-XLogDiagnostic ($native.isolation.childPath.Equals($commonPath, [StringComparison]::OrdinalIgnoreCase)) 'Common PATH differs from original installed acceptance.'
    $InstalledDirectory = Resolve-XLogDiagnosticDirectory $InstalledDirectory
    $PortableDirectory = Resolve-XLogDiagnosticDirectory $PortableDirectory
    Assert-XLogDiagnosticInside $PortableDirectory $RunnerTemp
    Assert-XLogDiagnostic (-not (Test-XLogDiagnosticSamePath $InstalledDirectory $PortableDirectory)) 'Portable and installed coordinates must be distinct.'
    $packages = @{ portable = Assert-XLogDiagnosticPayload $PortableDirectory $false; installed = Assert-XLogDiagnosticPayload $InstalledDirectory $true }
    $report.inputProof = @{ installerReceiptSHA256 = Get-XLogDiagnosticHash $InstallerReceipt; nativeReceiptSHA256 = Get-XLogDiagnosticHash $nativeReceiptPath; installationScope = $receipt.installationScope; packages = $packages; originalRuntimeStatus = $native.status }
    $short = Join-Path $RunnerTemp ('xld-' + [guid]::NewGuid().ToString('N').Substring(0,8))
    Assert-XLogDiagnostic (-not (Test-Path -LiteralPath $short) -and $short.Length -lt $OriginalNestedTemp.Length) 'Need a new strictly shorter owned TEMP root.'
    $null = New-Item -ItemType Directory -Path $short
    $short = Resolve-XLogDiagnosticDirectory $short
    Write-XLogDiagnosticJson (Join-Path $short '.xlog-local-diagnostic.json') @{ schema = 1; id = [guid]::NewGuid().ToString(); sourceCommit = $report.sourceCommit; purpose = 'owned short TEMP only; preserve after diagnostics' }
    $base = New-XLogDiagnosticEnvironment $parentEnvironment $WorkingDirectory $commonPath $OriginalNestedTemp
    $commonHash = Get-XLogDiagnosticTextHash ((Get-XLogDiagnosticEnvironmentEntries $base -WithoutTemp) -join "`0")
    $report.controls = @{ workingDirectory = $WorkingDirectory; originalNestedTemp = $OriginalNestedTemp; shortOwnedTemp = $short; commonNonTempEnvironmentSHA256 = $commonHash; parentEnvironmentChanged = $false; launch = 'CreateProcessW CREATE_SUSPENDED|CREATE_UNICODE_ENVIRONMENT|CREATE_NO_WINDOW; prove image/argv/PPID then one ResumeThread; stdin closed; response budget10s from Resume including loader' }
    Add-Type -TypeDefinition $nativeSource
    $report.status = 'running'
    $sequence = if ($ABA) { @('A','B','A') } else { @('A','B') }
    $ordinal = 0
    foreach ($condition in $sequence) {
        foreach ($kind in @('portable','installed')) {
            $ordinal++
            $directory = Join-Path $EvidenceDirectory ('{0:00}-{1}-{2}' -f $ordinal,$kind,$condition)
            $null = New-Item -ItemType Directory -Path $directory
            $temp = if ($condition -ceq 'A') { $OriginalNestedTemp } else { $short }
            $values = New-XLogDiagnosticEnvironment $parentEnvironment $WorkingDirectory $commonPath $temp
            Assert-XLogDiagnostic ((Get-XLogDiagnosticTextHash ((Get-XLogDiagnosticEnvironmentEntries $values -WithoutTemp) -join "`0")) -ceq $commonHash) 'A non-TEMP environment factor changed.'
            $entries = Get-XLogDiagnosticEnvironmentEntries $values
            $worker = [string]$packages[$kind].worker
            Assert-XLogDiagnostic ((Get-XLogDiagnosticHash $worker) -ceq '2dd9a007937b0cee8240bc73785a76ce2fbe4cc6a6dbe9dcde5114abce5593e5') 'Worker changed before probe.'
            $record = [ordered]@{ ordinal = $ordinal; package = $kind; condition = $condition; status = 'creating-suspended'; workerSHA256 = Get-XLogDiagnosticHash $worker; sourceCommit = $report.sourceCommit; fullCommandLine = [XLogLocalDiagnostic.Child]::MakeCommandLine($worker); workingDirectory = $WorkingDirectory; controlledEnvironment = @{}; environmentValueLengths = @($values.Keys | ForEach-Object { @{ name = $_; valueUtf16Length = $values[$_].Length } }); environmentBlockUtf16Length = (($entries -join "`0") + "`0`0").Length; tempUtf16Length = $temp.Length; cwdUtf16Length = $WorkingDirectory.Length; executableUtf16Length = $worker.Length; startedUtc = [DateTime]::UtcNow.ToString('o'); responseDeadlineSeconds = 10; contractPassed = $false; identityVerifiedBeforeResume = $false; parsedReply = $null }
            foreach ($key in @('PATH','USERPROFILE','APPDATA','LOCALAPPDATA','WEBVIEW2_USER_DATA_FOLDER','TEMP','TMP')) { $record.controlledEnvironment[$key] = $values[$key] }
            $child = $null
            try {
                $child = [XLogLocalDiagnostic.Child]::Create($worker, $WorkingDirectory, $entries)
                $record.ownedCreation = @{ pid = $child.Pid; fullCommandLine = $child.CommandLine; handleOwnership = 'Exclusive returned CreateProcess handle; never attach or search for another target' }
                $observedIdentity = Get-XLogDiagnosticIdentityObservations `
                    -QueryCim { Get-CimInstance Win32_Process -Filter "ProcessId=$($child.Pid)" -ErrorAction Stop } `
                    -QueryImage { $child.ImagePath() } -QueryCreationTime { $child.CreationFileTime() }
                $record.identityObservations = $observedIdentity.Observations
                $record.identityObservations.expected = @{ pid = $child.Pid; parentPID = $PID; executablePath = $worker;
                    argv = @($worker, '--local-logbook-self-test'); fullCommandLine = $child.CommandLine; workerSHA256 = $record.workerSHA256 }
                Write-XLogDiagnosticJson (Join-Path $directory 'identity-observed-before-validation.json') $record.identityObservations
                $os = $observedIdentity.CimInstance
                $observedImagePath = $observedIdentity.ImagePath
                $created = $observedIdentity.CreationFileTime
                Assert-XLogDiagnostic ($null -ne $os -and $os.ProcessId -eq $child.Pid -and $os.ParentProcessId -eq $PID -and
                    (Test-XLogDiagnosticSamePath $os.ExecutablePath $worker) -and (Test-XLogDiagnosticSamePath $observedImagePath $worker)) 'OS image/PID/PPID proof failed before Resume.'
                $argv = [XLogLocalDiagnostic.Child]::SplitCommandLine($os.CommandLine)
                Assert-XLogDiagnostic ($argv.Count -eq 2 -and (Test-XLogDiagnosticSamePath $argv[0] $worker) -and $argv[1] -ceq '--local-logbook-self-test') 'OS full command line is not the sole disposable self-test flag.'
                Assert-XLogDiagnostic ($created -gt 0 -and (Get-XLogDiagnosticHash $worker) -ceq $record.workerSHA256) 'Creation identity/hash changed before Resume.'
                $record.processIdentity = @{ pid = $child.Pid; parentPID = $os.ParentProcessId; executablePath = $os.ExecutablePath; fullCommandLine = $os.CommandLine; creationFileTime = $created; proofBeforeResumeUtc = [DateTime]::UtcNow.ToString('o') }
                $record.identityVerifiedBeforeResume = $true
                Write-XLogDiagnosticJson (Join-Path $directory 'identity-before-resume.json') $record.processIdentity
                $record.resumedUtc = [DateTime]::UtcNow.ToString('o'); $child.ResumeOnce(); $child.Complete()
                $record.timedOut = $child.TimedOut; $record.exitConfirmed = $child.ExitConfirmed; $record.exitCode = $child.ExitCode
                $record.stdoutTotalBytes = $child.StdoutTotal; $record.stderrTotalBytes = $child.StderrTotal; $record.outputTruncated = ($child.StdoutTotal -gt 65536 -or $child.StderrTotal -gt 65536); $record.drainComplete = $child.DrainComplete
                [IO.File]::WriteAllBytes((Join-Path $directory 'stdout.bin'), $child.StdoutBytes)
                [IO.File]::WriteAllBytes((Join-Path $directory 'stderr.bin'), $child.StderrBytes)
                $stdout = [Text.UTF8Encoding]::new($false,$true).GetString($child.StdoutBytes)
                $stderr = [Text.UTF8Encoding]::new($false,$true).GetString($child.StderrBytes)
                [IO.File]::WriteAllText((Join-Path $directory 'stdout.txt'), $stdout, [Text.UTF8Encoding]::new($false))
                [IO.File]::WriteAllText((Join-Path $directory 'stderr.txt'), $stderr, [Text.UTF8Encoding]::new($false))
                try { $record.parsedReply = $stdout | ConvertFrom-Json -Depth 30 } catch { $record.parseError = $_.Exception.Message }
                $record.contractPassed = (-not $child.TimedOut -and $child.ExitConfirmed -and $child.ExitCode -eq 0 -and $child.DrainComplete -and
                    -not $record.outputTruncated -and [string]::IsNullOrEmpty($stderr) -and (Test-XLogDiagnosticReply $record.parsedReply))
                $record.status = 'captured-diagnostic-not-acceptance'
                Assert-XLogDiagnostic $child.ExitConfirmed 'Owned child exit unconfirmed; stop matrix.'
                Assert-XLogDiagnostic ((Get-XLogDiagnosticHash $worker) -ceq $record.workerSHA256) 'Worker changed during probe.'
            } catch { $record.status = 'diagnostic-unavailable'; $record.error = $_.Exception.Message; throw }
            finally {
                $cleanupFailed = $false
                if ($null -ne $child) {
                    try { $child.Dispose() } catch { $cleanupFailed = $true; $record.cleanupError = $_.Exception.Message; $record.status = 'diagnostic-unavailable' }
                    $record.cleanup = @{ abortedBeforeResume = $child.AbortedBeforeResume; resumed = $child.Resumed; timedOut = $child.TimedOut; exitConfirmed = $child.ExitConfirmed; exitCode = $(if ($child.ExitConfirmed) { $child.ExitCode } else { $null }) }
                    # Preserve bounded prefixes even when identity/capture failed.
                    if (-not (Test-Path -LiteralPath (Join-Path $directory 'stdout.bin'))) { [IO.File]::WriteAllBytes((Join-Path $directory 'stdout.bin'), $child.StdoutBytes) }
                    if (-not (Test-Path -LiteralPath (Join-Path $directory 'stderr.bin'))) { [IO.File]::WriteAllBytes((Join-Path $directory 'stderr.bin'), $child.StderrBytes) }
                    $record.stdoutTotalBytes = $child.StdoutTotal; $record.stderrTotalBytes = $child.StderrTotal
                    $record.exitConfirmed = $child.ExitConfirmed; $record.exitCode = $record.cleanup.exitCode
                }
                $record.finishedUtc = [DateTime]::UtcNow.ToString('o')
                Write-XLogDiagnosticJson (Join-Path $directory 'run.json') $record
                $runs.Add($record)
                if ($cleanupFailed) { throw 'Owned diagnostic child cleanup failed; stop and preserve receipts.' }
            }
        }
    }
    Assert-XLogDiagnostic ($runs.Count -eq $report.maximumRuns) 'Incomplete paired matrix.'
    $null = Assert-XLogDiagnosticPayload $PortableDirectory $false
    $null = Assert-XLogDiagnosticPayload $InstalledDirectory $true
    $report.payloadsUnchangedAfterProbes = $true
    $report.status = 'complete-diagnostic-not-acceptance'
    $report.cause = 'UNPROVEN: inspect paired outcomes; do not infer Windows long-path mechanism from generic caught replies.'
} catch { $report.status = 'diagnostic-unavailable'; $report.error = $_.Exception.Message; throw }
finally {
    $report.runs = $runs.ToArray(); $report.finishedUtc = [DateTime]::UtcNow.ToString('o')
    Write-XLogDiagnosticJson (Join-Path $EvidenceDirectory 'diagnostic.json') $report
    Write-Host "Local self-test diagnostic evidence: $EvidenceDirectory ($($report.status)); acceptance is unchanged."
}
