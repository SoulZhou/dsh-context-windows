# Post-restart end-to-end verification for dsh-context-windows.
#
# The host composes new bundles only at app startup, so after installing this
# plugin you must FULLY quit and reopen DSH (Ctrl+R is not enough). Then run:
#
#   powershell -File verify.ps1 -BaseUrl http://127.0.0.1:PORT
#
# Replace PORT with the GUI port printed in the DSH window (it changes on each
# restart). The script probes the plugin's own host route, then does ONE safe,
# reversible context-budget write on a WorkBuddy model and clears it again, so
# the user's real config is left exactly as it was.

param(
  [string]$BaseUrl = 'http://127.0.0.1:51396'
)

$ErrorActionPreference = 'Stop'
$base = $BaseUrl.TrimEnd('/')
$state = "$base/plugins/dsh-context-windows/state"
$set   = "$base/plugins/dsh-context-windows/set"

function Get-Json($url) {
  $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 8
  return [pscustomobject]@{ Status = [int]$r.StatusCode; Body = ($r.Content | ConvertFrom-Json) }
}

Write-Host "Base URL: $base" -ForegroundColor Cyan

# 1) The plugin host route must be composed (was 404 before the restart).
try {
  $s = Get-Json $state
  Write-Host "[1] /state -> HTTP $($s.Status)" -ForegroundColor Green
  Write-Host "    namespaces: $($s.Body.namespaces | ConvertTo-Json -Compress)" -ForegroundColor Gray
  Write-Host "    budgets:    $($s.Body.budgets | ConvertTo-Json -Compress)" -ForegroundColor Gray
} catch {
  Write-Host "[1] /state FAILED -> $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "    The host has not composed the new bundle yet. FULLY quit and reopen DSH (not just Ctrl+R), then re-run." -ForegroundColor Yellow
  exit 1
}

# 2) Roster sanity: WorkBuddy CN should list models with a native window.
$wb = Get-Json "$base/plugins/dsh-connect-workbuddy/usage?region=cn"
$models = @($wb.Body.models)
Write-Host "[2] WorkBuddy CN roster -> $($models.Count) models (control route)" -ForegroundColor Green
if ($models.Count -eq 0) { Write-Host '    No signed-in models; round-trip will be skipped.' -ForegroundColor Yellow; exit 0 }
$target = $models[0]
$native = [int]($target.nativeContextWindow ?? $target.contextWindow)
Write-Host "    target model: $($target.id) (native=$native)" -ForegroundColor Gray

# Pick a value that is valid for WorkBuddy (positive integer <= native).
$probe = 200000
if ($native -lt $probe) { $probe = $native }

$key = 'workbuddy:cn'
$original = $null
try { $original = $s.Body.budgets.$key.($target.id) } catch {}
Write-Host "[3] original budget for $($target.id) = $($original ?? '(none / default)')" -ForegroundColor Gray

$payload = @{ connector = 'workbuddy'; region = 'cn'; modelId = $target.id; value = $probe } | ConvertTo-Json
try {
  # 4) WRITE
  $w = Invoke-WebRequest -Uri $set -Method Post -Body $payload -ContentType 'application/json' -UseBasicParsing -TimeoutSec 8
  $wb2 = ($w.Content | ConvertFrom-Json)
  Write-Host "[4] POST /set -> HTTP $([int]$w.StatusCode) ok=$($wb2.ok) value=$($wb2.value)" -ForegroundColor Green

  # 5) READ BACK (effective window must now be <= probe via Math.min)
  $s2 = Get-Json $state
  $saved = $s2.Body.budgets.$key.($target.id)
  $usage2 = Get-Json "$base/plugins/dsh-connect-workbuddy/usage?region=cn"
  $eff = @($usage2.Body.models | Where-Object { $_.id -eq $target.id })[0].contextWindow
  Write-Host "[5] read-back budget=$saved effectiveWindow=$eff (probe=$probe)" -ForegroundColor $(if ($saved -eq $probe) { 'Green' } else { 'Red' })
  if ($saved -ne $probe) { throw "read-back mismatch: expected $probe, got $saved" }
} finally {
  # 6) RESTORE: always clear (or put back the original value) even on failure.
  $restore = if ($null -eq $original) { $null } else { [int]$original }
  $clr = @{ connector = 'workbuddy'; region = 'cn'; modelId = $target.id; value = $restore } | ConvertTo-Json
  try {
    $c = Invoke-WebRequest -Uri $set -Method Post -Body $clr -ContentType 'application/json' -UseBasicParsing -TimeoutSec 8
    Write-Host "[6] restore POST /set -> HTTP $([int]$c.StatusCode) (config back to original)" -ForegroundColor Green
  } catch {
    Write-Host "[6] RESTORE FAILED -> $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "    Manually clear $($target.id) in the page, or POST value=null for connector=workbuddy region=cn." -ForegroundColor Yellow
  }
}

# 7) The client bundle should also be served now.
try {
  $cli = Invoke-WebRequest -Uri "$base/client/dsh-context-windows/client.js" -UseBasicParsing -TimeoutSec 8
  Write-Host "[7] client.js -> HTTP $([int]$cli.StatusCode) (renderer bundle reachable)" -ForegroundColor Green
} catch {
  Write-Host "[7] client bundle probe -> $($_.Exception.Message) (path may differ; check the page in Settings)" -ForegroundColor Yellow
}

Write-Host 'DONE. Open Settings -> 模型上下文窗口 / Model Context Windows to use the page.' -ForegroundColor Cyan
