#!/usr/bin/env bash
# Removes Orbit from macOS or Linux: stops it, stops it starting at login, and deletes the app.
# It then asks what to do with your data (team, chats, settings, files):
#   keep it (installing again finds it), save a backup file and remove it, or delete it.
#   bash install/uninstall.sh                 asks (keeps it if there's no one to ask)
#   bash install/uninstall.sh --backup        saves a backup file in your home folder, then removes the data
#   bash install/uninstall.sh --delete-data   deletes the data without a backup
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OS="$(uname -s)"
DATA="${ORBIT_DATA:-$HOME/.orbit}"
LABEL="${ORBIT_LABEL:-local.orbit}"
case "$OS" in
  Darwin) APP="${ORBIT_APP_DIR:-$HOME/Applications/Orbit}" ;;
  *)      APP="${ORBIT_APP_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/orbit}" ;;
esac
ask() { local a=""; if [ -t 0 ]; then read -r -p "  $1 " a || true; fi; echo "${a:-$2}"; }
# Takes the Dock icons that open app $1 out of the Dock.
dock_remove() {
  local f i=0 hit="" url="file://${1// /%20}/" pb=/usr/libexec/PlistBuddy
  f="$(mktemp)"
  if defaults export com.apple.dock "$f" 2>/dev/null; then
    while "$pb" -c "Print :persistent-apps:$i" "$f" >/dev/null 2>&1; do
      if [ "$("$pb" -c "Print :persistent-apps:$i:tile-data:file-data:_CFURLString" "$f" 2>/dev/null)" = "$url" ]; then
        "$pb" -c "Delete :persistent-apps:$i" "$f"; hit=1
      else i=$((i + 1)); fi
    done
    if [ -n "$hit" ]; then defaults import com.apple.dock "$f"; killall Dock 2>/dev/null || true; fi
  fi
  rm -f "$f"
}

# 1. Stop it, and stop it starting at login
if [ "$OS" = "Darwin" ]; then
  PORT="$(plutil -extract EnvironmentVariables.PORT raw -o - "$HOME/Library/LaunchAgents/$LABEL.plist" 2>/dev/null || echo "${ORBIT_PORT:-4321}")"
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
else
  if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
    systemctl --user disable --now orbit >/dev/null 2>&1 || true
    rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/orbit.service"
    systemctl --user daemon-reload || true
  fi
  rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/autostart/orbit.desktop"
  pkill -f "$APP/server.js" >/dev/null 2>&1 || true
fi

# 1b. What Orbit added to Antigravity (Gemini): its "orbit" tool connection and the rule that allows it. A settings file it can't read is left alone.
AGY="$(command -v agy 2>/dev/null || { [ -x "$HOME/.local/bin/agy" ] && echo "$HOME/.local/bin/agy"; } || true)"
if [ -n "$AGY" ] && "$AGY" mcp list 2>/dev/null | grep -q 'mcp-bridge.mjs'; then "$AGY" mcp remove orbit >/dev/null 2>&1 || true; fi
node -e 'const fs = require(`fs`), f = require(`path`).join(require(`os`).homedir(), `.gemini`, `antigravity-cli`, `settings.json`); let j; try { j = JSON.parse(fs.readFileSync(f, `utf8`)); } catch { process.exit(); } const a = j.permissions?.allow; if (!Array.isArray(a) || !a.includes(`mcp(orbit/*)`)) process.exit(); j.permissions.allow = a.filter((x) => x !== `mcp(orbit/*)`); fs.writeFileSync(f, JSON.stringify(j, null, 2) + `\n`);' 2>/dev/null || true

# 2. Your data
TOOL="$SRC/backup.mjs"; [ -f "$TOOL" ] || TOOL="$APP/backup.mjs"
CHOICE=1
case "${1:-}" in
  --backup) CHOICE=2 ;;
  --delete-data) CHOICE=3 ;;
  *)
    if [ -d "$DATA" ]; then
      WHAT="$(node -e 'const j = JSON.parse(process.argv[1] || "null"); if (j) console.log(`${j.owner ? j.owner + "\x27s team: " : ""}${j.people} ${j.people === 1 ? "person" : "people"}, ${j.chats} chat${j.chats === 1 ? "" : "s"}`)' \
        "$(node "$TOOL" info "$DATA" 2>/dev/null || echo null)" 2>/dev/null || true)"
      echo
      echo "  Your Orbit data is in $DATA${WHAT:+ ($WHAT)}."
      echo "    1) Keep it there. Installing Orbit again finds it. (recommended)"
      echo "    2) Save a backup file in your home folder, then remove it from there"
      echo "    3) Delete it"
      CHOICE="$(ask 'Choose 1, 2 or 3 [1]:' 1)"
    fi ;;
esac
if [ "$CHOICE" = "2" ] && [ -d "$DATA" ]; then
  FILE="$HOME/Orbit backup $(date +%Y-%m-%d).tar.gz"
  for i in 2 3 4 5 6 7 8 9; do [ -e "$FILE" ] || break; FILE="$HOME/Orbit backup $(date +%Y-%m-%d) ($i).tar.gz"; done
  node "$TOOL" backup "$DATA" "$FILE" >/dev/null || { echo "  Couldn't make the backup, so your data was left where it is: $DATA"; CHOICE=1; }
  if [ "$CHOICE" = "2" ]; then rm -rf "$DATA"; echo "  Backup saved: $FILE"; echo "  To use it again, run the installer and drag that file in when it asks."; fi
fi
if [ "$CHOICE" = "3" ]; then rm -rf "$DATA"; echo "  Your Orbit data is deleted."; fi

# 3. The app
rm -rf "$APP"

# 4. Orbit as a browser app (Chrome, Edge, Brave): its app and Dock icon. Without this it keeps showing "Orbit isn't running".
WEBAPP=""
if [ "$OS" = "Darwin" ]; then
  for SHIM in "$HOME/Applications/"*" Apps.localized"/*.app; do
    [ "$(plutil -extract CrAppModeShortcutURL raw -o - "$SHIM/Contents/Info.plist" 2>/dev/null)" = "http://localhost:$PORT/" ] || continue
    dock_remove "$SHIM"; rm -rf "$SHIM"; WEBAPP=1
  done
fi

echo
echo "Orbit is removed."
if [ "$CHOICE" = "1" ] && [ -d "$DATA" ]; then echo "Your team, chats and files are still in $DATA. Installing Orbit again finds them."; fi
# The browser's own app list can only be changed by the browser.
if [ -n "$WEBAPP" ]; then
  echo "Its browser app is removed too. Chrome may still list it on chrome://apps: right-click it there, choose \"Remove from Chrome\" and tick \"Also clear data\"."
elif [ "$OS" != "Darwin" ]; then
  echo "If you added Orbit as an app in your browser, remove it there too: open the Orbit app, click ⋮ (top right), choose \"Uninstall Orbit\" and tick \"Also clear data\"."
fi
