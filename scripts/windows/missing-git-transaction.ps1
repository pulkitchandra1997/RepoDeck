function Invoke-MissingGitTransaction {
    param([string[]]$Candidates, [scriptblock]$Hide, [scriptblock]$Restore,
        [scriptblock]$CheckAbsent, [scriptblock]$Scenario, [scriptblock]$Persist, $Record)
    $journal = [System.Collections.Generic.List[object]]::new()
    $failure = $null
    try {
        foreach ($candidate in $Candidates) {
            # Hide registers its recovery token BEFORE changing the filesystem.
            & $Hide $candidate $journal
        }
        & $CheckAbsent
        $Record.probePathsAbsent = $true
        & $Persist
        & $Scenario
        $Record.scenario = 'passed'
    } catch {
        $Record.scenario = 'failed'
        $failure = $_
    } finally {
        $Record.restoration = @()
        for ($i = $journal.Count - 1; $i -ge 0; $i--) {
            $entry = $journal[$i]
            try {
                & $Restore $entry
                $Record.restoration += @{ location = $entry.Label; status = 'restored' }
            } catch {
                $Record.restoration += @{ location = $entry.Label; status = 'failed' }
                if (-not $failure) { $failure = $_ }
            }
        }
        $Record.status = if ($failure) { 'failed' } else { 'passed' }
        & $Persist
    }
    if ($failure) { throw $failure }
}
