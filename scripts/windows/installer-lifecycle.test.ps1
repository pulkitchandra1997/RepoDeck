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
