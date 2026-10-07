# Orbit installer for Windows.
#   Double-click install\install-windows.cmd
#   (or in PowerShell: powershell -ExecutionPolicy Bypass -File install\install.ps1)
# It copies Orbit to its own folder, finds your data from before (or a backup to restore), makes Orbit start by itself
# when you log in, starts it, and opens it in your browser. Run it again any time to update Orbit.
#
# Optional settings (environment variables):
#   ORBIT_PORT      the port Orbit listens on (default 4321)
#   ORBIT_DATA      where your team, chats and files are kept (default %USERPROFILE%\.orbit)
#   ORBIT_APP_DIR   where the app itself is copied (default %LOCALAPPDATA%\Orbit)
#   ORBIT_NO_OPEN=1 don't open the browser at the end
#   ORBIT_RESTORE   a backup file to restore (otherwise the installer asks)
$ErrorActionPreference = 'Stop'

function Say($text) { Write-Host $text -ForegroundColor White }
function Ok($text) { Write-Host "  [ok] $text" -ForegroundColor Green }
function Warn($text) { Write-Host "  [!] $text" -ForegroundColor Yellow }
function Fail($text) { Write-Host "`n  [x] $text`n" -ForegroundColor Red; exit 1 }
$interactive = [Environment]::UserInteractive -and -not [Console]::IsInputRedirected
# Ask a question; with nobody to ask, use the default.
function Ask($question, $default) { $a = if ($interactive) { Read-Host "  $question" } else { '' }; if ([string]::IsNullOrWhiteSpace($a)) { $default } else { $a.Trim() } }
# A path dragged into the window: no quotes, ~ expanded.
function CleanPath($p) { $p = "$p".Trim().Trim('"').Trim("'"); if ($p.StartsWith('~')) { $p = $env:USERPROFILE + $p.Substring(1) }; $p }

$Src = Split-Path -Parent $PSScriptRoot
$Port = if ($env:ORBIT_PORT) { $env:ORBIT_PORT } else { '4321' }
$Data = if ($env:ORBIT_DATA) { $env:ORBIT_DATA } else { Join-Path $env:USERPROFILE '.orbit' }
$App = if ($env:ORBIT_APP_DIR) { $env:ORBIT_APP_DIR } else { Join-Path $env:LOCALAPPDATA 'Orbit' }
$url = "http://localhost:$Port"

Say 'Installing Orbit'

# 1. Node.js 24 or newer
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "Node.js isn't installed. Install Node.js 24 or newer from https://nodejs.org (or run: winget install OpenJS.NodeJS.LTS), then run this again." }
$major = [int](& $node.Source -p "process.versions.node.split('.')[0]")
if ($major -lt 24) { Fail "Orbit needs Node.js 24 or newer; you have $(& $node.Source --version). Update it from https://nodejs.org, then run this again." }
Ok "Node.js $(& $node.Source --version)"

# 2. Claude Code, which your team runs on (the native claude.exe)
$claude = Get-Command claude -ErrorAction SilentlyContinue
if (-not $claude) { Fail "Claude Code isn't installed. In PowerShell run:  irm https://claude.ai/install.ps1 | iex   then run  claude  once and log in, then run this installer again." }
if ($claude.Source -notlike '*.exe') { Fail "Orbit needs the native Claude Code (claude.exe), but found $($claude.Source). Install it with:  irm https://claude.ai/install.ps1 | iex" }
Ok "Claude Code $(& $claude.Source --version)"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Warn 'Git for Windows is not installed. Claude Code uses it to run commands; get it from https://git-scm.com/download/win' }

# Orbit's data tool (backup.mjs): its answer, or $null if it failed.
$tool = Join-Path $Src 'backup.mjs'
function Tool { $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = (& $node.Source $tool @args 2>$null | Out-String).Trim(); if ($LASTEXITCODE -eq 0) { $out } else { $null } } finally { $ErrorActionPreference = $old } }
# "Sam's team: 4 people, 12 chats, 2 projects, last used 2026-10-07"
function Describe($json) {
  if (-not $json -or $json -eq 'null') { return $null }
  $j = $json | ConvertFrom-Json
  $people = if ($j.people -eq 1) { '1 person' } else { "$($j.people) people" }
  $chats = if ($j.chats -eq 1) { '1 chat' } else { "$($j.chats) chats" }
  $projects = if ($j.projects -eq 1) { '1 project' } else { "$($j.projects) projects" }
  $owner = if ($j.owner) { "$($j.owner)'s team: " } else { '' }
  $last = if ($j.lastUsed) { ", last used $("$($j.lastUsed)".Substring(0, 10))" } else { '' }
  "$owner$people, $chats, $projects$last"
}

# 3. Copy the app to its own folder (so it runs no matter where you downloaded it)
New-Item -ItemType Directory -Force -Path $App, $Data | Out-Null
if ((Resolve-Path $Src).Path -ne (Resolve-Path $App).Path) {
  Copy-Item (Join-Path $Src 'server.js'), (Join-Path $Src 'index.html'), (Join-Path $Src 'backup.mjs'), (Join-Path $Src 'package.json') -Destination $App -Force
  if (Test-Path (Join-Path $App 'brand')) { Remove-Item (Join-Path $App 'brand') -Recurse -Force }
  Copy-Item (Join-Path $Src 'brand') -Destination (Join-Path $App 'brand') -Recurse -Force
  if (Test-Path (Join-Path $Src 'README.md')) { Copy-Item (Join-Path $Src 'README.md') -Destination $App -Force }
}
Ok "App in $App"

# 4. Your data: use what's there, start fresh, or restore a backup. Orbit is stopped first, so nothing is in use.
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like "*$App*server.js*" } |
  ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null }
Start-Sleep -Milliseconds 500
$restore = $env:ORBIT_RESTORE
$have = Describe (Tool info $Data)
if ($have) {
  Write-Host ''
  Say "  Found your Orbit data from before, in ${Data}:"
  Write-Host "    $have"
  Write-Host '    1) Use it: keep your team, their settings, your chats and files (recommended)'
  Write-Host '    2) Start completely fresh (your old data is moved aside, not deleted)'
  Write-Host '    3) Restore a backup file instead'
  switch (Ask 'Choose 1, 2 or 3 [1]' '1') {
    '2' { Ok "Old data moved to $(Tool aside $Data)"; New-Item -ItemType Directory -Force -Path $Data | Out-Null; Ok 'Starting fresh' }
    '3' { $restore = CleanPath (Ask 'Drag the backup file here and press Enter' ''); if (-not $restore) { Fail 'No backup file given. Nothing was changed; run the installer again.' } }
    default { Ok 'Using your data' }
  }
} elseif (-not $restore -and $interactive) {
  Write-Host ''
  Say '  Do you have an Orbit backup to restore?'
  Write-Host '    Drag the backup file into this window and press Enter, or just press Enter to start fresh.'
  $restore = CleanPath (Ask '>' '')
}
if ($restore) {
  if (-not (Test-Path -LiteralPath $restore -PathType Leaf)) { Fail "There's no file at $restore. Nothing was changed; run the installer again." }
  $what = Describe (Tool inspect $restore)
  if (-not $what) { Fail "$restore isn't an Orbit backup. Nothing was changed." }
  if ((Test-Path $Data) -and (Get-ChildItem -Force $Data | Select-Object -First 1)) { Ok "Data that was here moved to $(Tool aside $Data)" }
  if ($null -eq (Tool restore $restore $Data)) { Fail "Couldn't restore that backup. Nothing was lost: your file is unchanged." }
  Ok "Restored $what"
}
New-Item -ItemType Directory -Force -Path $Data | Out-Null
Ok "Your data in $Data"
$busy = $false
try { Invoke-WebRequest "$url/api/state" -UseBasicParsing -TimeoutSec 2 | Out-Null; $busy = $true } catch { }
if ($busy) { Fail "Something else is already using port $Port (maybe another copy of Orbit). Set a different port first, e.g.  `$env:ORBIT_PORT = 4400  and run the installer again." }

# 5. A hidden starter: runs Orbit with no window and writes its log to the data folder.
$log = Join-Path $Data 'server.log'
$vbs = Join-Path $App 'start-orbit.vbs'
$cmdline = 'cmd /c ""{0}" "{1}" >> "{2}" 2>&1"' -f $node.Source, (Join-Path $App 'server.js'), $log
$run = '"' + $cmdline.Replace('"', '""') + '"'
@"
' Starts Orbit with no window. Made by the Orbit installer; run the installer again to change it.
Set sh = CreateObject("WScript.Shell")
Set env = sh.Environment("PROCESS")
env("PORT") = "$Port"
env("ORBIT_DATA") = "$Data"
sh.CurrentDirectory = "$App"
sh.Run $run, 0, False
"@ | Set-Content -Path $vbs -Encoding Unicode

# 6. Start by itself when you log in: Task Scheduler, or the Startup folder if that isn't allowed here.
$shortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'Orbit.lnk'
try {
  $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName 'Orbit' -Action $action -Trigger $trigger -Settings $settings -Description 'Orbit: your personal team of Claude employees' -Force | Out-Null
  if (Test-Path $shortcut) { Remove-Item $shortcut -Force }
  Ok 'Starts by itself when you log in (Task Scheduler: Orbit)'
} catch {
  $link = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
  $link.TargetPath = 'wscript.exe'
  $link.Arguments = "`"$vbs`""
  $link.WorkingDirectory = $App
  $link.Save()
  Ok 'Starts by itself when you log in (Startup folder)'
}

# 7. Start it now, wait until it answers, then open it
Start-Process 'wscript.exe' -ArgumentList "`"$vbs`""
$up = $false
for ($i = 0; $i -lt 40 -and -not $up; $i++) {
  try { Invoke-WebRequest "$url/api/state" -UseBasicParsing -TimeoutSec 2 | Out-Null; $up = $true } catch { Start-Sleep -Milliseconds 500 }
}
if (-not $up) { Fail "Orbit didn't start. See $log for why, or ask for help with what it says." }
Ok "Orbit is running at $url"
if ($env:ORBIT_NO_OPEN -ne '1') { Start-Process $url }

Say ''
Say "Done. Open $url in your browser."
Write-Host '  Tip: in Chrome or Edge, click the install icon in the address bar to use Orbit as an app with its own window.'
Write-Host '  To remove Orbit later: double-click install\uninstall-windows.cmd'
