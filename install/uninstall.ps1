# Removes Orbit from Windows: stops it, stops it starting at login, and deletes the app.
# It then asks what to do with your data (team, chats, settings, files):
#   keep it (installing again finds it), save a backup file and remove it, or delete it.
#   Double-click install\uninstall-windows.cmd                                   asks
#   powershell -ExecutionPolicy Bypass -File install\uninstall.ps1 -Backup       saves a backup file in your user folder, then removes the data
#   powershell -ExecutionPolicy Bypass -File install\uninstall.ps1 -DeleteData   deletes the data without a backup
param([switch]$Backup, [switch]$DeleteData)
$ErrorActionPreference = 'Continue'
$Src = Split-Path -Parent $PSScriptRoot
$Data = if ($env:ORBIT_DATA) { $env:ORBIT_DATA } else { Join-Path $env:USERPROFILE '.orbit' }
$App = if ($env:ORBIT_APP_DIR) { $env:ORBIT_APP_DIR } else { Join-Path $env:LOCALAPPDATA 'Orbit' }
$interactive = [Environment]::UserInteractive -and -not [Console]::IsInputRedirected
$node = Get-Command node -ErrorAction SilentlyContinue
$tool = if (Test-Path (Join-Path $Src 'backup.mjs')) { Join-Path $Src 'backup.mjs' } else { Join-Path $App 'backup.mjs' }

# 1. Stop it, and stop it starting at login
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like "*$App*server.js*" } |
  ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null }
Unregister-ScheduledTask -TaskName 'Orbit' -Confirm:$false -ErrorAction SilentlyContinue
$shortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'Orbit.lnk'
if (Test-Path $shortcut) { Remove-Item $shortcut -Force }

# 1b. What Orbit added to Antigravity (Gemini): its "orbit" tool connection and the rule that allows it. A settings file it can't read is left alone.
$agy = Get-Command agy -ErrorAction SilentlyContinue
if ($agy -and ("$(& $agy.Source mcp list 2>&1)" -match 'mcp-bridge\.mjs')) { & $agy.Source mcp remove orbit 2>&1 | Out-Null }
if ($node) { & $node.Source -e 'const fs = require(`fs`), f = require(`path`).join(require(`os`).homedir(), `.gemini`, `antigravity-cli`, `settings.json`); let j; try { j = JSON.parse(fs.readFileSync(f, `utf8`)); } catch { process.exit(); } const a = j.permissions?.allow; if (!Array.isArray(a) || !a.includes(`mcp(orbit/*)`)) process.exit(); j.permissions.allow = a.filter((x) => x !== `mcp(orbit/*)`); fs.writeFileSync(f, JSON.stringify(j, null, 2) + `\n`);' 2>$null | Out-Null }

# 2. Your data
$choice = if ($Backup) { '2' } elseif ($DeleteData) { '3' } else { '1' }
if (-not $Backup -and -not $DeleteData -and (Test-Path $Data)) {
  $what = ''
  if ($node) {
    $json = (& $node.Source $tool info $Data 2>$null | Out-String).Trim()
    if ($json -and $json -ne 'null') {
      $j = $json | ConvertFrom-Json
      $owner = if ($j.owner) { "$($j.owner)'s team: " } else { '' }
      $people = if ($j.people -eq 1) { '1 person' } else { "$($j.people) people" }
      $what = " ($owner$people, $($j.chats) chats)"
    }
  }
  Write-Host ''
  Write-Host "  Your Orbit data is in $Data$what."
  Write-Host '    1) Keep it there. Installing Orbit again finds it. (recommended)'
  Write-Host '    2) Save a backup file in your user folder, then remove it from there'
  Write-Host '    3) Delete it'
  $answer = if ($interactive) { "$(Read-Host '  Choose 1, 2 or 3 [1]')".Trim() } else { '' }
  if ($answer -in '2', '3') { $choice = $answer }
}
if ($choice -eq '2' -and (Test-Path $Data)) {
  $file = Join-Path $env:USERPROFILE "Orbit backup $(Get-Date -Format 'yyyy-MM-dd').tar.gz"
  for ($i = 2; (Test-Path $file) -and $i -lt 10; $i++) { $file = Join-Path $env:USERPROFILE "Orbit backup $(Get-Date -Format 'yyyy-MM-dd') ($i).tar.gz" }
  $made = $false
  if ($node) { & $node.Source $tool backup $Data $file 2>$null | Out-Null; $made = ($LASTEXITCODE -eq 0) -and (Test-Path $file) }
  if ($made) {
    Remove-Item $Data -Recurse -Force
    Write-Host "  Backup saved: $file"
    Write-Host '  To use it again, run the installer and drag that file in when it asks.'
  } else { Write-Host "  Couldn't make the backup, so your data was left where it is: $Data"; $choice = '1' }
}
if ($choice -eq '3' -and (Test-Path $Data)) { Remove-Item $Data -Recurse -Force; Write-Host '  Your Orbit data is deleted.' }

# 3. The app
if (Test-Path $App) { Remove-Item $App -Recurse -Force }
Write-Host ''
Write-Host 'Orbit is removed.'
if ($choice -eq '1' -and (Test-Path $Data)) { Write-Host "Your team, chats and files are still in $Data. Installing Orbit again finds them." }

# 4. Orbit as a browser app (Chrome, Edge). Without this it keeps showing "Orbit isn't running".
#    The browser registers it with Windows; running that uninstall command makes the browser ask to remove it.
$webapps = @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -eq 'Orbit' -and $_.UninstallString -like '*--uninstall-app-id=*' })
foreach ($w in $webapps) { if ($w.UninstallString -match '^"([^"]+)"\s+(.*)$') { Start-Process $Matches[1] $Matches[2] } }
if ($webapps.Count) { Write-Host 'Your browser now asks to remove the Orbit app too: tick "Also clear data" and click Remove.' }
else { Write-Host 'If you added Orbit as an app in your browser, remove it there too: open the Orbit app, click ... (top right), choose "Uninstall Orbit" and tick "Also clear data".' }
