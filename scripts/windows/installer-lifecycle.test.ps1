$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/installer-lifecycle.ps1" -ValidateOnly
$valid = @{
    Actions = 'true'; Environment = 'github-hosted'; OS = 'Windows'
    Repository = 'pulkitchandra1997/RepoDeck'; Event = 'workflow_dispatch'
    User = 'runneradmin'; Image = 'win25'; Model = 'Virtual Machine'
    Manufacturer = 'Microsoft Corporation'
}
Assert-HostedIsolation $valid
foreach ($key in @($valid.Keys)) {
    $invalid = $valid.Clone()
    $invalid[$key] = 'invalid'
    $rejected = $false
    try { Assert-HostedIsolation $invalid } catch { $rejected = $true }
    if (-not $rejected) { throw "Guard accepted invalid $key" }
}
Write-Output '10 isolation guard cases passed; no installers executed.'

# Execute only the parsed top-level guard command, never the installer script.
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    "$PSScriptRoot/installer-lifecycle.ps1", [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Harness parse failed.' }
$calls = @($ast.EndBlock.Statements | Where-Object {
    $_ -is [System.Management.Automation.Language.PipelineAst] -and
    $_.PipelineElements[0].GetCommandName() -eq 'Assert-HostedIsolation'
})
if ($calls.Count -ne 1) { throw 'Expected exactly one production guard invocation.' }
& {
    function Get-CimInstance {
        param($ClassName)
        if ($ClassName -ne 'Win32_ComputerSystem') { throw 'Unexpected hardware query.' }
        return @{ Model = 'Virtual Machine'; Manufacturer = 'Microsoft Corporation' }
    }
    $fixture = @{
        GITHUB_ACTIONS = 'true'; RUNNER_ENVIRONMENT = 'github-hosted'; RUNNER_OS = 'Windows'
        GITHUB_REPOSITORY = 'pulkitchandra1997/RepoDeck'; GITHUB_EVENT_NAME = 'workflow_dispatch'
        USERNAME = 'runneradmin'; ImageOS = 'win25'
    }
    $saved = @{}
    try {
        foreach ($key in $fixture.Keys) {
            $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
            [Environment]::SetEnvironmentVariable($key, $fixture[$key], 'Process')
        }
        $call = [scriptblock]::Create($calls[0].Extent.Text)
        & $call
        [Environment]::SetEnvironmentVariable('RUNNER_ENVIRONMENT', 'self-hosted', 'Process')
        $rejected = $false
        try { & $call } catch { $rejected = $true }
        if (-not $rejected) { throw 'Production call accepted a self-hosted runner.' }
    } finally {
        foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process') }
    }
}
Write-Output '2 production call-site binding cases passed; only the guard command executed.'

foreach ($scenario in @('already-exited', 'closed', 'killed', 'kill-timeout')) {
    $app = [pscustomobject]@{ HasExited = ($scenario -eq 'already-exited'); Scenario = $scenario; Waits = @(); Kills = 0 }
    $app | Add-Member ScriptMethod CloseMainWindow { return $true }
    $app | Add-Member ScriptMethod Kill { $this.Kills++ }
    $app | Add-Member ScriptMethod WaitForExit {
        param($Timeout)
        if ($Timeout -ne 10000) { throw 'Unexpected or unbounded cleanup wait.' }
        $this.Waits += $Timeout
        return ($this.Scenario -eq 'closed' -or ($this.Scenario -eq 'killed' -and $this.Waits.Count -eq 2))
    }
    $cleanup = @{ status = 'pending'; gracefulCloseTimedOut = $false }
    $failure = $null
    try { Stop-OwnedApplication $app $cleanup } catch { $failure = $_ }
    if ($cleanup.status -ne $scenario) { throw "Incorrect cleanup status for $scenario" }
    if ($scenario -eq 'kill-timeout') {
        if (-not $failure -or $failure.ToString() -notmatch 'cleanup incomplete') { throw 'Timeout must fail honestly.' }
    } elseif ($failure) { throw $failure }
    $expectedWaits = switch ($scenario) { 'already-exited' { 0 }; 'closed' { 1 }; default { 2 } }
    if ($app.Waits.Count -ne $expectedWaits) { throw 'Incorrect bounded wait count.' }
    $forced = $scenario -in @('killed', 'kill-timeout')
    if ($app.Kills -ne [int]$forced -or $cleanup.gracefulCloseTimedOut -ne $forced) { throw 'Incorrect forced cleanup evidence.' }
}
Write-Output '4 bounded cleanup cases passed using inert doubles; no processes launched.'
