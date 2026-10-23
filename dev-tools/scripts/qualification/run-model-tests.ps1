<# Run in a normal PowerShell window after closing Codex. No install/download. #>
[CmdletBinding()]
param(
    [ValidateSet('qwen05-float32', 'qwen15-bfloat16')]
    [string]$ModelProfile = 'qwen15-bfloat16',
    [ValidateSet('cpu', 'cuda')][string[]]$Devices = @('cpu'),
    [ValidateSet('unchecked', 'constrained')][string[]]$Modes = @('unchecked', 'constrained'),
    [ValidateRange(1, 3)][int]$Repeats = 1,
    [ValidateSet(1, 6, 24)][int]$CaseLimit = 24,
    [string]$Python,
    [switch]$PlanOnly,
    [switch]$AllBlocked,
    [switch]$Restart,
    [string]$RemainingFrom,
    [string]$ApprovedRun,
    [string]$PlanSha256
)
$ErrorActionPreference = 'Stop'
if ($AllBlocked -and @($PSBoundParameters.Keys | Where-Object { $_ -in @('ModelProfile','Devices','Modes','Repeats','CaseLimit') }).Count) {
    throw 'AllBlocked uses the complete reviewed matrix; diagnostic subset options cannot be mixed with it.'
}
if (-not $AllBlocked -and ($ApprovedRun -or $PlanSha256 -or $Restart -or $RemainingFrom)) { throw 'ApprovedRun, PlanSha256, Restart and RemainingFrom require AllBlocked.' }
if ($RemainingFrom -and -not $PlanOnly) { throw 'RemainingFrom is frozen during planning; use PlanOnly first.' }
if ($PlanOnly -and $Restart) { throw 'Restart executes one fresh approved trial; it cannot be mixed with PlanOnly.' }
$repoRoot = (Get-Item -LiteralPath (Join-Path $PSScriptRoot '../../..')).FullName
if (-not $Python) {
    $Python = Join-Path $repoRoot 'artifacts/tmp/lancedb-python312-ai-runtime/Scripts/python.exe'
}
if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) {
    throw 'Existing AI Python runtime unavailable. Pass -Python with the path to an already prepared runtime; this script does not install one.'
}
$nodeDirectory = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin'
$priorPath = $env:PATH
$priorNoUserSite = $env:PYTHONNOUSERSITE
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath (Join-Path $nodeDirectory 'node.exe'))) {
        $env:PATH = $nodeDirectory + ';' + $env:PATH
    }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'Node is required to record the exact source identity. Install nothing automatically; use the existing repository Node runtime.'
    }
    $env:PYTHONNOUSERSITE = '1'
    $arguments = @('-s', '-B', (Join-Path $PSScriptRoot 'run_standalone_model_tests.py'), '--model-profile', $ModelProfile,
        '--devices') + $Devices + @('--modes') + $Modes + @('--repeats', "$Repeats", '--case-limit', "$CaseLimit")
    if ($AllBlocked) {
        $arguments = @('-s', '-B', (Join-Path $PSScriptRoot 'run_standalone_model_tests.py'), '--all-blocked')
        if ($ApprovedRun) { $arguments += @('--approved-run', $ApprovedRun) }
        if ($PlanSha256) { $arguments += @('--plan-sha256', $PlanSha256) }
        if ($Restart) { $arguments += '--restart' }
        if ($RemainingFrom) { $arguments += @('--remaining-from', $RemainingFrom) }
    }
    if (-not $PlanOnly) { $arguments += '--run' }
    & $Python @arguments
    $runExitCode = $LASTEXITCODE
}
finally {
    $env:PATH = $priorPath
    $env:PYTHONNOUSERSITE = $priorNoUserSite
}
exit $runExitCode
