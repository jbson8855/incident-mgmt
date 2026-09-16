# Creates a "Incident Mgmt Service" desktop shortcut. Works from any path since it resolves relative to this script's location.

$projectDir = Split-Path -Parent $PSScriptRoot

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$env:USERPROFILE\Desktop\장애관리 서비스.lnk")
$Shortcut.TargetPath = "wscript.exe"
$Shortcut.Arguments = "`"$projectDir\scripts\start-app.vbs`""
$Shortcut.WorkingDirectory = $projectDir
$Shortcut.Description = "장애관리 서비스 실행"
$Shortcut.Save()

Write-Host "Desktop shortcut created: 장애관리 서비스"