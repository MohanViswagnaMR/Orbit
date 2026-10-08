#!/usr/bin/env bash
# Orbit installer for macOS and Linux.
#   bash install/install.sh
# It copies Orbit to its own folder, makes it start by itself when you log in, starts it, and opens it in your browser.
# Run it again any time to update Orbit (your team and chats are kept).
#
# Optional settings (environment variables):
#   ORBIT_PORT      the port Orbit listens on (default 4321)
#   ORBIT_DATA      where your team, chats and files are kept (default ~/.orbit)
#   ORBIT_APP_DIR   where the app itself is copied (default ~/Applications/Orbit on macOS, ~/.local/share/orbit on Linux)
#   ORBIT_NO_OPEN=1 don't open the browser at the end
#   ORBIT_RESTORE   a backup file to restore (otherwise the installer asks)
set -euo pipefail

say()  { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
fail() { printf '\n  \033[31m✗ %s\033[0m\n\n' "$*" >&2; exit 1; }
# Ask a question in the terminal; with nobody to ask (no terminal), use the default.
ask() { local a=""; if [ -t 0 ]; then read -r -p "  $1 " a || true; fi; echo "${a:-$2}"; }
# A path dragged into the terminal: no quotes or backslash-escapes, ~ expanded.
clean_path() { local p; p="$(printf '%s' "$1" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  case "$p" in \'*\') p="${p#\'}"; p="${p%\'}" ;; \"*\") p="${p#\"}"; p="${p%\"}" ;; *) p="$(printf '%s' "$p" | sed -e 's/\\\(.\)/\1/g')" ;; esac
  case "$p" in "~"*) p="$HOME${p#\~}" ;; esac; printf '%s' "$p"; }
# "Sam's team: 4 people, 12 chats, 2 projects, last used 2026-10-07"
describe() { node -e 'const j = JSON.parse(process.argv[1] || "null"); if (!j) process.exit(1);
  const n = (v, one, many) => v + " " + (v === 1 ? one : many);
  console.log((j.owner ? j.owner + "\x27s team: " : "") + [n(j.people, "person", "people"), n(j.chats, "chat", "chats"), n(j.projects, "project", "projects")].join(", ")
    + (j.lastUsed ? ", last used " + String(j.lastUsed).slice(0, 10) : ""));' "$1"; }

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OS="$(uname -s)"
PORT="${ORBIT_PORT:-4321}"
DATA="${ORBIT_DATA:-$HOME/.orbit}"
LABEL="${ORBIT_LABEL:-local.orbit}"
case "$OS" in
  Darwin) APP="${ORBIT_APP_DIR:-$HOME/Applications/Orbit}" ;;
  Linux)  APP="${ORBIT_APP_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/orbit}" ;;
  *) fail "This installer is for macOS and Linux. On Windows, run install\\install-windows.cmd instead." ;;
esac

say "Installing Orbit"

# 1. Node.js 24 or newer
command -v node >/dev/null 2>&1 || fail "Node.js isn't installed. Install Node.js 24 or newer from https://nodejs.org (macOS: brew install node), then run this again."
NODE="$(command -v node)"
MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$MAJOR" -ge 24 ] || fail "Orbit needs Node.js 24 or newer; you have $(node --version). Update it from https://nodejs.org, then run this again."
ok "Node.js $(node --version)"

# 2. The AI your team runs on: Claude Code (Claude), the Codex CLI (ChatGPT) or the Antigravity CLI (Gemini). One is enough.
bin() { command -v "$1" 2>/dev/null || { [ -x "$HOME/.local/bin/$1" ] && echo "$HOME/.local/bin/$1"; } || true; }
name() { case "$1" in claude) echo "Claude (Claude Code)" ;; gpt) echo "ChatGPT (Codex CLI)" ;; gemini) echo "Gemini (Antigravity CLI)" ;; esac; }
CLAUDE="$(bin claude)"; CODEX="$(bin codex)"; AGY="$(bin agy)"; FOUND=""
if [ -n "$CLAUDE" ]; then ok "Claude Code $("$CLAUDE" --version 2>/dev/null | head -1)"; FOUND="$FOUND claude"; fi
if [ -n "$CODEX" ]; then
  if "$CODEX" login status 2>&1 | grep -qi "logged in"; then ok "Codex CLI, signed in (ChatGPT)"; FOUND="$FOUND gpt"
  else echo "  ○ The Codex CLI is installed but not signed in. To use ChatGPT, run  codex login  (then run this again, or switch it on later)."; fi
fi
if [ -n "$AGY" ]; then
  if "$AGY" models 2>&1 | grep -q '^gemini-'; then ok "Antigravity CLI, signed in (Gemini)"; FOUND="$FOUND gemini"
  else echo "  ○ The Antigravity CLI is installed but not signed in. To use Gemini, run  agy  once and sign in with Google."; fi
fi
[ -n "$FOUND" ] || fail "Orbit needs one AI to run your team, and none was found. Install one and sign in, then run this again:
      Claude:   curl -fsSL https://claude.ai/install.sh | bash      then run  claude  once and log in
      ChatGPT:  brew install --cask codex                            then run  codex login
      Gemini:   install Google Antigravity (antigravity.google)      then run  agy  once and sign in with Google"

# 3. Copy the app to its own folder (so it runs no matter where you downloaded it)
mkdir -p "$APP" "$DATA"
if [ "$SRC" != "$APP" ]; then
  cp "$SRC/server.js" "$SRC/index.html" "$SRC/backup.mjs" "$SRC/mcp-bridge.mjs" "$SRC/package.json" "$APP/"
  rm -rf "$APP/brand" && cp -R "$SRC/brand" "$APP/brand"
  rm -rf "$APP/skills" && cp -R "$SRC/skills" "$APP/skills" # Orbit's core skills
  [ -f "$SRC/README.md" ] && cp "$SRC/README.md" "$APP/"
fi
ok "App in $APP"
ok "Your data in $DATA"

# A PATH the background service can use: where node and your AI apps live, plus the usual places.
SVC_PATH="$(dirname "$NODE")"
for B in "$CLAUDE" "$CODEX" "$AGY"; do [ -n "$B" ] && SVC_PATH="$SVC_PATH:$(dirname "$B")"; done
SVC_PATH="$SVC_PATH:$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"

# 4. Your data: use what's there, start fresh, or restore a backup. Orbit is stopped first, so nothing is in use.
if [ "$OS" = "Darwin" ]; then launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
else
  if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then systemctl --user stop orbit >/dev/null 2>&1 || true; fi
  pkill -f "$APP/server.js" >/dev/null 2>&1 || true
fi
sleep 0.5
RESTORE="${ORBIT_RESTORE:-}"
FRESH=1 # a new team: ask which AI runs it (an existing team keeps its choice)
HAVE="$(node "$SRC/backup.mjs" info "$DATA" 2>/dev/null || echo null)"
if WHAT="$(describe "$HAVE" 2>/dev/null)"; then
  echo
  say "  Found your Orbit data from before, in $DATA:"
  echo "    $WHAT"
  echo "    1) Use it: keep your team, their settings, your chats and files (recommended)"
  echo "    2) Start completely fresh (your old data is moved aside, not deleted)"
  echo "    3) Restore a backup file instead"
  case "$(ask 'Choose 1, 2 or 3 [1]:' 1)" in
    2) ok "Old data moved to $(node "$SRC/backup.mjs" aside "$DATA")"; mkdir -p "$DATA"; ok "Starting fresh" ;;
    3) RESTORE="$(clean_path "$(ask 'Drag the backup file here and press Enter:' '')")"; [ -n "$RESTORE" ] || fail "No backup file given. Nothing was changed; run the installer again."; FRESH="" ;;
    *) ok "Using your data"; FRESH="" ;;
  esac
elif [ -z "$RESTORE" ] && [ -t 0 ]; then
  echo
  say "  Do you have an Orbit backup to restore?"
  echo "    Drag the backup file into this window and press Enter, or just press Enter to start fresh."
  RESTORE="$(clean_path "$(ask '>' '')")"
fi
if [ -n "$RESTORE" ]; then
  [ -f "$RESTORE" ] || fail "There's no file at $RESTORE. Nothing was changed; run the installer again."
  ABOUT="$(node "$SRC/backup.mjs" inspect "$RESTORE" 2>/dev/null || echo null)"
  WHAT="$(describe "$ABOUT" 2>/dev/null)" || fail "$RESTORE isn't an Orbit backup. Nothing was changed."
  if [ -d "$DATA" ] && [ -n "$(ls -A "$DATA" 2>/dev/null)" ]; then ok "Data that was here moved to $(node "$SRC/backup.mjs" aside "$DATA")"; fi
  node "$SRC/backup.mjs" restore "$RESTORE" "$DATA" >/dev/null || fail "Couldn't restore that backup. Nothing was lost: your file is unchanged."
  ok "Restored $WHAT"
  FRESH=""
fi
mkdir -p "$DATA"
# Which AI runs a new team, when there's more than one here. Orbit picks by itself otherwise (Claude first).
MAIN=""
set -- $FOUND
if [ -n "$FRESH" ] && [ $# -gt 1 ]; then
  echo
  say "  Which AI should run your team? You can switch on the others too, or change this later in Settings → Connectors."
  i=1; for E in "$@"; do echo "    $i) $(name "$E")"; i=$((i + 1)); done
  N="$(ask "Choose 1 to $# [1]:" 1)"
  case "$N" in [1-9]) [ "$N" -le $# ] && eval "MAIN=\${$N}" ;; esac
  MAIN="${MAIN:-$1}"
fi
if command -v curl >/dev/null 2>&1 && curl -fs -o /dev/null "http://localhost:$PORT/api/state"; then
  fail "Something else is already using port $PORT (maybe another copy of Orbit). Install with another port, e.g.  ORBIT_PORT=4400 bash install/install.sh"
fi

# 5. Start by itself when you log in, and start now
if [ "$OS" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$APP/server.js</string></array>
  <key>WorkingDirectory</key><string>$APP</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$SVC_PATH</string>
    <key>PORT</key><string>$PORT</string>
    <key>ORBIT_DATA</key><string>$DATA</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>$DATA/server.log</string>
  <key>StandardErrorPath</key><string>$DATA/server.log</string>
</dict>
</plist>
PLIST
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  ok "Starts by itself when you log in (LaunchAgent $LABEL)"
else
  if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
    UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
    mkdir -p "$UNIT_DIR"
    cat > "$UNIT_DIR/orbit.service" <<UNIT
[Unit]
Description=Orbit, your personal team of AI employees

[Service]
WorkingDirectory=$APP
ExecStart=$NODE $APP/server.js
Environment=PATH=$SVC_PATH
Environment=PORT=$PORT
Environment=ORBIT_DATA=$DATA
Restart=on-failure
StandardOutput=append:$DATA/server.log
StandardError=append:$DATA/server.log

[Install]
WantedBy=default.target
UNIT
    systemctl --user daemon-reload
    systemctl --user enable orbit >/dev/null 2>&1
    systemctl --user restart orbit
    ok "Starts by itself when you log in (systemd user service \"orbit\")"
  else
    # No systemd (some containers and WSL): start it with your desktop session instead, and start it now.
    AUTO="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
    mkdir -p "$AUTO"
    cat > "$AUTO/orbit.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Orbit
Comment=Your personal team of AI employees
Exec=env PATH=$SVC_PATH PORT=$PORT ORBIT_DATA=$DATA sh -c 'cd "$APP" && exec "$NODE" server.js >> "$DATA/server.log" 2>&1'
X-GNOME-Autostart-enabled=true
NoDisplay=true
DESKTOP
    pkill -f "$APP/server.js" >/dev/null 2>&1 || true
    # Fully detached: no part of it keeps hold of this terminal.
    (cd "$APP" && PATH="$SVC_PATH" PORT="$PORT" ORBIT_DATA="$DATA" exec nohup "$NODE" "$APP/server.js" >> "$DATA/server.log" 2>&1 < /dev/null) &
    disown 2>/dev/null || true
    ok "Starts with your desktop session (~/.config/autostart/orbit.desktop)"
  fi
fi

# 6. Wait until it answers, then open it
URL="http://localhost:$PORT"
for _ in $(seq 1 40); do
  if command -v curl >/dev/null 2>&1; then curl -fs -o /dev/null "$URL/api/state" && break
  else node -e "fetch('$URL/api/state').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" && break; fi
  sleep 0.5
done || true
if command -v curl >/dev/null 2>&1 && ! curl -fs -o /dev/null "$URL/api/state"; then
  fail "Orbit didn't start. See $DATA/server.log for why, or ask for help with what it says."
fi
ok "Orbit is running at $URL"
if [ -n "$MAIN" ]; then
  if WHY="$(node -e 'fetch(process.argv[1] + "/api/connectors", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ main: process.argv[2] }) })
      .then(async (r) => { if (!r.ok) { console.log((await r.json()).error); process.exit(1); } }, () => { console.log("Orbit did not answer"); process.exit(1); })' "$URL" "$MAIN" 2>&1)"; then
    ok "Your team runs on $(name "$MAIN")"
  else echo "  ○ Couldn't make $(name "$MAIN") the main AI: $WHY  (change it in Settings → Connectors)"; fi
fi

if [ "${ORBIT_NO_OPEN:-}" != "1" ]; then
  if [ "$OS" = "Darwin" ]; then open "$URL"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true; fi
fi

say ""
say "Done. Open $URL in your browser."
echo "  Tip: in Chrome or Edge, click the install icon in the address bar to use Orbit as an app with its own window."
echo "  To remove Orbit later: bash \"$SRC/install/uninstall.sh\""
