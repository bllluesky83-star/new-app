# Renders a thumbnail HTML page to a 1280x800 PNG with headless Chrome.
# Default: tools/thumbnail.html -> img/thumbnail.png
# Academic version: -Src tools\thumbnail-academic.html -Out img\thumbnail-academic.png
# Run: powershell -ExecutionPolicy Bypass -File tools\make-thumbnail.ps1 [-Src ...] [-Out ...]
param([string]$Src = 'tools\thumbnail.html', [string]$Out = 'img\thumbnail.png')
$root = Split-Path -Parent $PSScriptRoot
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) { $chrome = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" }
$srcUrl = 'file:///' + ((Join-Path $root $Src) -replace '\\', '/')
$outPath = Join-Path $root $Out
$profile = Join-Path $env:TEMP 'refcheck-thumb-profile'
$p = Start-Process -FilePath $chrome -PassThru -WindowStyle Hidden -ArgumentList @(
  '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', "--user-data-dir=$profile",
  '--window-size=1280,800', '--force-device-scale-factor=1', '--virtual-time-budget=8000',
  "--screenshot=$outPath", $srcUrl)
$p.WaitForExit(60000) | Out-Null
if (Test-Path $outPath) { Write-Output "Wrote $outPath" } else { Write-Error "Screenshot failed" }
