# Setting up Orbit

This guide takes you from nothing to a working Orbit, step by step. It takes about 10 minutes. You only need to type a few commands, and each one is given in full.

**Contents**

1. [What you need](#1-what-you-need)
2. [Install Node.js](#2-install-nodejs)
3. [Install Claude Code and log in](#3-install-claude-code-and-log-in)
4. [Download Orbit](#4-download-orbit)
5. [Run the installer](#5-run-the-installer)
6. [Your first five minutes](#6-your-first-five-minutes)
7. [Updating Orbit](#7-updating-orbit)
8. [Removing Orbit](#8-removing-orbit)
   - [Backups, reinstalling and moving to another computer](#backups-reinstalling-and-moving-to-another-computer)
9. [Where everything is](#9-where-everything-is)
10. [Settings for the installer](#10-settings-for-the-installer)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. What you need

| | Why |
|---|---|
| A Mac, a Windows PC or a Linux PC | Orbit runs on your own computer. |
| A Claude plan that includes Claude Code | Your team works through Claude Code, on your account. Their work counts towards your plan. |
| Node.js 24 or newer | Orbit is a small Node.js program. |
| Claude Code, logged in | Each employee is a Claude Code session. |
| **Windows only:** Git for Windows | Claude Code uses it to run commands. |
| A web browser | Orbit opens at `http://localhost:4321`. |

Already have Node.js 24+ and Claude Code? Skip to [step 4](#4-download-orbit).

## 2. Install Node.js

Check whether you have it: open a terminal (on Windows, **PowerShell**) and run:

```sh
node --version
```

If it prints `v24` or a higher number, you're set. Otherwise:

- **macOS:** download the installer from [nodejs.org](https://nodejs.org) and open it. If you use Homebrew, run `brew install node` instead.
- **Windows:** download the installer from [nodejs.org](https://nodejs.org) and run it, or in PowerShell run:
  ```powershell
  winget install OpenJS.NodeJS.LTS
  ```
- **Linux:** the version in many distributions is too old. Follow [nodejs.org/en/download](https://nodejs.org/en/download), which shows the exact commands for your system (for example with `nvm`).

Close the terminal and open a new one, then run `node --version` again to check.

## 3. Install Claude Code and log in

- **macOS and Linux:** in a terminal, run:
  ```sh
  curl -fsSL https://claude.ai/install.sh | bash
  ```
- **Windows:** first install [Git for Windows](https://git-scm.com/download/win) (the default options are fine). Then, in PowerShell, run:
  ```powershell
  irm https://claude.ai/install.ps1 | iex
  ```

Then log in. Run `claude`, follow the steps in your browser, and type `/exit` once it says you're logged in. Orbit uses this login. It never asks for a password or an API key.

## 4. Download Orbit

Either:

- **Download the ZIP:** on [the Orbit page on GitHub](https://github.com/MohanViswagnaMR/Orbit), click **Code → Download ZIP**, then unzip it anywhere, for example in Downloads.
- **Or use Git:**
  ```sh
  git clone https://github.com/MohanViswagnaMR/Orbit.git
  ```

It doesn't matter where you put this folder. The installer copies Orbit to its own place, so afterwards you can delete the download.

## 5. Run the installer

### macOS

1. Open the Orbit folder, then the `install` folder.
2. Double-click **Install Orbit (Mac).command**. A Terminal window opens and the installer runs.
   - If macOS says it "can't be opened because it is from an unidentified developer": right-click the file, choose **Open**, then **Open** again.
   - Or, in Terminal, go to the Orbit folder and run `bash install/install.sh`.

### Windows

1. Open the Orbit folder, then the `install` folder.
2. Double-click **install-windows.cmd**. A window opens and the installer runs.
   - If Windows shows "Windows protected your PC": click **More info**, then **Run anyway**.
   - Or, in PowerShell, go to the Orbit folder and run:
     ```powershell
     powershell -ExecutionPolicy Bypass -File install\install.ps1
     ```

### Linux

In a terminal, go to the Orbit folder and run:

```sh
bash install/install.sh
```

### What the installer does

1. Checks for Node.js 24+ and Claude Code, and tells you what to install if something is missing.
2. Copies Orbit to its own folder (see [where everything is](#9-where-everything-is)).
3. Looks for your Orbit data:
   - **If you've used Orbit on this computer before,** it shows whose team it is and how many people and chats are in it, then asks:
     1. **Use it.** Keep your team, their settings, your chats and files.
     2. **Start completely fresh.** Your old data is moved aside (to a folder like `~/.orbit-old-2026-10-07`), never deleted.
     3. **Restore a backup file instead.**
   - **If there's no data yet,** it asks whether you have a backup to restore. Drag the backup file into the window and press Enter, or just press Enter to start fresh.
4. Makes Orbit start by itself whenever you log in:
   - **macOS:** a LaunchAgent.
   - **Windows:** a Task Scheduler task, or a Startup-folder shortcut if Task Scheduler isn't allowed.
   - **Linux:** a systemd user service, or a desktop autostart entry where systemd isn't available.
5. Starts Orbit and opens **http://localhost:4321** in your browser.

When it's done you'll see `Orbit is running at http://localhost:4321`.

## 6. Your first five minutes

1. **Tell Orbit your name.** Settings (bottom left) → **General** → **Your name**. Your team calls you by it. You can also add a profile picture here.
2. **Hire your first employee.** Settings → **Team** → **Hire someone**. Give them:
   - a **name**;
   - a **title**;
   - a **job description** (what they do, and what good work looks like);
   - a **personality**.

   A good first hire is a general assistant who runs the team for you.
3. **Make them your main assistant.** Settings → **General** → **Main assistant**. New chats start with them, and they can hand work to the rest of the team.
4. **Start a chat** on the home page. Ask for something real, like a plan, some research or a small website.
5. **Optional: use Orbit as an app.** In Chrome or Edge, click the install icon at the right of the address bar. In Safari on a Mac, use **File → Add to Dock**. Orbit then gets its own window and Dock or taskbar icon.

### Good to know

- **Permissions:** in Settings → Team → *someone* → **File access**, choose Read only, Can edit (their own folder) or Full access. Anything beyond that pops up and asks you first.
- **Inbox:** collects everything waiting on you: approvals, finished work to check, and questions.
- **Projects:** give a group of chats and tasks a folder and a shared memory.
- **Skills:** Settings → **Skills**. Give people the skills they need, or write your own.
- **Models:** Settings → General sets the default model and effort. Every chat can change them, and every reply shows the exact model that wrote it.

## 7. Updating Orbit

Download the new version (or run `git pull` in your copy) and run the installer again, exactly as in [step 5](#5-run-the-installer). When it says it found your data, choose **1) Use it**. It replaces the app and restarts it; your team, chats and files are untouched.

## 8. Removing Orbit

- **macOS and Linux:** `bash install/uninstall.sh`
- **Windows:** double-click `install\uninstall-windows.cmd`

This stops Orbit, stops it starting at login, and deletes the app. Then it shows where your data is and asks what to do with it:

1. **Keep it there** (recommended). Installing Orbit again finds it.
2. **Save a backup file, then remove it.** The file (`Orbit backup <date>.tar.gz`) goes in your home folder (your user folder on Windows). Keep it anywhere, such as cloud storage or a USB stick.
3. **Delete it.**

You can also choose without being asked:
- **macOS and Linux:** `bash install/uninstall.sh --backup` or `--delete-data`
- **Windows:** `powershell -ExecutionPolicy Bypass -File install\uninstall.ps1 -Backup` or `-DeleteData`

### Backups, reinstalling and moving to another computer

Your data folder holds everything about you and your team:
- each person's job, personality, rules, notes, skills and picture;
- your profile, preferences and appearance;
- chats, tasks, projects and project memory;
- uploads and your own skills.

The app folder holds only the program, so you can delete, update or reinstall the app freely.

- **Make a backup any time:** Settings → General → **Your data** → **Download a backup**. Your browser saves it as one `.tar.gz` file, usually in Downloads. It's safe to do while your team is working.
- **Bring a backup back:** run the installer. When it asks whether you have a backup, drag the file into the window and press Enter.
- **Move to another computer:** make a backup, then install Orbit on the new computer and give it the backup. Each person's work folder moves with the data. Project folders you picked yourself (for example `~/Projects/my-site`) are your own files, not part of the backup; copy those over yourself.
- **Start over without losing anything:** run the installer and choose **Start completely fresh**. Your old data is moved aside, not deleted.

## 9. Where everything is

| | macOS | Windows | Linux |
|---|---|---|---|
| The app | `~/Applications/Orbit` | `%LOCALAPPDATA%\Orbit` | `~/.local/share/orbit` |
| Your data | `~/.orbit` | `%USERPROFILE%\.orbit` | `~/.orbit` |
| The log | `~/.orbit/server.log` | `%USERPROFILE%\.orbit\server.log` | `~/.orbit/server.log` |
| Starts at login via | `~/Library/LaunchAgents/local.orbit.plist` | Task Scheduler → **Orbit** (or Startup folder → Orbit) | `~/.config/systemd/user/orbit.service` (or `~/.config/autostart/orbit.desktop`) |
| Restart it | `launchctl kickstart -k gui/$(id -u)/local.orbit` | `Start-ScheduledTask -TaskName Orbit` | `systemctl --user restart orbit` |

Your data folder holds:
- the database (your team, chats and tasks);
- each person's notes and work folder;
- project memories, uploads and profile pictures.

Back it up from Settings → General → **Download a backup**, or copy the folder yourself while Orbit is stopped.

## 10. Settings for the installer

Set these before running the installer if you need to (they're optional):

| Setting | What it does | Default |
|---|---|---|
| `ORBIT_PORT` | The port Orbit listens on | `4321` |
| `ORBIT_DATA` | Where your data is kept | `~/.orbit` |
| `ORBIT_APP_DIR` | Where the app is copied | see the table above |
| `ORBIT_NO_OPEN=1` | Don't open the browser at the end | off |
| `ORBIT_RESTORE` | A backup file to restore, without being asked | none |

For example, on macOS or Linux: `ORBIT_PORT=5000 bash install/install.sh`. In Windows PowerShell: `$env:ORBIT_PORT = 5000` and then run the installer.

If Claude Code isn't found by the background service, set `CLAUDE_BIN` to the full path of the `claude` program.

## 11. Troubleshooting

**The page says "Orbit isn't running".**
It shows the restart command for your computer, with a Copy button. If that doesn't help, look at the log (see [where everything is](#9-where-everything-is)) for the reason.

**"Node.js isn't installed", or the version is too old.**
Install or update it ([step 2](#2-install-nodejs)), open a *new* terminal, and run the installer again. If you update Node.js later (for example with `nvm`), run the installer again so Orbit uses the new one.

**"Claude Code isn't installed".**
Do [step 3](#3-install-claude-code-and-log-in), open a new terminal, and run the installer again. On Windows, Orbit needs the native `claude.exe` from the PowerShell installer, not a copy installed with npm.

**Every reply fails, or says to log in.**
Open a terminal, run `claude`, and log in again. Then send your message again in Orbit.

**"Address already in use" in the log.**
Another program uses port 4321. Install again with a different port, for example `ORBIT_PORT=4400`.

**macOS: Desktop, Documents and Downloads show "Ask macOS".**
macOS guards these folders. Click **Ask macOS** in Orbit's folder picker and choose **Allow** when macOS asks. If you said no before, switch it on in System Settings → Privacy & Security → Files and Folders → node. Or keep your projects in another folder, such as `~/Projects`.

**Windows: the installer window closes straight away, or says scripts are disabled.**
Run it from PowerShell instead: `powershell -ExecutionPolicy Bypass -File install\install.ps1`.

**Linux: Orbit doesn't start after I log in.**
Without systemd, Orbit starts with your desktop session through `~/.config/autostart/orbit.desktop`. Some minimal desktops and WSL don't run autostart entries. In that case, start it with `node ~/.local/share/orbit/server.js` (keep that terminal open).

**I want to run it by hand, without installing.**
In the Orbit folder, run `node server.js` and open http://localhost:4321. Stop it with Ctrl+C.
