<p align="center"><img src="brand/icons/orbit-512.png" width="96" alt="Orbit logo"></p>

<h1 align="center">Orbit</h1>

<p align="center">Your personal team of Claude employees, running on your own computer.</p>

Orbit lets you hire a small team of AI employees, each with a name, a job, a personality and their own rules, and work with them the way you would with real people. Chat with anyone, hand out tasks, and let your main assistant split big jobs across the team. Everything runs on your machine, on your own Claude Code login.

It works on **macOS, Windows and Linux**.

## What you can do

- **Hire a team.** Give each person a title, a job description, a personality, a boss and their own profile picture.
- **Chat or hand out tasks.** Talk to anyone directly, or put work on the board. They can create tasks for each other and report back when they're done.
- **Stay in control.** You choose what each person may touch on your computer. Anything risky asks you first, in a popup.
- **Answer quickly.** When someone needs a decision, the chat box turns into a short multiple-choice form.
- **Give them skills.** Make your own, import a SKILL.md, or hand out the skills you already have in Claude Code, person by person.
- **Work in projects.** Each project has a folder and a shared memory the team keeps up to date.
- **Attach files.** Upload files, or point at files in the project with `@`.
- **Make it yours.** Themes, accent colours, backgrounds and any Google Font. Install it as an app with its own window.

## What you need

- **Node.js 24 or newer**: [nodejs.org](https://nodejs.org)
- **Claude Code**, installed and logged in: [claude.com/claude-code](https://claude.com/claude-code). Your team runs on your Claude plan.
- **Windows only:** Git for Windows ([git-scm.com](https://git-scm.com/download/win)), which Claude Code uses to run commands.

## Install

Download Orbit (Code → Download ZIP, or `git clone https://github.com/MohanViswagnaMR/Orbit.git`), then:

| System | Do this |
|---|---|
| **macOS** | Double-click `install/Install Orbit (Mac).command`, or run `bash install/install.sh` |
| **Windows** | Double-click `install\install-windows.cmd` |
| **Linux** | Run `bash install/install.sh` |

The installer:
- checks what you need and copies Orbit to its own folder;
- finds your data if you've used Orbit before, and asks whether to keep it or start fresh. You can also drag in a backup file to restore;
- makes Orbit start by itself when you log in, then opens it at **http://localhost:4321**.

**New to this?** The [setup guide](docs/SETUP.md) walks through every step, including installing Node.js and Claude Code.

## First steps

1. **Settings → General:** tell your team what to call you.
2. **Settings → Team → Hire someone:** create your first employee, then pick them as your **main assistant**.
3. **Start a chat** on the home page.

## Your data, backups and reinstalling

Everything Orbit knows is kept in one data folder, apart from the app:
- your team, and each person's preferences, rules, notes and picture;
- your profile and settings;
- chats, tasks, projects and their memory;
- uploads and skills.

Updating or removing the app never touches it.

- **Back up any time:** Settings → General → **Download a backup** saves it all as one file.
- **Update:** download the new version and run the installer again. When it finds your data, choose **Use it**.
- **Remove:** run `bash install/uninstall.sh` (macOS, Linux) or double-click `install\uninstall-windows.cmd` (Windows). It asks what to do with your data:
  - keep it where it is;
  - save a backup file, then remove it;
  - delete it.
- **Reinstall, or move to another computer:** run the installer. If your data is still there, it asks **use it, or start completely fresh**; starting fresh moves the old data aside and never deletes it. If you have a backup file, drag it into the installer window when it asks.

## Where your things are

Orbit keeps the app and your data in separate folders, so updating never touches your data.

| | macOS | Windows | Linux |
|---|---|---|---|
| The app | `~/Applications/Orbit` | `%LOCALAPPDATA%\Orbit` | `~/.local/share/orbit` |
| Your data (team, chats, files) | `~/.orbit` | `%USERPROFILE%\.orbit` | `~/.orbit` |
| The log | `~/.orbit/server.log` | `%USERPROFILE%\.orbit\server.log` | `~/.orbit/server.log` |
| Backups from the uninstaller | your home folder | your user folder | your home folder |

## Privacy and safety

- **Only on your computer.** Orbit listens on `127.0.0.1`, so other computers on your network can't reach it.
- **Your Claude Code login.** Your employees use your account. Orbit never uses or stores an API key.
- **You set the limits.** Each person can read only, edit files in their own folder, or have full access. Anything outside that asks you first.

## For developers

No dependencies, no build step: just Node.js built-ins.

```sh
node server.js      # start on http://localhost:4321 (PORT and ORBIT_DATA change the port and data folder)
node --test         # run the tests
```

`server.js` is the whole backend (HTTP API, SQLite through `node:sqlite`, and the MCP tools employees use). `index.html` is the whole interface.
