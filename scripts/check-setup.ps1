<#
.SYNOPSIS
  Verify this computer is ready to work on Thinking Experiment sims with Claude, Codex, and Antigravity,
  and that nothing in the local workspace is out of sync with GitHub.

.DESCRIPTION
  Run on every computer you use (home, school):  .\scripts\check-setup.ps1
  Read-only except for `git fetch`. Prints PASS / WARN / FAIL lines and a summary.

.EXAMPLE
  .\check-setup.ps1
  .\check-setup.ps1 -Root D:\TTE-Sims
#>
param(
  [string] $Root = "$HOME\Documents\TTE-Sims",
  [string] $Org = "Thinking-Experiment-Sims",
  [string] $GitHubUser = "vladimirlopez"
)
$ErrorActionPreference = "Continue"
$script:fails = 0; $script:warns = 0

function Pass($m) { Write-Host "  PASS  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  WARN  $m" -ForegroundColor Yellow; $script:warns++ }
function Fail($m) { Write-Host "  FAIL  $m" -ForegroundColor Red; $script:fails++ }
function Section($m) { Write-Host "`n== $m ==" -ForegroundColor Cyan }
function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

Write-Host "Thinking Experiment setup check — $env:COMPUTERNAME — $(Get-Date -Format 'yyyy-MM-dd HH:mm')"

# ── 1. Network: hosts-file redirects break GitHub auth ──────────────────────
Section "Network"
$hosts = Get-Content "$env:windir\System32\drivers\etc\hosts" -ErrorAction SilentlyContinue |
  Where-Object { $_ -match '^\s*[^#].*\b(github\.com|githubusercontent\.com)\b' }
if ($hosts) { Fail "hosts file redirects GitHub: $($hosts -join '; ')  (comment these lines out as admin)" }
else { Pass "no GitHub redirects in hosts file" }

# ── 2. Git + GitHub CLI ─────────────────────────────────────────────────────
Section "Git / GitHub"
if (-not (Has git)) { Fail "git not installed (https://git-scm.com)" } else {
  $name = git config --global user.name; $email = git config --global user.email
  if ($name -and $email) { Pass "git identity: $name <$email>" } else { Fail "git identity not set (git config --global user.name / user.email)" }
}
if (-not (Has gh)) { Fail "GitHub CLI not installed (winget install GitHub.cli)" } else {
  $login = gh api user --jq .login 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $login) { Fail "gh not signed in: run  gh auth login -h github.com  (sign in by USERNAME '$GitHubUser', not 'Continue with Google')" }
  elseif ($login -ne $GitHubUser) { Fail "gh active account is '$login', expected '$GitHubUser':  gh auth switch -h github.com -u $GitHubUser" }
  else {
    Pass "gh active account: $login"
    $status = gh auth status -h github.com 2>&1 | Out-String
    $block = ($status -split "Logged in to") | Where-Object { $_ -match "account $GitHubUser\b" } | Select-Object -First 1
    foreach ($s in "repo", "workflow") {
      if ($block -match "'$s'") { Pass "token scope '$s'" } else { Fail "token missing '$s' scope:  gh auth refresh -h github.com -s $s" }
    }
    $perm = gh api "repos/$Org/sim-template" --jq '.permissions.push' 2>$null
    if ($perm -eq "true") { Pass "can push to $Org" } else { Fail "no push access to $Org/sim-template" }
  }
  $helper = git config --global --get-all credential.https://github.com.helper 2>$null
  if ($helper -match "gh(\.exe)?'? auth git-credential") { Pass "git uses gh for GitHub credentials" }
  else { Warn "git not wired to gh credentials; run  gh auth setup-git" }
}

# ── 3. Node (tests) ─────────────────────────────────────────────────────────
Section "Node"
if (Has node) {
  $major = [int]((node --version).TrimStart('v').Split('.')[0])
  if ($major -ge 22) { Pass "node $(node --version)" } else { Fail "node $(node --version) is too old; need 22+" }
} else { Fail "node not installed (winget install OpenJS.NodeJS.LTS)" }

# ── 4. AI tools ─────────────────────────────────────────────────────────────
Section "AI tools"
# Claude: desktop app Code tab and CLI share ~/.claude
if (Has claude) { Pass "Claude Code CLI $(claude --version 2>$null)" }
else { Warn "Claude Code CLI not found (the Windows app's Code tab still works; CLI is optional)" }

# Codex: ChatGPT desktop app and Codex CLI share ~/.codex/auth.json
$codexAuth = "$HOME\.codex\auth.json"
if (Test-Path $codexAuth) {
  try {
    $a = Get-Content $codexAuth -Raw | ConvertFrom-Json
    $p = $a.tokens.id_token.Split('.')[1].Replace('-', '+').Replace('_', '/')
    $p += '=' * ((4 - $p.Length % 4) % 4)
    $claims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p)) | ConvertFrom-Json
    Pass "Codex signed in as $($claims.email)"
  } catch { Pass "Codex signed in (account could not be read)" }
} else { Warn "Codex not signed in on this computer (open the ChatGPT app > Codex, or run: codex login)" }

$agy = @("$env:LOCALAPPDATA\Programs\Antigravity", "$env:LOCALAPPDATA\Programs\Antigravity IDE") | Where-Object { Test-Path $_ }
if ($agy) { Pass "Antigravity installed ($($agy -join ', '))" } else { Warn "Antigravity not found (https://antigravity.google)" }
Write-Host "        Antigravity's Google sign-in can't be read from disk: check the account icon in the app."

# ── 5. Workspace sync ───────────────────────────────────────────────────────
Section "Workspace sync ($Root)"
if (-not (Test-Path $Root)) {
  Warn "workspace folder missing; create it and clone:  gh repo clone $Org/sim-template `"$Root\sim-template`""
} else {
  $repos = Get-ChildItem $Root -Directory | Where-Object { Test-Path (Join-Path $_.FullName ".git") }
  if (-not $repos) { Warn "no git repos in $Root" }
  foreach ($r in $repos) {
    $d = $r.FullName; $n = $r.Name
    $isWorktree = (Get-Item -Force (Join-Path $d ".git")) -is [IO.FileInfo]
    git -C $d fetch --quiet --prune 2>$null
    $branch = git -C $d branch --show-current
    $dirty = @(git -C $d status --porcelain).Count
    $upstream = git -C $d rev-parse --abbrev-ref '@{u}' 2>$null
    $issues = @()
    if ($dirty) { $issues += "$dirty uncommitted file(s)" }
    if ($upstream) {
      $counts = (git -C $d rev-list --left-right --count "HEAD...$upstream") -split '\s+'
      if ([int]$counts[0] -gt 0) { $issues += "$($counts[0]) commit(s) NOT pushed" }
      if ([int]$counts[1] -gt 0) { $issues += "$($counts[1]) commit(s) behind GitHub (git pull)" }
    } elseif ($branch) { $issues += "branch '$branch' not on GitHub yet (git push -u origin $branch)" }
    if (-not $isWorktree) {
      $stashes = @(git -C $d stash list).Count
      if ($stashes) { $issues += "$stashes stash(es)" }
    }
    if (-not (Test-Path (Join-Path $d "AGENTS.md"))) { $issues += "no AGENTS.md (older sim; AIs won't get the shared rules)" }
    $label = "{0} [{1}]" -f $n, $branch
    if ($issues) { Warn ("$label  " + ($issues -join "; ")) } else { Pass "$label in sync" }
  }
}

# ── Summary ─────────────────────────────────────────────────────────────────
Write-Host ""
if ($script:fails) { Write-Host "RESULT: $($script:fails) problem(s) to fix, $($script:warns) warning(s)." -ForegroundColor Red; exit 1 }
elseif ($script:warns) { Write-Host "RESULT: ready, with $($script:warns) warning(s) to review." -ForegroundColor Yellow }
else { Write-Host "RESULT: all good." -ForegroundColor Green }
