# Setting up Orbit

This guide takes you from nothing to a working Orbit, step by step. It takes about 10 minutes. You only need to type a few commands, and each one is given in full.

**Contents**

1. [What you need](#1-what-you-need)
2. [Install Node.js](#2-install-nodejs)
3. [Install an AI and sign in](#3-install-an-ai-and-sign-in)
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
| One AI, signed in: **Claude Code** (a Claude plan), the **Codex CLI** (a ChatGPT account) or the **Antigravity CLI** (a Google account) | Your team works through it, on your account. Their work counts towards your plan. You can add the others later. |
| Node.js 24 or newer | Orbit is a small Node.js program. |
| **Windows, with Claude Code:** Git for Windows | Claude Code uses it to run commands. |
| A web browser | Orbit opens at `http://localhost:4321`. |

Already have Node.js 24+ and one of those AIs signed in? Skip to [step 4](#4-download-orbit).

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

## 3. Install an AI and sign in

Your team can run on **Claude**, **ChatGPT** or **Gemini**. You need one; the installer finds whichever you have, and asks which should run your team if you have more than one. Claude is the most complete: only Claude teammates can ask you for approval in the middle of a task (on the others, anything their file access doesn't allow is simply blocked).

### Claude (Claude Code)

- **macOS and Linux:** in a terminal, run:
  ```sh
  curl -fsSL https://claude.ai/install.sh | bash
  ```
- **Windows:** first install [Git for Windows](https://git-scm.com/download/win) (the default options are fine). Then, in PowerShell, run:
  ```powershell
  irm https://claude.ai/install.ps1 | iex
  ```

Then log in. Run `claude`, follow the steps in your browser, and type `/exit` once it says you're logged in. Orbit uses this login. It never asks for a password or an API key.

### ChatGPT (Codex CLI)

- **macOS:** `brew install --cask codex`. **Windows, Linux:** `npm install -g @openai/codex`. Or see [developers.openai.com/codex/cli](https://developers.openai.com/codex/cli).
- Then run `codex login` and sign in with your ChatGPT account.

### Gemini (Antigravity CLI)

- Install Google Antigravity from [antigravity.google](https://antigravity.google) and its command-line tool (`agy`).
- Then run `agy` once and sign in with your Google account.

You can change which AI runs your team, or switch on the others too, any time in Settings → **Connectors**.

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

1. Checks for Node.js 24+ and for Claude Code, the Codex CLI and the Antigravity CLI (one is enough), and tells you what to install if something is missing. For a new team, if it finds more than one, it asks which AI should run it.
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

1. **Hire your first teammate.** A new Orbit opens with a welcome card:
   - **Hire with help:** Orbit's hiring assistant asks you a few rounds of questions, proposes people, and hires the ones you pick, with their pictures drawn for them.
   - **Set one up yourself:** give them a **name**, a **title**, a **job description** (what they do, and what good work looks like) and a **personality**.

   Your first hire becomes your **main assistant**: new chats start with them, and they hand work to the rest of the team. You can change who it is in Settings → **General** → **Main assistant**.
2. **Tell Orbit your name.** Settings (bottom left) → **General** → **Your name**. Your team calls you by it. You can also add a profile picture here.
3. **Start a chat** on the home page. Ask for something real, like a plan, some research or a small website.
5. **Optional: use Orbit as an app.** In Chrome or Edge, click the install icon at the right of the address bar. In Safari on a Mac, use **File → Add to Dock**. Orbit then gets its own window and Dock or taskbar icon.

### Good to know

- **Permissions:** in Settings → Team → *someone* → **File access**, choose Read only, Can edit (their own folder) or Full access. Anything beyond that pops up and asks you first.
- **Inbox:** collects everything waiting on you: approvals, finished work to check, and questions.
- **Live:** every chat and task that's running right now. While someone is working, **Interrupt** (⌘↩) stops them and sends your new message straight away.
- **Projects:** give a group of chats and tasks a folder and a shared memory. Archiving a project archives its chats and tasks too.
- **Skills:** Settings → **Skills**. Write your own, import a SKILL.md, or add skills from a GitHub link (Orbit suggests who needs them, and you approve). **Assign automatically** reads everyone's job and gives them the skills that fit. Orbit's **core skills** are for everyone: they're how the team hands out work, picks models, checks results and reports back.
- **Sharing:** Settings → Team → **Export the team**, or **Export** on a teammate's page, saves them with their skills as one file a friend can import. Importing never overwrites anyone.
- **Backups:** Settings → General → **Download a backup**. Tick what goes in.
- **Models:** everyone starts on **Auto**: for each new chat or task, Orbit picks the lightest model that will do it well, and says which in the chat. Pick a model for someone in Settings → Team, or for one chat in its message box. Every reply shows the exact model that wrote it. Settings → General sets the backup model and the default effort.
- **Your main AI and the others:** Settings → **Connectors**. Your **main AI** runs Orbit's own jobs (Auto's picks, pictures, the hiring assistant, skill matching) and is always on; **Make main** changes it. Switch the others on or off to use their models too. Each runs through its own program on your computer, signed in with your own account:
  - **ChatGPT:** install the Codex CLI (`brew install --cask codex` on a Mac, or see [developers.openai.com/codex/cli](https://developers.openai.com/codex/cli)), then run `codex login`.
  - **Gemini:** install Google Antigravity and its command-line tool (`agy`), then run `agy` once and sign in with Google.
  - **Grok:** needs the Codex CLI too, plus an API key from [console.x.ai](https://console.x.ai), pasted into the Grok card.

  Then switch it on. ChatGPT and Gemini teammates can't ask you for approval mid-task: whatever their file access doesn't allow is simply blocked, and they say so.

### Use Orbit from your phone

Settings → **Phone** walks you through each of these as a checklist: finished steps tick off by themselves. The steps are the same as here.

Whichever you use, **keep your computer on and awake**: your team runs there. On a Mac: System Settings → Battery (or Energy) → turn on **Prevent automatic sleeping when the display is off** (while it's plugged in).

#### The web link: the whole of Orbit, anywhere

On a phone, Orbit opens its **mobile version**: tabs at the bottom (Chats, Inbox, Live, Team, More), a big **+** for a new chat, one-tap **Allow** / **Don't allow** for requests, questions you answer by tapping, and photos or files from your phone as attachments. Settings, projects and skills are in the desktop version: **More → Desktop version** (and **Mobile version** at the top to come back).

1. **Install cloudflared**, the free tool that makes the link. On a Mac, open Terminal and run `brew install cloudflared` (no Homebrew? get it from [brew.sh](https://brew.sh) first). Other systems: [Cloudflare's downloads](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
2. **Choose a password**, at least 8 characters. You type it once on each phone.
3. **Switch the web link on.** After a few seconds an address appears, like `https://some-words.trycloudflare.com`.
4. **Open it on your phone, sign in, and add it to your home screen.** Send the link to yourself, open it on your phone and sign in. Then add it to your home screen so it opens like an app:
   - **iPhone:** in Safari tap **Share**, then **Add to Home Screen**.
   - **Android:** in Chrome tap **⋮**, then **Add to Home screen**.

Good to know:
- Your phone stays signed in for 30 days. Five wrong passwords lock that place out for 15 minutes. **Sign out everyone** signs every phone out at once, and so does changing the password.
- The password, the link and the chat apps can only be changed on the computer itself, not through the link.
- The list of signed-in devices shows each one's device, place and address, when it signed in and when it was last active, and lets you sign out any of them. For the city as well as the country, turn on Cloudflare's **Add visitor location headers** (your domain → **Rules → Settings**).
- **Other people with accounts on your computer?** Turn on **Password on this Mac too**: then nobody can use Orbit on the computer without your password either. You sign in once on the computer, for 30 days.
- The free address changes whenever Orbit restarts. If Telegram is set up, it sends you the new one (or send it `/link`). For one that never changes, use your own domain (below).

**Your own domain instead** (a domain you have on Cloudflare): an address like `orbit.yourdomain.com` that never changes, so your home-screen app and WhatsApp keep working after restarts. In Settings → Phone, pick **My own domain**:

1. **Install cloudflared** (as above).
2. **Make a tunnel in your Cloudflare account.** Open [dash.cloudflare.com](https://dash.cloudflare.com) and pick your account. Open **Zero Trust** in the menu on the left (the first time, it asks for a team name and the **Free** plan). Go to **Networks → Tunnels**, click **Create a tunnel**, choose **Cloudflared**, name it **orbit**, and click **Save tunnel**. The next page shows install commands: copy any one of them. It ends with a long token starting with `eyJ`. **Don't run it**: Orbit runs the tunnel itself. Click **Next**.
3. **Point an address on your domain at Orbit.** On **Route traffic** (also called **Public hostname**): Subdomain `orbit`, Domain your domain, Path empty, Service type **HTTP**, URL `localhost:4321`. Click **Save**. Cloudflare adds the address to your domain by itself.
4. **Paste your address and the tunnel token** into Orbit and click **Save**. Pasting a whole command is fine; Orbit picks out the token.
5. **Choose a password**, then **switch the web link on**. It says **Connected** once Cloudflare lets the tunnel in.
6. **Open your address on your phone**, sign in, and add it to your home screen.

Optional extra lock: in Zero Trust, **Access → Applications → Add an application → Self-hosted**, with your address and a policy that allows only your email. Cloudflare then asks for a code sent to your email before anyone sees Orbit's sign-in. If you use WhatsApp, add a second application for the path `hooks/whatsapp` with a **Bypass** policy, or Meta can't reach Orbit.

Already running a tunnel yourself (cloudflared as a service, or ngrok) to `http://localhost:4321`? Enter just your address and leave the token empty: Orbit then doesn't start one.

#### Telegram

Chat with your team from Telegram: replies, requests for your OK, questions and finished work come to you, with buttons. It works without the web link: Orbit only talks out to Telegram.

1. **Make your own bot with @BotFather.** Open Telegram on your phone or computer and open [@BotFather](https://t.me/BotFather) (Telegram's own bot for making bots, with a blue tick).
   - Send `/newbot`.
   - Give it a name, like **My Orbit**.
   - Give it a username that ends in **bot**, like **myname_orbit_bot**.
   - BotFather replies with a token like `123456789:AAH…`. Keep it private: whoever has it controls your bot.
2. **Paste the token** into the Telegram card and click **Save**.
3. **Pair your Telegram.** Click **Pair my Telegram**, then click the `t.me/…` link it shows (it opens Telegram) and tap **Start**. Or send your bot `/start` and the code. The code works once, for 15 minutes. Only the chat you pair can use your bot.
4. **Say hello.** Write anything to your bot: it goes to your main assistant, in the same chat until you start a new one.
   - `@Name message` talks to someone else.
   - `/new` starts a new chat; `/chats` lists your recent chats and `/open 2` switches to one.
   - `/team`, `/status`, `/stop`, `/link`, and `/help` for all of them.

Text only for now: send files through the web link.

#### WhatsApp

The same from WhatsApp, through Meta's official WhatsApp Cloud API. It takes about 15 minutes on Meta's website and it's free; Orbit gets its own WhatsApp number (Meta's test number). The **web link must be on**, because WhatsApp delivers your messages to it.

1. **Make a Meta developer app with WhatsApp.**
   - Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) and log in with Facebook. The first time, it asks you to register as a developer (free).
   - Click **Create app**. Pick **Other**, then the app type **Business**, give it a name like **My Orbit**, and create it.
   - On the app's page, find **WhatsApp** and click **Set up**. If it asks for a business portfolio, create one with your name.
2. **Get the test number, and add your own number.**
   - Open **WhatsApp → API Setup** in the menu on the left.
   - Under **From** is your free test number. Copy its **Phone number ID** (the long number below it).
   - Under **To**, click **Manage phone number list**, add your own WhatsApp number, and enter the code WhatsApp sends you.
3. **Get an access token.**
   - To try it today: on API Setup, click **Generate access token** and copy it. It works for 24 hours.
   - To keep it working: open [business.facebook.com/settings](https://business.facebook.com/settings) → **Users → System users** → **Add** (role Admin). Then **Add assets → Apps** → your app → **Full control**. Then **Generate new token** for your app, tick `whatsapp_business_messaging` and `whatsapp_business_management`, and copy it.
4. **Get the App ID and the App secret.** In your app, open **App settings → Basic**. Copy the **App ID**, then click **Show** next to **App secret** (it asks for your Facebook password) and copy that too.
5. **Paste them** into the WhatsApp card (Phone number ID, App ID, Access token, App secret) and click **Save**.
6. **Switch the web link on** (above), if it isn't already.
7. **Connect WhatsApp to Orbit.** Orbit tells Meta its link by itself, and again whenever the link changes; the step ticks once Meta has checked it. If it hasn't after a minute: in your Meta app open **WhatsApp → Configuration**, click **Edit** next to the webhook, paste the **callback URL** and **verify token** that Orbit shows, and click **Verify and save**. Then, under **Webhook fields**, click **Subscribe** next to **messages**.
8. **Pair your WhatsApp.** Click **Pair my WhatsApp**, then from your WhatsApp send `orbit` and the code to your Orbit test number. The code works once, for 15 minutes. Only the number you pair gets answers.
9. **Say hello.** Write anything to your Orbit number: it goes to your main assistant. The same commands as Telegram work here.

WhatsApp's rules for business numbers: Orbit can only write to you within 24 hours of your last message to it (send it anything to open the window again), and Meta's test number can only write to the numbers you added in step 2.

## 7. Updating Orbit

Download the new version (or run `git pull` in your copy) and run the installer again, exactly as in [step 5](#5-run-the-installer). When it says it found your data, choose **1) Use it**. It replaces the app and restarts it; your team, chats and files are untouched.

## 8. Removing Orbit

- **macOS and Linux:** `bash install/uninstall.sh`
- **Windows:** double-click `install\uninstall-windows.cmd`

This stops Orbit, stops it starting at login, and deletes the app. Then it shows where your data is and asks what to do with it:

1. **Keep it there** (recommended). Installing Orbit again finds it.
2. **Save a backup file, then remove it.** The file (`Orbit backup <date>.tar.gz`) goes in your home folder (your user folder on Windows). Keep it anywhere, such as cloud storage or a USB stick.
3. **Delete it.**

It also removes the "orbit" tool connection Orbit added to Antigravity, if you used Gemini. A settings file it can't read is left alone.

If you added Orbit as an app in your browser ([step 6](#6-your-first-five-minutes)), the uninstaller removes that too:
- **macOS:** it deletes the Chrome, Edge or Brave app and its Dock icon. Chrome may still list it on `chrome://apps`: right-click it there, choose **Remove from Chrome** and tick **Also clear data**. A Safari app isn't found automatically: delete `Orbit.app` from the Applications folder in your home folder.
- **Windows:** your browser asks to remove the Orbit app. Tick **Also clear data** and click **Remove**.
- **Linux:** remove it in the browser. Open the Orbit app, click **⋮** (top right), choose **Uninstall Orbit** and tick **Also clear data**.

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

- **Make a backup any time:** Settings → General → **Your data** → **Download a backup**. Tick what goes in: your team, chats, tasks, projects and settings always do; notes and project memory, pictures, skills, attached files and your team's work folders are up to you. Your browser saves it as one `.tar.gz` file, usually in Downloads. It's safe to do while your team is working.
- **Share a teammate or your whole team:** on someone's page click **Export**, or in Settings → Team click **Export the team**. You get one file with their jobs, personalities, rules, pictures and skills (the team file also keeps who reports to whom; notes only if you tick them; chats and work never). Your friend adds it in Settings → Team → **Import**. Only import from people you trust: skills can include scripts.
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

**"Orbit needs one AI to run your team, and none was found".**
Do [step 3](#3-install-an-ai-and-sign-in), open a new terminal, and run the installer again. On Windows, Claude needs the native `claude.exe` from the PowerShell installer, not a copy installed with npm.

**Every reply fails, or says to log in.**
Open a terminal and sign in again: `claude` (Claude), `codex login` (ChatGPT) or `agy` (Gemini). Then send your message again in Orbit. Settings → Connectors shows which AIs are ready.

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
