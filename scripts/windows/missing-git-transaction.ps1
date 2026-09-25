function Confirm-WhereAbsence {
    param([int]$ExitCode)
    if ($ExitCode -ne 1) { throw 'SearchPath absence not established.' }
    # GitHub's pwsh wrapper forwards LASTEXITCODE after the script returns.
    $global:LASTEXITCODE = 0
}

function Get-InstallerSearchDirectories {
    param([string]$OutputDirectory, [string]$WindowsDirectory)
    @($OutputDirectory, "$WindowsDirectory/System32", "$WindowsDirectory/SysWOW64",
        "$WindowsDirectory/System", $WindowsDirectory)
}

function Assert-SearchDirectoriesAbsent {
    param([string[]]$Directories)
    foreach ($directory in $Directories) {
        if (Test-Path -LiteralPath (Join-Path $directory 'git.exe')) { throw 'Search directory contains Git.' }
    }
}

function Get-InstallDirectoryResidue {
    param([string]$Path, [switch]$AllowEmpty)
    if (-not (Test-Path -LiteralPath $Path)) { return 'absent' }
    $item = Get-Item -LiteralPath $Path -Force
    if (-not $AllowEmpty -or -not $item.PSIsContainer -or
        ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
        @(Get-ChildItem -LiteralPath $Path -Force).Count -ne 0) {
        throw 'Unexpected install payload, linked path or pre-existing directory.'
    }
    return 'empty-directory'
}

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
