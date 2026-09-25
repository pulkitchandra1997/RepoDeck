$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. "$PSScriptRoot/installer-lifecycle.ps1" -ValidateOnly
. "$PSScriptRoot/missing-git-transaction.ps1"

Assert-HostedIsolation -Context @{
    Actions = $env:GITHUB_ACTIONS; Environment = $env:RUNNER_ENVIRONMENT
    OS = $env:RUNNER_OS; Repository = $env:GITHUB_REPOSITORY
    Event = $env:GITHUB_EVENT_NAME; User = $env:USERNAME; Image = $env:ImageOS
    Model = (Get-CimInstance Win32_ComputerSystem).Model
    Manufacturer = (Get-CimInstance Win32_ComputerSystem).Manufacturer
}
# All writes, environment masking and relocation are below the hosted-VM guard.
if (-not [Environment]::Is64BitProcess) { throw 'Use 64-bit PowerShell for both NSIS Program Files roots.' }
if ($env:REPODECK_DATA_DIR) { throw 'Inherited settings override is not permitted.' }
$output = Join-Path $env:RUNNER_TEMP 'repodeck-missing-git'
New-Item -ItemType Directory -Path $output | Out-Null
$record = [ordered]@{
    harnessCommit = $env:GITHUB_SHA; runId = $env:GITHUB_RUN_ID
    installerSha256 = 'afc549ac22a021959d5511efeed7049f80a1f7b0027f427cf13b998b5fefa5a5'
    source = 'bbf7490b518139d138f5656291724f51b9a97550'
    status = 'running'; scenario = 'not-run'; probePathsAbsent = $false
    restoration = @(); environmentRestored = $false; phase = 'preflight'
    interactiveGitInstallation = 'pending'
}
$persist = { $record | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $output 'result.json') }
$oldPath = $env:PATH
$oldLocation = Get-Location
$installer = Join-Path $output 'preview3-setup.exe'
$install = Join-Path $env:LOCALAPPDATA 'RepoDeck'
$statePaths = @($install, (Join-Path $env:LOCALAPPDATA 'Programs/RepoDeck'),
    (Join-Path $env:APPDATA 'org.repodeck.desktop'),
    (Join-Path $env:LOCALAPPDATA 'org.repodeck.desktop'))
function Assert-NoProductState {
    foreach ($item in $statePaths) {
        if (Test-Path -LiteralPath $item) { throw 'Unexpected RepoDeck payload or settings state.' }
    }
    if (Get-Process -Name repodeck-desktop -ErrorAction SilentlyContinue) { throw 'Unexpected RepoDeck process.' }
    foreach ($root in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
        if (Test-Path $root) {
            if (Get-ChildItem $root | Get-ItemProperty | Where-Object {
                ($_.PSObject.Properties['DisplayName'] -and $_.DisplayName -like '*RepoDeck*') -or
                $_.PSChildName -like '*RepoDeck*' -or $_.PSChildName -eq 'org.repodeck.desktop'
            }) { throw 'Unexpected RepoDeck uninstall registration.' }
        }
    }
}
function Assert-UnlinkedPath {
    param([string]$Path)
    $cursor = $Path
    while ($cursor) {
        if ((Test-Path -LiteralPath $cursor) -and
            ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Refusing a linked Git probe path.'
        }
        $cursor = Split-Path -Parent $cursor
    }
}
try {
    & $persist
    Assert-NoProductState
    Invoke-WebRequest 'https://github.com/pulkitchandra1997/RepoDeck/releases/download/v0.1.1-preview.3/RepoDeck_0.1.1-preview.3_windows_x64-setup.exe' -OutFile $installer -TimeoutSec 120
    if ((Get-FileHash $installer).Hash.ToLowerInvariant() -ne $record.installerSha256) { throw 'Installer hash mismatch.' }
    $candidates = @(
        (Join-Path $env:ProgramFiles 'Git/cmd/git.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Git/cmd/git.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs/Git/cmd/git.exe')
    ) | Select-Object -Unique
    $labels = @{}
    for ($i = 0; $i -lt $candidates.Count; $i++) { $labels[$candidates[$i]] = "fallback-$i" }
    # SearchPath may consult application/current/system/Windows directories as well as PATH.
    $searchDirs = @($output, "$env:WINDIR/System32", "$env:WINDIR/System", $env:WINDIR)
    foreach ($directory in $searchDirs) {
        if (Test-Path -LiteralPath (Join-Path $directory 'git.exe')) { throw 'Git in an unmaskable system/search directory.' }
    }
    foreach ($candidate in $candidates) { Assert-UnlinkedPath $candidate }
    $record.phase = 'mask-and-test'
    $env:PATH = "$env:WINDIR/System32"
    Set-Location -LiteralPath $output
    $hide = {
        param($candidate, $journal)
        if (Test-Path -LiteralPath $candidate) {
            $backup = "$candidate.repodeck-$([guid]::NewGuid().ToString('N'))"
            $entry = @{ Original = $candidate; Backup = $backup; Hash = (Get-FileHash $candidate).Hash; Label = $labels[$candidate] }
            $journal.Add($entry)
            Move-Item -LiteralPath $candidate -Destination $backup -ErrorAction Stop
        }
    }
    $restore = {
        param($entry)
        if (Test-Path -LiteralPath $entry.Backup) {
            if (Test-Path -LiteralPath $entry.Original) { throw 'Restoration collision; refusing overwrite.' }
            Move-Item -LiteralPath $entry.Backup -Destination $entry.Original -ErrorAction Stop
        }
        if ((Get-FileHash -LiteralPath $entry.Original).Hash -ne $entry.Hash) { throw 'Restored Git hash mismatch.' }
    }
    $absent = {
        foreach ($candidate in $candidates) {
            if (Test-Path -LiteralPath $candidate) { throw 'NSIS fallback Git remains present.' }
        }
        & "$env:WINDIR/System32/where.exe" git.exe 2>$null
        if ($LASTEXITCODE -ne 1) { throw 'SearchPath absence not established.' }
        foreach ($directory in $searchDirs) {
            if (Test-Path -LiteralPath (Join-Path $directory 'git.exe')) { throw 'Search directory contains Git.' }
        }
    }
    $scenario = {
        $process = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$install") -WorkingDirectory $output -WindowStyle Hidden -PassThru
        if (-not $process.WaitForExit(60000)) {
            $record.installerTimeout = $true
            $process.Kill()
            $record.ownedProcessExitedAfterKill = $process.WaitForExit(10000)
            throw 'Silent setup timed out; prerequisite rejection unproven.'
        }
        $record.exitCode = $process.ExitCode
        if ($process.ExitCode -ne 2) { throw 'Expected missing-Git exit code 2.' }
        Assert-NoProductState
        $record.noProductState = $true
    }
    Invoke-MissingGitTransaction -Candidates $candidates -Hide $hide -Restore $restore -CheckAbsent $absent -Scenario $scenario -Persist $persist -Record $record
} catch {
    $record.status = 'failed'
    throw
} finally {
    $env:PATH = $oldPath
    Set-Location -LiteralPath $oldLocation.Path
    $record.environmentRestored = $true
    & $persist
}
