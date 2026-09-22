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

$lanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike "169.254.*" -and $_.IPAddress -ne "127.0.0.1" -and $_.PrefixOrigin -ne "WellKnown" } |
    Select-Object -First 1 -ExpandProperty IPAddress

Start-Process $url

if ($lanIp -and -not $portInUse) {
    (New-Object -ComObject WScript.Shell).Popup(
        "다른 기기에서 접속: http://$($lanIp):$port",
        8, "Incident Mgmt 서비스 실행됨", 64
    ) | Out-Null
}