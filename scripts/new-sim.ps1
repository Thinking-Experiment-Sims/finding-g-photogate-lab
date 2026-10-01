<#
.SYNOPSIS
  Create a new Thinking Experiment sim from sim-template, publish it on GitHub Pages,
  and give each AI agent its own worktree + branch.

.EXAMPLE
  .\new-sim.ps1 -Name orbital-motion-sim -Description "Circular orbits and Kepler's 3rd law"
  .\new-sim.ps1 -Name orbital-motion-sim -Agents claude,codex      # only some agents
  .\new-sim.ps1 -Name existing-sim -Existing                       # just add agent worktrees to an existing sim
#>
param(
  [Parameter(Mandatory)] [string] $Name,
  [string]   $Description = "Interactive physics simulation - The Thinking Experiment",
  [string[]] $Agents = @("claude", "codex", "gemini"),
  [string]   $Topic = "v1",
  [string]   $Root = "$HOME\Documents\TTE-Sims",
  [switch]   $Existing
)
$ErrorActionPreference = "Stop"
$Org = "Thinking-Experiment-Sims"
$main = Join-Path $Root $Name

if (-not $Existing) {
  gh repo create "$Org/$Name" --public --template "$Org/sim-template" --description $Description
  Start-Sleep -Seconds 3   # template copy is async
  # Publish main branch root on GitHub Pages
  gh api -X POST "repos/$Org/$Name/pages" -f "source[branch]=main" -f "source[path]=/" | Out-Null
  gh repo edit "$Org/$Name" --homepage "https://thinking-experiment-sims.github.io/$Name/"
}

if (-not (Test-Path $main)) { gh repo clone "$Org/$Name" $main }
Push-Location $main
try {
  git pull --ff-only
  foreach ($a in $Agents) {
    $dir = "$main--$a"
    $branch = "$a/$Topic"
    if (Test-Path $dir) { Write-Host "exists: $dir"; continue }
    git worktree add -b $branch $dir main
    Write-Host "  $a -> $dir  (branch $branch)"
  }
} finally { Pop-Location }

Write-Host ""
Write-Host "Live (after first Pages build): https://thinking-experiment-sims.github.io/$Name/"
Write-Host "Open each agent in its own folder:"
foreach ($a in $Agents) { Write-Host ("  {0,-7} {1}" -f $a, "$main--$a") }
Write-Host "Review/merge from: $main"
