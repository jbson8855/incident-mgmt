# Launch Incident Mgmt service: start the dev server if it's not already running, then open the browser.

$projectPath = Split-Path -Parent $PSScriptRoot
$port = 3001
$url = "http://localhost:$port"

$portInUse = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue

if (-not $portInUse) {
    Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$projectPath'; npm run dev" -WindowStyle Minimized

    $maxWait = 30
    $waited = 0
    while (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) -and $waited -lt $maxWait) {
        Start-Sleep -Seconds 1
        $waited++
    }
}

Start-Process $url