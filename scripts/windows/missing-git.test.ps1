$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. "$PSScriptRoot/missing-git-transaction.ps1"

foreach ($fault in @('none', 'hide', 'absence', 'scenario', 'restore')) {
    $state = @{ hidden = @(); restored = @(); scenarioRuns = 0; writes = 0 }
    $record = @{ status = 'running'; scenario = 'not-run'; probePathsAbsent = $false; restoration = @() }
    $hide = {
        param($candidate, $journal)
        $journal.Add(@{ Label = $candidate })
        $state.hidden += $candidate
        if ($fault -eq 'hide' -and $candidate -eq 'second') { throw 'Injected relocation failure.' }
    }
    $restore = {
        param($entry)
        $state.restored += $entry.Label
        if ($fault -eq 'restore' -and $entry.Label -eq 'second') { throw 'Injected restoration failure.' }
    }
    $absent = { if ($fault -eq 'absence') { throw 'Fallback remains present.' } }
    $scenario = { $state.scenarioRuns++; if ($fault -eq 'scenario') { throw 'Incorrect installer result.' } }
    $persist = { $state.writes++ }
    $failure = $null
    try {
        Invoke-MissingGitTransaction @('first', 'second') $hide $restore $absent $scenario $persist $record
    } catch { $failure = $_ }
    if (($null -ne $failure) -ne ($fault -ne 'none')) { throw "Incorrect outcome: $fault" }
    if (($state.restored -join ',') -ne 'second,first') { throw "Incomplete/reordered restoration: $fault" }
    if ($record.status -ne $(if ($fault -eq 'none') { 'passed' } else { 'failed' })) { throw 'False pass evidence.' }
    if ($state.writes -lt 1) { throw 'Missing final evidence.' }
    if ($fault -in @('hide', 'absence') -and $state.scenarioRuns -ne 0) { throw 'Scenario ran despite failed preconditions.' }
    if ($fault -eq 'restore' -and $record.restoration[0].status -ne 'failed') { throw 'Restoration failure concealed.' }
}
# Parse, never execute, the VM-only entry point.
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile("$PSScriptRoot/missing-git.ps1", [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'VM harness parse failed.' }
$guard = @($ast.EndBlock.Statements | Where-Object {
    $_ -is [System.Management.Automation.Language.PipelineAst] -and $_.PipelineElements[0].GetCommandName() -eq 'Assert-HostedIsolation'
})
if ($guard.Count -ne 1 -or $guard[0].Extent.Text -notmatch 'Assert-HostedIsolation -Context') { throw 'Guard binding missing.' }
$hook = Get-Content "$PSScriptRoot/../../src-tauri/windows/git-prerequisite.nsh" -Raw
$fallbacks = @([regex]::Matches($hook, 'StrCpy \$RepoDeckGit "([^"]+)"') | ForEach-Object { $_.Groups[1].Value })
$expectedFallbacks = @('$PROGRAMFILES64\Git\cmd\git.exe', '$PROGRAMFILES32\Git\cmd\git.exe', '$LOCALAPPDATA\Programs\Git\cmd\git.exe')
if (($fallbacks -join '|') -cne ($expectedFallbacks -join '|') -or
    $hook -notmatch 'SearchPath \$RepoDeckGit "git.exe"' -or
    $hook -notmatch 'IfSilent repodeck_git_abort 0' -or $hook -notmatch 'SetErrorLevel 2') {
    throw 'NSIS probe contract changed; reassess all masking paths and expected exit.'
}
# Exercise the Actions wrapper in a separate inert PowerShell process.
$helper = "$PSScriptRoot/missing-git-transaction.ps1".Replace("'", "''")
foreach ($case in @(
    @{ Code = 'Confirm-WhereAbsence 1'; Expected = 0 },
    @{ Code = 'Confirm-WhereAbsence 0'; Expected = 1 },
    @{ Code = 'Confirm-WhereAbsence 2'; Expected = 1 },
    @{ Code = 'Confirm-WhereAbsence 1; & $PSHOME/pwsh.exe -NoProfile -Command "exit 7"'; Expected = 7 },
    @{ Code = 'Confirm-WhereAbsence 1; throw "later failure"'; Expected = 1 }
)) {
    $command = "`$ErrorActionPreference = 'Stop'; . '$helper'; `$global:LASTEXITCODE = 1; " + $case.Code +
        '; if (Test-Path variable:\LASTEXITCODE) { exit $LASTEXITCODE }'
    $start = [Diagnostics.ProcessStartInfo]::new((Join-Path $PSHOME 'pwsh.exe'))
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardError = $true
    foreach ($argument in @('-NoProfile', '-EncodedCommand', [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command)))) {
        $start.ArgumentList.Add($argument)
    }
    $child = [Diagnostics.Process]::Start($start)
    try {
        if (-not $child.WaitForExit(15000)) {
            $child.Kill()
            $null = $child.WaitForExit(5000)
            throw 'Wrapper regression timed out.'
        }
        if ($child.ExitCode -ne $case.Expected) { throw "Unexpected wrapper exit: $($child.ExitCode)" }
    } finally { $child.Dispose() }
}

function Assert-Rejected {
    param([scriptblock]$Action)
    $rejected = $false
    try { & $Action } catch { $rejected = $true }
    if (-not $rejected) { throw 'Unsafe fixture unexpectedly accepted.' }
}
$fixture = Join-Path ([IO.Path]::GetTempPath()) "repodeck-negative-unit-$([guid]::NewGuid().ToString('N'))"
$link = Join-Path $fixture 'linked-install'
try {
    $null = New-Item -ItemType Directory -Path "$fixture/Windows/System32", "$fixture/Windows/SysWOW64", "$fixture/empty"
    $dirs = Get-InstallerSearchDirectories "$fixture/output" "$fixture/Windows"
    Assert-SearchDirectoriesAbsent $dirs
    Set-Content "$fixture/Windows/SysWOW64/git.exe" 'inert fixture, never executed'
    Assert-SearchDirectoriesAbsent @("$fixture/Windows/System32")
    Assert-Rejected { Assert-SearchDirectoriesAbsent $dirs }
    if ((Get-InstallDirectoryResidue "$fixture/absent" -AllowEmpty) -ne 'absent') { throw 'Absent state misreported.' }
    if ((Get-InstallDirectoryResidue "$fixture/empty" -AllowEmpty) -ne 'empty-directory') { throw 'Empty residue misreported.' }
    Assert-Rejected { Get-InstallDirectoryResidue "$fixture/empty" }
    Assert-Rejected { Get-InstallDirectoryResidue "$fixture/Windows/SysWOW64/git.exe" -AllowEmpty }
    Assert-Rejected { Get-InstallDirectoryResidue "$fixture/Windows" -AllowEmpty }
    Set-Content "$fixture/empty/hidden" 'inert'
    (Get-Item "$fixture/empty/hidden").Attributes = [IO.FileAttributes]::Hidden
    Assert-Rejected { Get-InstallDirectoryResidue "$fixture/empty" -AllowEmpty }
    $null = New-Item -ItemType Junction -Path $link -Target "$fixture/Windows"
    Assert-Rejected { Get-InstallDirectoryResidue $link -AllowEmpty }
} finally {
    if (Test-Path -LiteralPath $link) { Remove-Item -LiteralPath $link -Force }
    $resolved = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        (Split-Path $resolved -Leaf) -notlike 'repodeck-negative-unit-*') { throw 'Unsafe fixture cleanup path.' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
Write-Output '5 transaction faults, 5 wrapper exits, search-view/residue regressions and production syntax/guard binding passed. No installer or host Git mutation.'
