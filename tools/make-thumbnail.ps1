# Renders tools/thumbnail.html to img/thumbnail.png (1280x800) with headless Chrome.
# Run: powershell -ExecutionPolicy Bypass -File tools\make-thumbnail.ps1
$root = Split-Path -Parent $PSScriptRoot
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) { $chrome = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" }
$src = 'file:///' + ((Join-Path $root 'tools\thumbnail.html') -replace '\\', '/')
$out = Join-Path $root 'img\thumbnail.png'
$profile = Join-Path $env:TEMP 'refcheck-thumb-profile'
$p = Start-Process -FilePath $chrome -PassThru -WindowStyle Hidden -ArgumentList @(
  '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', "--user-data-dir=$profile",
  '--window-size=1280,800', '--force-device-scale-factor=1', '--virtual-time-budget=8000',
  "--screenshot=$out", $src)
$p.WaitForExit(60000) | Out-Null
if (Test-Path $out) { Write-Output "Wrote $out" } else { Write-Error "Screenshot failed" }
