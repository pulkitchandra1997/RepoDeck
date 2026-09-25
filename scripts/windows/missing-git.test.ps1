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
Write-Output '5 transaction fault scenarios and production syntax/guard binding passed. No Git, installer or environment mutation.'
