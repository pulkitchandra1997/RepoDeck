param([switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-HostedIsolation {
    param($Context)
    if ($Context.Actions -ne 'true' -or $Context.Environment -ne 'github-hosted' -or
        $Context.OS -ne 'Windows' -or $Context.Repository -ne 'pulkitchandra1997/RepoDeck' -or
        $Context.Event -ne 'workflow_dispatch' -or $Context.User -ne 'runneradmin' -or
        $Context.Image -notmatch '^win' -or $Context.Model -ne 'Virtual Machine' -or
        $Context.Manufacturer -ne 'Microsoft Corporation') {
        throw 'Installer lifecycle requires a disposable GitHub-hosted Windows VM.'
    }
}

function Stop-OwnedApplication {
    param($App, $Cleanup)
    $Cleanup.status = 'already-exited'
    if ($App.HasExited) { return }
    $Cleanup.status = 'requesting-close'
    [void]$App.CloseMainWindow()
    if ($App.WaitForExit(10000)) {
        $Cleanup.status = 'closed'
        return
    }
    $Cleanup.gracefulCloseTimedOut = $true
    $Cleanup.status = 'killing'
    $App.Kill()
    if (-not $App.WaitForExit(10000)) {
        $Cleanup.status = 'kill-timeout'
        throw 'Owned application did not exit within 10 seconds after Kill; cleanup incomplete.'
    }
    $Cleanup.status = 'killed'
}

# Loading this file for function tests cannot reach any installer operation.
if ($ValidateOnly) { return }
Assert-HostedIsolation @{
    Context = @{
        Actions = $env:GITHUB_ACTIONS; Environment = $env:RUNNER_ENVIRONMENT
        OS = $env:RUNNER_OS; Repository = $env:GITHUB_REPOSITORY
        Event = $env:GITHUB_EVENT_NAME; User = $env:USERNAME; Image = $env:ImageOS
        Model = (Get-CimInstance Win32_ComputerSystem).Model
        Manufacturer = (Get-CimInstance Win32_ComputerSystem).Manufacturer
    }
}
if ($env:REPODECK_DATA_DIR) { throw 'An inherited profile override is not allowed.' }
$testProfile = Join-Path $env:APPDATA 'org.repodeck.desktop'
$install = Join-Path $env:LOCALAPPDATA 'RepoDeck'
if ((Test-Path $testProfile) -or (Test-Path $install) -or
    (Test-Path (Join-Path $env:LOCALAPPDATA 'Programs/RepoDeck')) -or
    (Get-Process -Name repodeck-desktop -ErrorAction SilentlyContinue)) {
    throw 'Pre-existing RepoDeck state; refusing lifecycle test.'
}
foreach ($root in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
    if (Get-ChildItem $root -ErrorAction SilentlyContinue | Get-ItemProperty |
        Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -like '*RepoDeck*' }) {
        throw 'Existing RepoDeck registration; refusing lifecycle test.'
    }
}
& git --no-lazy-fetch --version
if ($LASTEXITCODE -ne 0) { throw 'Usable Git is required for this scenario.' }
$evidence = Join-Path $env:RUNNER_TEMP 'repodeck-lifecycle-evidence'
New-Item -ItemType Directory -Path $evidence | Out-Null
$installer = Join-Path $evidence 'preview3-setup.exe'
$expected = 'afc549ac22a021959d5511efeed7049f80a1f7b0027f427cf13b998b5fefa5a5'
Invoke-WebRequest 'https://github.com/pulkitchandra1997/RepoDeck/releases/download/v0.1.1-preview.3/RepoDeck_0.1.1-preview.3_windows_x64-setup.exe' -OutFile $installer
if ((Get-FileHash $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
    throw 'Published installer hash mismatch.'
}
$record = [ordered]@{
    version = '0.1.1-preview.3'; installerSha256 = $expected
    source = 'bbf7490b518139d138f5656291724f51b9a97550'
    harnessCommit = $env:GITHUB_SHA; runId = $env:GITHUB_RUN_ID
    status = 'running'; steps = @(); guiWorkflows = 'untested'; missingGit = 'untested'
}
function Save-Evidence {
    $record | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $evidence 'result.json')
}
function Invoke-OwnedProcess {
    param([string]$File, [string[]]$Arguments)
    $process = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru -WindowStyle Hidden
    if (-not $process.WaitForExit(180000)) {
        $process.Kill()
        throw 'Owned installer process exceeded 180 seconds.'
    }
    if ($process.ExitCode -ne 0) { throw "Installer exit code $($process.ExitCode)" }
}
function Assert-Launch {
    param([string]$Stage)
    $app = Start-Process -FilePath (Join-Path $install 'repodeck-desktop.exe') -PassThru -WindowStyle Hidden
    try {
        $deadline = [DateTime]::UtcNow.AddSeconds(60)
        do {
            Start-Sleep -Milliseconds 500
            $app.Refresh()
            if ($app.HasExited) { throw 'Owned application exited before window readiness.' }
        } until ($app.MainWindowHandle -ne 0 -or [DateTime]::UtcNow -gt $deadline)
        if ($app.MainWindowHandle -eq 0) { throw 'No native window within 60 seconds.' }
        $record.steps += @{ stage = $Stage; ownedPid = $app.Id; nativeWindow = $true }
        Save-Evidence
    } finally {
        $cleanup = @{ stage = "$Stage-cleanup"; ownedPid = $app.Id; status = 'pending'; gracefulCloseTimedOut = $false }
        $record.steps += $cleanup
        try { Stop-OwnedApplication $app $cleanup }
        finally { Save-Evidence }
    }
}
try {
    Save-Evidence
    # /D must be last for NSIS. This directory belongs only to the fresh VM.
    Invoke-OwnedProcess $installer @('/S', "/D=$install")
    Assert-Launch 'first-launch'
    New-Item -ItemType Directory -Path $testProfile -Force | Out-Null
    $settings = Join-Path $testProfile 'settings.json'
    @{ schemaVersion = 1; workspaces = @(); theme = 'dark'; maxDepth = 12
        maxEntries = 50000; excluded = @('.git', 'node_modules'); showHidden = $false
        editor = 'code'; terminal = 'system'; autoRefresh = $true
        onboardingCompleted = $true; repositoryAliases = @{} } |
        ConvertTo-Json -Depth 5 | Set-Content $settings
    $settingsHash = (Get-FileHash $settings).Hash
    $uninstaller = Join-Path $install 'uninstall.exe'
    if (-not (Test-Path $uninstaller -PathType Leaf)) { throw 'Expected uninstaller missing.' }
    # _?= prevents NSIS from handing off to a temporary uninstaller process.
    Invoke-OwnedProcess $uninstaller @('/S', "_?=$install")
    if (Test-Path (Join-Path $install 'repodeck-desktop.exe')) { throw 'Uninstall retained app executable.' }
    if ((Get-FileHash $settings).Hash -ne $settingsHash) { throw 'Uninstall changed retained settings.' }
    $record.steps += @{ stage = 'uninstall'; settingsRetained = $true }
    Save-Evidence
    Invoke-OwnedProcess $installer @('/S', "/D=$install")
    if ((Get-FileHash $settings).Hash -ne $settingsHash) { throw 'Reinstall changed retained settings.' }
    Assert-Launch 'reinstall-launch'
    if ((Get-FileHash $settings).Hash -ne $settingsHash) { throw 'Relaunch changed seeded settings.' }
    $record.steps += @{ stage = 'reinstall'; settingsRetained = $true }
    $record.status = 'passed'
} catch {
    $record.status = 'failed'
    throw
} finally { Save-Evidence }
