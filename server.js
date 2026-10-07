// Orbit: your personal team of Claude employees. Runs on macOS, Windows and Linux. Start it with: node server.js
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawn, execFile } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { makeBackup } from './backup.mjs';

const DIR = import.meta.dirname; // the code
// Your data lives apart from the code: the database, log, notes, project memories and employees' work folders.
// ORBIT_DATA picks the folder; otherwise ~/.orbit (or ~/Studio/crew-data, where Orbit's first install keeps it).
const DATA = (() => {
  const set = process.env.ORBIT_DATA || process.env.CREW_DATA, older = path.join(os.homedir(), 'Studio', 'crew-data');
  if (set) return path.resolve(set.replace(/^~(?=$|[\\/])/, os.homedir()));
  return fs.existsSync(older) ? older : path.join(os.homedir(), '.orbit');
})();
const MAC = process.platform === 'darwin', WIN = process.platform === 'win32';
const CLAUDE = process.env.CLAUDE_BIN || 'claude'; // the Claude Code command; CLAUDE_BIN can point at it if it isn't on PATH
// Is a file inside a folder? (Works with any path style: /Users/a/b or C:\Users\a\b.)
const within = (file, dir) => { const rel = path.relative(path.resolve(dir), path.resolve(file)); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
const PORT = Number(process.env.PORT) || 4321;
const HOSTS = [`localhost:${PORT}`, `127.0.0.1:${PORT}`];

// Anything an access level doesn't cover pauses and asks you in a popup (see "asking the owner" below).
const READ_TOOLS = ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'mcp__crew'];
const ACCESS = {
  read: ['--permission-mode', 'default'], // reading is free; harmless commands like ls too; the rest asks you
  edit: ['--permission-mode', 'acceptEdits'], // edits inside its folder are free; the rest asks you
  full: ['--permission-mode', 'bypassPermissions'], // anything, never asks
};
const ACCESS_TEXT = {
  read: 'You can read files and search the web freely. Changing files or running commands needs the owner\'s OK: try it and they get a popup to approve.',
  edit: 'You can read, and edit files inside your working folder, freely. Files elsewhere and running commands need the owner\'s OK: try it and they get a popup to approve.',
  full: 'You can read and edit files and run commands.',
};
// Claude Code's own task list and scheduling tools would bypass Orbit, and some reach your cloud account.
const BLOCKED_TOOLS = ['TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate', 'TaskStop', 'CronCreate', 'CronDelete', 'CronList',
  'ScheduleWakeup', 'RemoteTrigger', 'PushNotification', 'SendMessage', 'ListAgents', 'Workflow'];
const MODELS = ['sonnet', 'opus', 'haiku', 'fable'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']; // how hard Claude thinks; more effort = slower and uses more of your plan
// What each employee may do besides files (files are ACCESS above). You set these in Settings; "on" is the default.
const PERMS = {
  web: { label: 'Search and read the web', on: true },
  tasks: { label: 'Create and assign tasks', on: true },
  project_memory: { label: 'Write to project memory', on: true },
  global_rules: { label: 'Change the global rules', on: false },
  boss_rules: { label: 'Change the rules for talking to you', on: false },
  team_rules: { label: 'Change individual rules for themselves and everyone under them', on: false },
  hire: { label: "Hire people, and change the title, job and boss of people under them", on: false },
  chrome: { label: 'Use your Chrome browser (Claude in Chrome); each action asks you first unless you say otherwise', on: false },
};
// Limits on work employees create for each other, so a loop can't run through your Claude plan.
const LIMITS = { depth: 3, perTurn: 5, open: 20, hiresPerTurn: 6, team: 25 };
const ACCESS_ORDER = ['read', 'edit', 'full'];

// ---------- database ----------
fs.mkdirSync(DATA, { recursive: true });
const db = new DatabaseSync(path.join(DATA, 'crew.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, role TEXT NOT NULL,
  model TEXT NOT NULL, access TEXT NOT NULL, folder TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, description TEXT NOT NULL DEFAULT '', folder TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
  employee_id INTEGER NOT NULL, parent_id INTEGER, asked_by TEXT, folder TEXT,
  status TEXT NOT NULL DEFAULT 'queued', next_prompt TEXT, session_id TEXT,
  result TEXT, log TEXT NOT NULL DEFAULT '', cost REAL NOT NULL DEFAULT 0, reported INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL, kind TEXT NOT NULL, author TEXT NOT NULL,
  text TEXT NOT NULL, activity TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS messages_task ON messages (task_id);
CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, message TEXT NOT NULL, employee_id INTEGER NOT NULL, folder TEXT,
  every TEXT NOT NULL, day INTEGER, at TEXT NOT NULL, paused INTEGER NOT NULL DEFAULT 0,
  next_run TEXT NOT NULL, last_task_id INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
`);
// Columns added after the first version; each ALTER fails harmlessly once it has run.
for (const sql of [
  'ALTER TABLE tasks ADD COLUMN schedule_id INTEGER',
  "ALTER TABLE tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'task'", // task | chat
  'ALTER TABLE tasks ADD COLUMN project_id INTEGER',
  'ALTER TABLE tasks ADD COLUMN created_by TEXT', // 'me', 'schedule' or the employee's name
  'ALTER TABLE schedules ADD COLUMN project_id INTEGER',
  "ALTER TABLE employees ADD COLUMN title TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE employees ADD COLUMN personality TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE employees ADD COLUMN rules TEXT NOT NULL DEFAULT ''", // their individual rules
  'ALTER TABLE employees ADD COLUMN reports_to INTEGER', // their boss; NULL = you
  "ALTER TABLE employees ADD COLUMN perms TEXT NOT NULL DEFAULT '{}'", // JSON, see PERMS
  'ALTER TABLE tasks ADD COLUMN model TEXT', // a model chosen for this chat or task; NULL = the person's
  "ALTER TABLE employees ADD COLUMN effort TEXT NOT NULL DEFAULT 'default'", // 'default' = the default effort in Settings
  "ALTER TABLE employees ADD COLUMN allow TEXT NOT NULL DEFAULT '{}'", // JSON {rules, dirs}: what you said "don't ask me again" for
  'ALTER TABLE employees ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0', // 1 = hidden from your sidebar; they keep working
  "ALTER TABLE employees ADD COLUMN avatar TEXT NOT NULL DEFAULT ''", // when their profile picture was set ('' = none); the file is avatars/<id>.svg
  'ALTER TABLE tasks ADD COLUMN effort TEXT', // an effort chosen for this chat or task; NULL = the person's
  'ALTER TABLE messages ADD COLUMN model TEXT', // the exact model that wrote a reply, as Claude Code reports it (e.g. claude-opus-5-5)
  'ALTER TABLE messages ADD COLUMN effort TEXT', // the effort Orbit asked for; 'standard' = Claude chose
  'ALTER TABLE messages ADD COLUMN files TEXT', // JSON list of files a reply created or changed (its deliverables)
  'ALTER TABLE tasks ADD COLUMN archived_at TEXT', // archived chats: out of your lists, kept in the Archive
  'ALTER TABLE projects ADD COLUMN archived_at TEXT',
  'ALTER TABLE employees ADD COLUMN archived_at TEXT',
  "ALTER TABLE employees ADD COLUMN skills TEXT NOT NULL DEFAULT '[]'", // JSON ids of the skills you gave them
  'ALTER TABLE messages ADD COLUMN attachments TEXT', // JSON files you attached to a message: [{ path, name, size, how: 'upload' | 'file' }]
  'ALTER TABLE messages ADD COLUMN questions TEXT', // JSON questions a reply asks the owner (ask_owner), shown as a form
]) try { db.exec(sql); } catch {}
db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
// employees.role holds the job description. employees.model may be 'default' (= the default model in Settings).
// tasks.employee_id 0 = unassigned (the column was NOT NULL before unassigned tasks existed).
// Task status: todo (unassigned) | queued | working | waiting (on subtasks) | review (needs you) | done | stopped | failed.
// Chat status: queued | working | idle | stopped | failed.
// Schedules: every daily | weekdays | weekly (day 0-6, Sunday = 0) | monthly (day 1-28); at "HH:MM" on the Mac's clock.
// Message kinds: me | asker | reply | teammate (a subtask's result) | note | memory.

const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const exec = (sql, ...a) => db.prepare(sql).run(...a);
const setTask = (id, fields) => {
  const keys = Object.keys(fields);
  exec(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ...keys.map((k) => fields[k]), id);
};
const say = (taskId, kind, author, text, activity = '', { model = null, effort = null, files = null, questions = null, attachments = null } = {}) =>
  exec('INSERT INTO messages (task_id, kind, author, text, activity, model, effort, files, questions, attachments) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    taskId, kind, author, text, activity, model, effort, files?.length ? JSON.stringify(files) : null, questions?.length ? JSON.stringify(questions) : null,
    attachments?.length ? JSON.stringify(attachments) : null);
const appendLog = (id, text) => exec('UPDATE tasks SET log = log || ? WHERE id = ?', text, id);
const task = (id) => one('SELECT * FROM tasks WHERE id = ?', id);
const employee = (id) => one('SELECT * FROM employees WHERE id = ?', id);
const project = (id) => one('SELECT * FROM projects WHERE id = ?', id);
const schedule = (id) => one('SELECT * FROM schedules WHERE id = ?', id);
const nameOf = (id) => employee(id)?.name ?? 'A former teammate';
const expand = (p) => path.resolve(p.replace(/^~(?=$|[\\/])/, os.homedir()));
// macOS guards these: opening one makes macOS ask first, and Orbit (a background app) would wait on that question forever.
// So Orbit never touches them by itself. Desktop, Documents and Downloads unlock once you click "Ask macOS" and allow it.
const PROTECTED = MAC ? ['Desktop', 'Documents', 'Downloads', 'Library'].map((d) => path.join(os.homedir(), d)).concat('/Volumes') : []; // only macOS does this
const ASKABLE = MAC ? ['Desktop', 'Documents', 'Downloads'] : [];
const macAllowed = () => { try { return [].concat(JSON.parse(setting('mac_folders') || '[]')); } catch { return []; } };
// macOS guards other places too (like the Photos library); reading one waits on a prompt, so give up after 3 seconds instead of hanging.
const timed = (promise, full) => Promise.race([promise, new Promise((_, no) => setTimeout(() => no(new Error(
  `macOS is holding back ${full.replace(os.homedir(), '~')} (it may be asking for permission). Pick a folder elsewhere, like ~/Studio.`)), 3000))]);
const isProtected = (full) => PROTECTED.find((p) => within(full, p) && !(path.dirname(p) === os.homedir() && macAllowed().includes(path.basename(p))));
// A project's folder must already exist; Orbit never creates it for you. Returns the full path.
export async function checkFolder(folder) {
  folder = String(folder ?? '').trim();
  if (!folder) throw new Error('Pick the project\'s folder. It must already exist on your Mac.');
  if (!/^~/.test(folder) && !path.isAbsolute(folder)) throw new Error('Use a full path, like ~/Projects/my-project.');
  const full = expand(folder);
  const blocked = isProtected(full);
  if (blocked) throw new Error(ASKABLE.includes(path.basename(blocked)) && path.dirname(blocked) === os.homedir()
    ? `macOS hasn't let Orbit into ${blocked.replace(os.homedir(), '~')} yet. Click Browse…, then Ask macOS on ${path.basename(blocked)}.`
    : `macOS doesn't let background apps like Orbit use ${blocked.replace(os.homedir(), '~')}. Pick a folder elsewhere, like ~/Studio/my-project.`);
  let st;
  try { st = await timed(fs.promises.stat(full), full); } catch (err) {
    if (!err.code) throw err;
    throw new Error(err.code === 'ENOENT' ? `That folder doesn't exist: ${full}. Create it first, or pick one that exists.` : `Orbit can't open ${full} (${err.code}).`);
  }
  if (!st.isDirectory()) throw new Error(`That's a file, not a folder: ${full}`);
  return full;
}
// The folder picker: the folders inside one folder. Locked ones are shown but can't be opened.
export async function listFolder(p) {
  const studio = path.join(os.homedir(), 'Studio');
  const full = String(p ?? '').trim() ? expand(String(p).trim()) : fs.existsSync(studio) ? studio : os.homedir();
  if (!path.isAbsolute(full)) throw new Error('Use a full path, like ~/Studio.');
  if (isProtected(full)) throw new Error(`macOS hasn't let Orbit open ${full.replace(os.homedir(), '~')}.`);
  let entries;
  try { entries = await timed(fs.promises.readdir(full, { withFileTypes: true }), full); } catch (err) {
    if (!err.code) throw err;
    throw new Error({ ENOENT: `That folder doesn't exist: ${full}`, ENOTDIR: `That's a file, not a folder: ${full}` }[err.code] ?? `Orbit can't open ${full} (${err.code}).`);
  }
  const folders = entries.filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => { const p = path.join(full, d.name), locked = Boolean(isProtected(p)); return { name: d.name, path: p, locked, askable: locked && full === os.homedir() && ASKABLE.includes(d.name) }; })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  // The path as clickable steps: Computer › Home › Projects (built here, so every system's path style works).
  const crumbs = [];
  for (let p = full; ; p = path.dirname(p)) {
    const root = path.dirname(p) === p;
    crumbs.unshift({ name: p === os.homedir() ? 'Home' : root ? (WIN ? p.replace(/[\\/]$/, '') : 'Computer') : path.basename(p), path: p });
    if (root) break;
    if (p === os.homedir()) { crumbs.unshift({ name: WIN ? path.parse(p).root.replace(/[\\/]$/, '') : 'Computer', path: path.parse(p).root }); break; }
  }
  return { path: full, parent: path.dirname(full) === full ? null : path.dirname(full), home: os.homedir(), crumbs, folders };
}
let askingMac = false;
// Open a file in its own app, or show it in Finder / File Explorer / the file manager.
function openOnComputer(file, reveal) {
  if (MAC) return execFile('open', reveal ? ['-R', file] : [file]);
  if (WIN) return reveal ? execFile('explorer.exe', [`/select,"${file}"`], { windowsVerbatimArguments: true }) : execFile('cmd.exe', ['/c', 'start', '""', `"${file}"`], { windowsVerbatimArguments: true });
  execFile('xdg-open', [reveal ? path.dirname(file) : file]); // Linux file managers can't select a file, so open its folder
}
const depth = (t) => (t.kind === 'chat' ? 0 : t.parent_id ? 1 + depth(task(t.parent_id)) : 1);
const SETTINGS = { default_model: 'sonnet', default_effort: '', global_rules: '', boss_rules: '', owner_name: '', main_assistant: '', appearance: '{}', picture_cost: '0', owner_avatar: '', mac_folders: '[]' }; // mac_folders: Desktop/Documents/Downloads you let Orbit into // owner_avatar: '<ext>:<version>' of avatars/me.<ext> // main_assistant: an employee id // default_effort '' = Claude Code's own default
const setting = (k) => one('SELECT value FROM settings WHERE key = ?', k)?.value ?? SETTINGS[k];
const setSetting = (k, v) => exec('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, v);
const modelFor = (t, e) => t.model || (MODELS.includes(e.model) ? e.model : setting('default_model'));
const effortFor = (t, e) => t.effort || (EFFORTS.includes(e.effort) ? e.effort : setting('default_effort')); // '' = no flag
export const permsOf = (e) => {
  let p = {};
  try { p = JSON.parse(e.perms || '{}'); } catch {}
  return Object.fromEntries(Object.entries(PERMS).map(([k, v]) => [k, typeof p[k] === 'boolean' ? p[k] : v.on]));
};
const bossOf = (e) => (e.reports_to ? employee(e.reports_to) : null);
// True when `e` is `boss` or anywhere under them in the org chart.
// ---------- skills: what you make in Orbit, plus the skills installed in your Claude Code. Each person gets only theirs. ----------
const SKILLS_DIR = path.join(DATA, 'skills'), CLAUDE_HOME = process.env.CREW_CLAUDE_HOME || path.join(os.homedir(), '.claude');
export function readSkillMd(text) { // the frontmatter (name, description) and the instructions under it
  const m = String(text ?? '').replace(/\r/g, '').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta = {};
  for (const line of (m?.[1] ?? '').split('\n')) { const kv = line.match(/^([\w-]+):\s*(.*)$/); if (kv) meta[kv[1]] = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2'); }
  return { name: meta.name || '', description: meta.description || '', body: (m ? m[2] : String(text ?? '')).trim() };
}
const skillsIn = (dir, group, idOf) => { // every <dir>/*/SKILL.md
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() || d.isSymbolicLink()).map((d) => d.name); } catch {}
  return names.flatMap((n) => {
    let text;
    try { text = fs.readFileSync(path.join(dir, n, 'SKILL.md'), 'utf8'); } catch { return []; }
    const md = readSkillMd(text);
    return [{ id: idOf(n), name: n, description: md.description, group, dir: path.join(dir, n) }];
  });
};
const pluginsIn = (dir) => { // folders that are Claude Code plugins: .claude-plugin/plugin.json and a skills/ folder
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch {}
  return names.flatMap((n) => { try { return [{ name: JSON.parse(fs.readFileSync(path.join(dir, n, '.claude-plugin', 'plugin.json'), 'utf8')).name || n, dir: path.join(dir, n) }]; } catch { return []; } });
};
export function findSkills() {
  const out = [...skillsIn(SKILLS_DIR, 'Made in Orbit', (n) => `orbit/${n}`).map((x) => ({ ...x, mine: true })), ...skillsIn(path.join(CLAUDE_HOME, 'skills'), 'Your Claude skills', (n) => `user/${n}`)];
  let synced = [];
  try { synced = fs.readdirSync(path.join(CLAUDE_HOME, 'skills', 'synced')); } catch {}
  for (const acct of synced) out.push(...skillsIn(path.join(CLAUDE_HOME, 'skills', 'synced', acct), 'Your Claude skills', (n) => `user/${n}`));
  const plugins = [];
  try { for (const acct of fs.readdirSync(path.join(CLAUDE_HOME, 'plugins', 'synced'))) plugins.push(...pluginsIn(path.join(CLAUDE_HOME, 'plugins', 'synced', acct))); } catch {}
  try {
    const installed = JSON.parse(fs.readFileSync(path.join(CLAUDE_HOME, 'plugins', 'installed_plugins.json'), 'utf8')).plugins ?? {};
    for (const [key, list] of Object.entries(installed)) for (const x of [].concat(list)) if (x?.installPath) plugins.push({ name: key.split('@')[0], dir: x.installPath });
  } catch {}
  for (const p of plugins) out.push(...skillsIn(path.join(p.dir, 'skills'), `${p.name} plugin`, (n) => `plugin/${p.name}/${n}`));
  return [...new Map(out.filter((x) => x.name !== 'synced').map((x) => [x.id, x])).values()];
}
export const skillsOf = (e) => { try { return [].concat(JSON.parse(e.skills || '[]')).map(String); } catch { return []; } };
// The skills a person has, as a one-run plugin: links to each skill's folder, so nothing is copied.
function skillPlugin(e) {
  const mine = skillsOf(e);
  if (!mine.length) return null;
  const known = new Map(findSkills().map((x) => [x.id, x])), dir = path.join(DATA, 'skillsets', `${e.id}-${crypto.randomBytes(4).toString('hex')}`), used = new Set();
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'skills'));
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'orbit', version: '1.0.0', description: `The skills you gave ${e.name}` }));
  for (const id of mine) {
    const x = known.get(id);
    if (!x) continue;
    let n = x.name;
    for (let i = 2; used.has(n); i++) n = `${x.name}-${i}`;
    used.add(n);
    fs.symlinkSync(x.dir, path.join(dir, 'skills', n), 'junction'); // a junction on Windows needs no admin rights; elsewhere it's a normal link
  }
  if (used.size) return dir;
  fs.rmSync(dir, { recursive: true, force: true });
  return null;
}
const skillSlug = (name) => String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
export function saveSkill(b) {
  const slug = b.slug ? skillSlug(b.slug) : skillSlug(b.name), description = String(b.description ?? '').replace(/\s+/g, ' ').trim(), body = String(b.body ?? '').trim();
  if (!slug) throw new Error('Give the skill a short name, like "write-blog-posts".');
  if (!description) throw new Error('Say when to use it: the team reads this to decide.');
  if (description.length > 1000 || body.length > 60000) throw new Error('That skill is too long.');
  if (!body) throw new Error('Write the instructions: what to do, step by step.');
  if (!b.slug && fs.existsSync(path.join(SKILLS_DIR, slug))) throw new Error(`There's already a skill called "${slug}".`);
  fs.mkdirSync(path.join(SKILLS_DIR, slug), { recursive: true });
  fs.writeFileSync(path.join(SKILLS_DIR, slug, 'SKILL.md'), `---\nname: ${slug}\ndescription: ${description}\n---\n\n${body}\n`);
  return { id: `orbit/${slug}` };
}
export function assignSkill(id, employeeIds) {
  if (!findSkills().some((x) => x.id === id)) throw new Error('That skill is gone.');
  const want = new Set([].concat(employeeIds ?? []).map(Number));
  for (const e of all('SELECT * FROM employees')) {
    const has = skillsOf(e), on = want.has(e.id);
    if (on !== has.includes(id)) exec('UPDATE employees SET skills = ? WHERE id = ?', JSON.stringify(on ? [...has, id] : has.filter((x) => x !== id)), e.id);
  }
}

// ---------- the archive: chats, projects and people you're done with. Nothing is deleted; Restore brings them back. ----------
const notArchived = (e, p) => {
  if (e?.archived_at) throw new Error(`${e.name} is archived. Restore them from the Archive first.`);
  if (p?.archived_at) throw new Error(`The ${p.name} project is archived. Restore it from the Archive first.`);
};
export function archive(kind, id, on) {
  const stamp = on ? 'CURRENT_TIMESTAMP' : 'NULL';
  if (kind === 'chat') {
    const t = task(id);
    if (!t || t.kind !== 'chat') throw new Error('No such chat.');
    if (on && ['working', 'queued'].includes(t.status)) throw new Error("They're still working in this chat. Wait for the reply, or stop it first.");
    return exec(`UPDATE tasks SET archived_at = ${stamp} WHERE id = ?`, id);
  }
  if (kind === 'project') {
    if (!project(id)) throw new Error('No such project.');
    return exec(`UPDATE projects SET archived_at = ${stamp} WHERE id = ?`, id);
  }
  if (kind !== 'employee') throw new Error('Archive a chat, a project or a person.');
  const e = employee(id);
  if (!e) throw new Error('No such employee.');
  if (on) {
    if (Number(setting('main_assistant')) === e.id) throw new Error(`${e.name} is your main assistant. Pick someone else in Settings → General first.`);
    if (one(`SELECT 1 FROM tasks WHERE employee_id = ? AND status IN ${OPEN}`, id)) throw new Error(`${e.name} still has unfinished work. Stop or finish it first.`);
    if (one('SELECT 1 FROM schedules WHERE employee_id = ?', id)) throw new Error(`${e.name} has scheduled tasks. Delete those or give them to someone else first.`);
    exec('UPDATE employees SET reports_to = ? WHERE reports_to = ?', e.reports_to ?? null, id); // their team moves up a level
  } else if (e.reports_to && employee(e.reports_to)?.archived_at) exec('UPDATE employees SET reports_to = NULL WHERE id = ?', id); // their boss is archived too
  exec(`UPDATE employees SET archived_at = ${stamp} WHERE id = ?`, id);
}
export function setBoss(id, bossId) {
  const e = employee(id), boss = bossId ? employee(Number(bossId)) : null;
  if (!e) throw new Error('No such employee.');
  if (bossId && !boss) throw new Error('That boss is no longer on the team.');
  if (boss && isUnder(boss, e)) throw new Error(boss.id === e.id ? "Someone can't be their own boss." : `${boss.name} can't be ${e.name}'s boss: ${boss.name} works under ${e.name}.`);
  exec('UPDATE employees SET reports_to = ? WHERE id = ?', boss?.id ?? null, id);
}
function isUnder(e, boss) {
  for (let x = e, i = 0; x && i < 100; x = bossOf(x), i++) if (x.id === boss.id) return true;
  return false;
}

// One-time upgrades of older data.
for (const t of all('SELECT * FROM tasks WHERE id NOT IN (SELECT task_id FROM messages)')) { // before chats existed
  say(t.id, t.asked_by ? 'asker' : 'me', t.asked_by || 'me', t.body || t.title);
  if (t.result) say(t.id, 'reply', nameOf(t.employee_id), t.result, t.log.trim());
}
// Before tasks and chats were separate, every top-level "task" was really a chat.
exec(`UPDATE tasks SET kind = 'chat', created_by = 'me', status = CASE WHEN status IN ('review', 'done') THEN 'idle' ELSE status END
  WHERE created_by IS NULL AND parent_id IS NULL`);
exec(`UPDATE tasks SET created_by = COALESCE(asked_by, 'me') WHERE created_by IS NULL`);

// ---------- memory: plain files you can open and edit ----------
const readFile = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const writeFile = (f, text) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
const notesFile = (name) => path.join(DATA, 'notes', `${name.toLowerCase()}.md`); // an employee's own notes
const memoryFile = (name) => path.join(DATA, 'projects', `${slug(name)}.md`); // a project's memory
const NOTES_HEAD = (name) => `# ${name}'s notes\n\nWhat ${name} remembers between tasks. Edit or delete anything.\n`;
const MEMORY_HEAD = (name) => `# ${name}: project memory\n\nWhat the team knows about this project. Written by the team; the owner reads it to catch misunderstandings.\n`;
function addNotes(file, head, heading, lines) {
  writeFile(file, `${readFile(file) || head}\n## ${new Date().toISOString().slice(0, 10)} · ${heading}\n${lines.join('\n')}\n`);
}

// The bullet lines from a notes reply; anything else (preamble, NOTHING) is dropped.
export function pickNotes(text) {
  return text.split('\n').map((l) => l.trim()).filter((l) => /^[-*•] +\S/.test(l)).map((l) => '- ' + l.replace(/^[-*•] +/, ''));
}
// A notes reply has the employee's own points first, then project points after a "PROJECT:" line.
export function splitNotes(text) {
  const [mine, proj = ''] = text.split(/^\s*\**PROJECT:?\**\s*$/m);
  return { mine: pickNotes(mine), project: pickNotes(proj) };
}

// ---------- deliverables: files the team made ----------
const cwdOf = (t) => { const e = employee(t.employee_id), p = t.project_id && project(t.project_id); return expand(t.folder || p?.folder || e?.folder || DATA); };
const WRITE_LINE = /^→ (?:Write|Edit|MultiEdit|NotebookEdit) (.+)$/gm;
// The files a reply created or changed that still exist. Older replies only have their activity log to go on.
export function messageFiles(m, cwd) {
  let list = null;
  try { list = JSON.parse(m.files || 'null'); } catch {}
  if (!Array.isArray(list)) list = [...(m.activity || '').matchAll(WRITE_LINE)].map((x) => path.resolve(cwd, x[1].trim()));
  return [...new Set(list)].flatMap((f) => { try { const st = fs.statSync(f); return st.isFile() ? [{ path: f, name: path.basename(f), size: st.size }] : []; } catch { return []; } });
}
// A message's deliverables. A teammate's result from before files were recorded borrows them from that teammate's own task.
function deliverablesOf(m, t) {
  if (m.kind === 'reply') return messageFiles(m, cwdOf(t));
  if (m.kind !== 'teammate') return [];
  if (m.files) return messageFiles(m, cwdOf(t));
  const k = task(Number(m.text.match(/^Finished #(\d+)/)?.[1]));
  return k ? [...new Map(all(`SELECT kind, activity, files FROM messages WHERE task_id = ? AND kind = 'reply'`, k.id).flatMap((x) => messageFiles(x, cwdOf(k))).map((f) => [f.path, f])).values()] : [];
}
// You can open a file if your team made it in this conversation, or it sits inside this conversation's working folder.
function fileAllowed(t, file) {
  const full = path.resolve(file);
  return inside(full, cwdOf(t)) || all('SELECT * FROM messages WHERE task_id = ?', t.id).some((m) => deliverablesOf(m, t).some((f) => f.path === full) || attachmentsOf(m).some((f) => f.path === full));
}
// ---------- attachments: files you upload, or files you point at in the conversation's folder ----------
const UPLOADS = path.join(DATA, 'uploads');
export function cleanAttachments(list, cwd) {
  return [...new Set([].concat(list ?? []).map((p) => path.resolve(String(p))))].slice(0, 20).map((full) => {
    const how = inside(full, UPLOADS) ? 'upload' : inside(full, cwd) ? 'file' : null;
    if (!how) throw new Error("You can attach files you upload, or files in this conversation's folder.");
    let st;
    try { st = fs.statSync(full); } catch {}
    if (!st?.isFile()) throw new Error(`That file isn't there any more: ${path.basename(full)}`);
    return { path: full, name: path.basename(full), size: st.size, how };
  });
}
const attachmentsOf = (m) => { try { return JSON.parse(m.attachments || '[]'); } catch { return []; } };
const filesNote = (files) => (files.length ? `\n\nFiles I attached (read them as needed):\n${files.map((f) => `- ${f.path}`).join('\n')}` : '');
// Files to point at: everything in a folder (a few levels deep, skipping hidden and build folders), best matches first.
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', '__pycache__', 'venv']);
const folderFiles = new Map(); // folder -> { at, files }, kept for 30 seconds
async function filesIn(root) {
  const hit = folderFiles.get(root);
  if (hit && Date.now() - hit.at < 30000) return hit.files;
  const files = [];
  const walk = async (dir, depth) => {
    if (depth > 6 || files.length >= 5000) return;
    let entries = [];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const d of entries) {
      if (d.name.startsWith('.') || SKIP_DIRS.has(d.name) || files.length >= 5000) continue;
      if (d.isDirectory()) await walk(path.join(dir, d.name), depth + 1);
      else if (d.isFile()) files.push(path.join(dir, d.name));
    }
  };
  await walk(root, 0);
  folderFiles.set(root, { at: Date.now(), files });
  return files;
}
export function rankFiles(files, root, q = '') {
  q = String(q).trim().toLowerCase();
  const scored = files.map((f) => {
    const rel = path.relative(root, f), low = rel.toLowerCase(), base = path.basename(low);
    const score = !q ? 0 : base.startsWith(q) ? 0 : base.includes(q) ? 1 : low.includes(q) ? 2 : -1;
    return { path: f, rel, score, depth: rel.split(path.sep).length };
  }).filter((x) => x.score >= 0);
  return scored.sort((a, b) => a.score - b.score || a.depth - b.depth || a.rel.localeCompare(b.rel)).slice(0, 30).map(({ path: p, rel }) => ({ path: p, rel }));
}
const TYPES = { html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', svg: 'image/svg+xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf', md: 'text/plain', txt: 'text/plain', csv: 'text/plain' };

// ---------- asking the owner ----------
const EDIT_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const CHROME = 'mcp__claude-in-chrome'; // your real browser, signed in to your accounts
export const allowOf = (e) => { let a = {}; try { a = JSON.parse(e.allow || '{}'); } catch {} return { rules: [].concat(a.rules ?? []).map(String), dirs: [].concat(a.dirs ?? []).map(String) }; };
const inside = within;
// "npm install express" → "npm install"; "ls -la" → "ls"
export function bashPrefix(cmd) {
  const w = String(cmd ?? '').trim().split(/\s+/);
  return w[1] && /^[a-z][\w:-]*$/i.test(w[1]) ? `${w[0]} ${w[1]}` : w[0];
}
// Did you already say "don't ask me again" for this?
export function preApproved(e, cwd, tool, input) {
  const { rules, dirs } = allowOf(e), file = input?.file_path || input?.notebook_path;
  if (EDIT_TOOLS.includes(tool) && file) return (e.access !== 'read' && inside(file, cwd)) || dirs.some((d) => inside(file, d));
  if (tool === 'Bash') return rules.some((r) => { const m = r.match(/^Bash\((.+):\*\)$/); return m && (input.command.trim() + ' ').startsWith(m[1] + ' '); });
  if (tool.startsWith(CHROME + '__')) return rules.includes(CHROME);
  return rules.includes(tool);
}
// What a request means, why it needs you, and what "don't ask me again" would allow.
export function describe(e, cwd, tool, input) {
  const file = input?.file_path || input?.notebook_path;
  if (EDIT_TOOLS.includes(tool) && file) {
    const isNew = tool === 'Write' && !fs.existsSync(file), dir = path.dirname(path.resolve(file));
    return {
      what: `${isNew ? 'Create' : 'Change'} the file ${file}`,
      preview: (input.content ?? (input.new_string != null ? `Replace:\n${input.old_string}\n\nWith:\n${input.new_string}` : '')).split('\n').slice(0, 40).join('\n'),
      needs: e.access === 'read' ? `${e.name}'s file access is Read only.` : `The file is outside ${e.name}'s working folder.`,
      always: e.access === 'read' && inside(file, cwd) ? { kind: 'access', label: `Give ${e.name} "Can edit" access (inside their working folder)` }
        : { kind: 'dir', dir, label: `Let ${e.name} edit files in ${dir} without asking` },
    };
  }
  if (tool === 'Bash') {
    const p = bashPrefix(input.command);
    return { what: `Run a command: ${input.command}`, preview: '', reason: input.description || '', needs: `Running commands needs your OK (${e.name}'s file access is ${e.access === 'read' ? 'Read only' : 'Can edit'}).`,
      always: { kind: 'rule', rule: `Bash(${p}:*)`, label: `Let ${e.name} run "${p} …" commands without asking` } };
  }
  if (tool.startsWith(CHROME + '__')) {
    const act = tool.slice(CHROME.length + 2), i = input ?? {};
    const doing = act === 'navigate' ? `Open ${i.url} in your Chrome`
      : act === 'computer' ? `${{ left_click: 'Click', right_click: 'Right-click', double_click: 'Double-click', type: `Type "${String(i.text ?? '').slice(0, 80)}"`, key: `Press ${i.text}`,
          screenshot: 'Take a screenshot', scroll: 'Scroll', left_click_drag: 'Drag', hover: 'Hover', zoom: 'Zoom into' }[i.action] ?? i.action} on a page in your Chrome`
      : act === 'form_input' ? 'Fill in a form field in your Chrome' : act === 'javascript_tool' ? 'Run a script on a page in your Chrome'
      : act === 'file_upload' ? 'Upload a file to a page in your Chrome' : `Use your Chrome: ${act.replace(/_mcp$/, '').replace(/_/g, ' ')}`;
    return { what: doing, preview: JSON.stringify(i, null, 2).slice(0, 1200), needs: `It's your real browser, signed in to your accounts, so each action needs your OK.`,
      always: { kind: 'rule', rule: CHROME, label: `Let ${e.name} use your Chrome without asking` } };
  }
  return { what: `Use ${tool}`, preview: JSON.stringify(input ?? {}, null, 2).slice(0, 1500), needs: `${e.name}'s access doesn't cover ${tool}.`,
    always: { kind: 'rule', rule: tool, label: `Let ${e.name} use ${tool} without asking` } };
}

// The first time after `after` that a schedule should run.
export function nextRun(s, after) {
  const [h, m] = s.at.split(':').map(Number);
  const d = new Date(after);
  d.setHours(h, m, 0, 0);
  if (s.every === 'monthly') {
    d.setDate(s.day);
    if (d <= after) d.setMonth(d.getMonth() + 1, s.day);
    return d;
  }
  // At most 8 steps (a week plus one); the limit keeps a bad schedule from ever freezing the app.
  for (let i = 0; i < 8 && (d <= after || (s.every === 'weekdays' && [0, 6].includes(d.getDay())) || (s.every === 'weekly' && d.getDay() !== s.day)); i++)
    d.setDate(d.getDate() + 1);
  return d;
}

function systemPrompt(e, t, cwd) {
  const p = t.project_id && project(t.project_id), parent = t.parent_id && task(t.parent_id);
  const team = all('SELECT * FROM employees WHERE archived_at IS NULL ORDER BY name'), boss = bossOf(e), reports = team.filter((x) => x.reports_to === e.id);
  const perm = permsOf(e), canRules = perm.global_rules || perm.boss_rules || perm.team_rules;
  const notes = readFile(notesFile(e.name)).trim(), memory = p ? readFile(memoryFile(p.name)).trim() : '';
  const recent = all(`SELECT title, result FROM tasks WHERE kind = 'task' AND employee_id = ? AND status = 'done' AND id != ?
    ORDER BY updated_at DESC LIMIT 5`, e.id, t.id);
  const toOwner = t.kind === 'chat' || !t.parent_id || ['me', 'schedule'].includes(t.created_by);
  const label = (x) => `${x.name}${x.title ? ` (${x.title})` : ''}`;
  const globalRules = setting('global_rules').trim(), bossRules = setting('boss_rules').trim(), owner = setting('owner_name').trim();
  return [
    `You are ${e.name}${e.title ? `, ${e.title},` : ''} in a small personal company. The owner (your user) runs it; everyone works for them.` +
      (owner ? ` The owner wants to be called ${owner}; use that name when you address them or mention them.` : ''),
    `Your job:\n${e.role}`,
    e.personality.trim() ? `Your personality (let it show in how you write and work):\n${e.personality.trim()}` : '',
    Number(setting('main_assistant')) === e.id
      ? 'You are the owner\'s main assistant: they come to you first for anything. Run the team for them: hand work to the right people, ' +
        'hire when the team is missing someone (if you are allowed to), follow up, check results, and report back clearly. The owner may also talk to anyone directly.'
      : employee(Number(setting('main_assistant'))) ? `${employee(Number(setting('main_assistant'))).name} is the owner's main assistant and runs the team. The owner may also talk to you directly; then do what they ask.` : '',
    `You report to ${boss ? label(boss) : 'the owner directly'}.${reports.length ? ` Your direct reports: ${reports.map(label).join(', ')}.` : ''}` +
      ' The org chart says who manages whom, but anyone may talk to anyone and give anyone work.',
    globalRules ? `Global rules. Everyone follows these, always; they override anything else:\n${globalRules}` : '',
    e.rules.trim() ? `Your own rules:\n${e.rules.trim()}` : '',
    toOwner && bossRules ? `Rules for replying to the owner (this reply goes to them):\n${bossRules}` : '',
    `${ACCESS_TEXT[e.access]}${perm.web ? '' : ' You cannot use the web.'}${perm.chrome ? ' You can use the owner\'s real Chrome browser through the Claude in Chrome tools. They are signed in there, so be careful: never send, post, buy or change account settings without their explicit OK.' : ''}${e.access === 'full' ? '' : ' Before something that needs the owner\'s OK, first say in one line why you need it: they see it in the approval popup.'}\nYour working folder: ${cwd}`,
    t.kind === 'chat'
      ? 'This is a chat with the owner: talk things through, answer questions, help plan. ' +
        (perm.tasks ? 'When work should be done, put it on the board with create_task and assign the right person (or yourself). ' +
          'Tasks you create here report back to this chat when they are done: check the results, then tell the owner what was done. '
          : 'You are not allowed to create tasks; if work should be done, say so and the owner will assign it. ') +
        'If something important is unclear, ask the owner a short question.'
      : `You are working on task #${t.id}: "${t.title}".` +
        (parent ? ` It is a subtask of #${parent.id} "${parent.title}".` : '') +
        (toOwner ? ' The owner reviews your result.' : ` ${t.created_by} gave it to you; your reply goes straight back to them.`) +
        '\nWhen you finish, reply with the result itself: the answer, the draft, or a short summary of what you changed and where. ' +
        (toOwner ? 'If something important is unclear, ask the owner a short question before doing the work. ' : 'If something is unclear, make a sensible assumption and say what you assumed. ') +
        (perm.tasks ? 'If part of the work is better done by a teammate, give it to them with create_task (it becomes a subtask of this task), then stop: ' +
          'their results come back to you and you continue. Do small things yourself instead of creating tasks for them.' : ''),
    p ? `Project: ${p.name}\n${p.description}` +
      // ponytail: only the newest 10k characters of memory reach Claude; trim the file by hand if it ever gets that long
      (memory ? `\n\nProject memory (what the team has learned; the owner reads it to catch misunderstandings):\n${memory.slice(-10000)}` : '') : '',
    team.length > 1 ? `The team:\n${team.filter((x) => x.id !== e.id).map((x) =>
      `- ${label(x)}, reports to ${bossOf(x) ? (bossOf(x).id === e.id ? 'you' : bossOf(x).name) : 'the owner'}: ${x.role.split('\n')[0].slice(0, 120)}`).join('\n')}` : '',
    t.kind === 'chat' && !p && all('SELECT 1 FROM projects WHERE archived_at IS NULL').length ? `Projects (for create_task): ${all('SELECT name FROM projects WHERE archived_at IS NULL ORDER BY name').map((x) => x.name).join(', ')}` : '',
    notes ? `Your notes from earlier work (your long-term memory; the owner may have edited them):\n${notes.slice(-12000)}` : '',
    recent.length ? `Your recently finished tasks, for context:\n${recent.map((r) =>
      `- "${r.title}": ${(r.result || '').slice(0, 300).replace(/\s+/g, ' ')}`).join('\n')}` : '',
    (() => { const mine = new Set(skillsOf(e)), list = mine.size ? findSkills().filter((x) => mine.has(x.id)) : [];
      return list.length ? `Your skills (use them when the work fits; they're named orbit:<name>):\n${list.map((x) => `- ${x.name}: ${x.description.slice(0, 200)}`).join('\n')}` : ''; })(),
    'Orbit tools: ' + [perm.tasks && 'create_task puts work on the board and assigns it', 'list_tasks and get_task check the board',
      `remember saves a lasting fact to your own notes (about="me")${perm.project_memory ? ' or to the project memory (about="project")' : ''}`,
      canRules && 'read_rules and update_rules change the rules you are allowed to change',
      perm.hire && 'hire adds a new employee to your team when the owner asks for it (they report to you, someone under you, or the owner)',
      perm.hire && "update_teammate changes the title, job description, personality or boss of someone under you when the owner asks",
      ownerReads(t) && 'ask_owner shows the owner your questions as a quick multiple-choice form (they can type their own answer too): use it whenever you need them to decide something, instead of writing the questions in your reply'].filter(Boolean).join('; ') +
      '. Use remember when you learn something that will matter later.',
  ].filter(Boolean).join('\n\n');
}

// ---------- tools employees use, served to Claude Code as an MCP server ----------
const runs = new Map(); // secret per run -> { taskId, employeeId, created }
const findEmployee = (name) => one('SELECT * FROM employees WHERE name = ? AND archived_at IS NULL', String(name ?? '').trim().replace(/^@/, ''));
const findProject = (name) => one('SELECT * FROM projects WHERE name = ? AND archived_at IS NULL', String(name ?? '').trim());
const teamNames = () => all('SELECT name FROM employees').map((x) => x.name).join(', ');
const brief = (t) => `#${t.id} [${t.status}] ${t.title} (${t.employee_id ? nameOf(t.employee_id) : 'unassigned'}` +
  `${t.project_id ? ', ' + (project(t.project_id)?.name ?? '?') : ''}${t.parent_id ? ', subtask of #' + t.parent_id : ''})`;

// Whom someone may report to, as an employee asks: blank or "me" = the one asking, "owner" (or the owner's name) = straight
// under the owner (null), otherwise a teammate who works under the one asking. Where someone sits gives them no extra power.
function pickBoss(said, me) {
  said = String(said ?? '').trim();
  const ownerName = setting('owner_name').trim();
  if (/^(the )?owner$/i.test(said) || (ownerName && said.toLowerCase() === ownerName.toLowerCase())) return null;
  const boss = !said || /^(me|myself|you)$/i.test(said) ? me : findEmployee(said);
  if (!boss) throw new Error(`No teammate called "${said}".`);
  if (!isUnder(boss, me)) throw new Error('They can report to you, to someone under you, or to the owner ("owner").');
  return boss;
}
const asking = new Map(); // task id -> the questions this run asks the owner
// Questions for the owner, kept short and tidy: 1-4 questions, each with 2-6 options (they can always type their own answer).
export function cleanQuestions(list) {
  const qs = [].concat(list ?? []).slice(0, 4).map((q) => ({
    question: String(q?.question ?? '').trim().slice(0, 300),
    multi: q?.multi === true,
    options: [].concat(q?.options ?? []).map((o) => (typeof o === 'string' ? { label: o } : o ?? {}))
      .map((o) => ({ label: String(o.label ?? '').trim().slice(0, 80), ...(o.description ? { description: String(o.description).trim().slice(0, 160) } : {}) }))
      .filter((o) => o.label).slice(0, 6),
  })).filter((q) => q.question);
  if (!qs.length) throw new Error('Ask at least one question.');
  for (const q of qs) if (q.options.length < 2) throw new Error(`Give at least two options for "${q.question}". The owner can always type their own answer too.`);
  return qs;
}
export const TOOLS = [
  {
    name: 'create_task',
    description: 'Put a task on the Orbit board and assign it to a teammate (or yourself). From inside a task it becomes a subtask of that task: ' +
      'create the subtasks you need, then stop; their results come back to you. From a chat, the result comes back to you in that chat.',
    inputSchema: { type: 'object', required: ['title', 'description', 'assignee'], properties: {
      title: { type: 'string', description: 'Short, clear title' },
      description: { type: 'string', description: 'Everything they need to do it without asking: context, what "done" looks like' },
      assignee: { type: 'string', description: 'A teammate\'s name, or "me" for yourself' },
      project: { type: 'string', description: 'Project name. Optional: defaults to the current project' },
      parent_task_id: { type: 'number', description: 'Optional: make it a subtask of this task instead' },
    } },
    run(a, ctx) {
      const me = employee(ctx.employeeId), here = task(ctx.taskId);
      const title = String(a.title ?? '').trim(), description = String(a.description ?? '').trim();
      if (!title) throw new Error('Give the task a title.');
      const who = /^(me|myself|self)$/i.test(String(a.assignee ?? '').trim()) ? me : findEmployee(a.assignee);
      if (!who) throw new Error(`No teammate called "${a.assignee}". The team: ${teamNames()}.`);
      const parent = a.parent_task_id ? task(a.parent_task_id) : here; // from a chat, results come back into the chat
      if (a.parent_task_id && parent?.kind !== 'task') throw new Error(`There is no task #${a.parent_task_id}.`);
      const fromChat = parent.kind === 'chat';
      const proj = a.project ? findProject(a.project) : null;
      if (a.project && !proj) throw new Error(`No project called "${a.project}". Projects: ${all('SELECT name FROM projects WHERE archived_at IS NULL').map((x) => x.name).join(', ') || 'none'}.`);
      if (!permsOf(me).tasks) throw new Error('You are not allowed to create tasks.');
      if (ctx.created >= LIMITS.perTurn) throw new Error(`You can create at most ${LIMITS.perTurn} tasks per turn. Work with what you have.`);
      if (depth(parent) >= LIMITS.depth) throw new Error(`Tasks can only be nested ${LIMITS.depth} levels deep. Do this part yourself.`);
      if (one(`SELECT count(*) AS n FROM tasks WHERE kind = 'task' AND created_by NOT IN ('me', 'schedule') AND status != 'done'`).n >= LIMITS.open)
        throw new Error(`The team already has ${LIMITS.open} unfinished tasks it created itself. Wait for some to finish.`);
      const id = createTask({ employee_id: who.id, title, description, created_by: me.name, parent_id: parent?.id ?? null,
        project_id: proj?.id ?? parent.project_id ?? null });
      ctx.created++;
      say(here.id, 'note', me.name, `${me.name} created task #${id} for ${who.name}: ${title}`);
      return fromChat ? `Created task #${id} "${title}" for ${who.id === me.id ? 'you' : who.name}. It starts as soon as they are free; when it is done, the result comes back to you in this chat.`
        : `Created subtask #${id} "${title}" for ${who.id === me.id ? 'you' : who.name}. It starts as soon as they are free. ` +
        'When you have created all the subtasks you need, stop: their results come back to you here.';
    },
  },
  {
    name: 'list_tasks',
    description: 'See tasks on the Orbit board.',
    inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Only this project' }, include_done: { type: 'boolean' } } },
    run(a) {
      const proj = a.project ? findProject(a.project) : null;
      if (a.project && !proj) throw new Error(`No project called "${a.project}".`);
      const rows = all(`SELECT * FROM tasks WHERE kind = 'task' ${proj ? 'AND project_id = ' + proj.id : ''} ${a.include_done ? '' : "AND status != 'done'"}
        ORDER BY id DESC LIMIT 60`);
      return rows.map(brief).join('\n') || 'No tasks.';
    },
  },
  {
    name: 'get_task',
    description: 'Read one task: description, status, latest result and subtasks.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'number' } } },
    run(a) {
      const t = task(a.id);
      if (!t || t.kind !== 'task') throw new Error(`There is no task #${a.id}.`);
      const kids = all('SELECT * FROM tasks WHERE parent_id = ?', t.id);
      return [brief(t), t.body && `Description:\n${t.body}`, t.result && `Latest result:\n${t.result}`,
        kids.length && `Subtasks:\n${kids.map(brief).join('\n')}`].filter(Boolean).join('\n\n');
    },
  },
  {
    name: 'remember',
    description: 'Save a lasting fact for future work. about="me": your own notes (the owner\'s preferences, how you work). ' +
      'about="project": the current project\'s memory, shared with the whole team (decisions, facts, where things are).',
    inputSchema: { type: 'object', required: ['note', 'about'], properties: {
      note: { type: 'string', description: 'One short, self-contained fact' }, about: { type: 'string', enum: ['me', 'project'] } } },
    run(a, ctx) {
      const me = employee(ctx.employeeId), here = task(ctx.taskId), note = String(a.note ?? '').trim().replace(/^[-*•] +/, '');
      if (!note) throw new Error('Write the note.');
      const p = here.project_id && project(here.project_id);
      if (a.about === 'project' && !p) throw new Error('This work has no project, so save it with about="me".');
      if (a.about === 'project' && !permsOf(me).project_memory) throw new Error('You are not allowed to write to project memory; save it with about="me".');
      if (a.about === 'project') addNotes(memoryFile(p.name), MEMORY_HEAD(p.name), `from ${me.name}`, [`- ${note}`]);
      else addNotes(notesFile(me.name), NOTES_HEAD(me.name), here.title, [`- ${note}`]);
      say(here.id, 'memory', me.name, a.about === 'project' ? `${me.name} added to the ${p.name} project memory` : `${me.name} added to their notes`, `- ${note}`);
      return 'Saved.';
    },
  },
  {
    name: 'read_rules',
    description: 'Read rules: "global" (everyone, always), "owner" (how everyone replies to the owner), or "individual" (one person\'s own rules).',
    inputSchema: { type: 'object', required: ['which'], properties: {
      which: { type: 'string', enum: ['global', 'owner', 'individual'] }, employee: { type: 'string', description: 'For individual rules; defaults to you' } } },
    run(a, ctx) {
      const me = employee(ctx.employeeId);
      if (a.which !== 'individual') return setting(a.which === 'global' ? 'global_rules' : 'boss_rules') || '(none)';
      const who = a.employee ? findEmployee(a.employee) : me;
      if (!who) throw new Error(`No teammate called "${a.employee}".`);
      if (who.id !== me.id && !(permsOf(me).team_rules && isUnder(who, me))) throw new Error(`You can only read the individual rules of yourself and people under you.`);
      return who.rules || '(none)';
    },
  },
  {
    name: 'update_rules',
    description: 'Replace a set of rules with new text (send the complete new rules, not just the change). Only works if the owner gave you permission.',
    inputSchema: { type: 'object', required: ['which', 'text'], properties: {
      which: { type: 'string', enum: ['global', 'owner', 'individual'] }, text: { type: 'string', description: 'The complete new rules' },
      employee: { type: 'string', description: 'For individual rules: whose (yourself or someone under you); defaults to you' } } },
    run(a, ctx) {
      const me = employee(ctx.employeeId), perm = permsOf(me), here = task(ctx.taskId), text = String(a.text ?? '').trim().slice(0, 5000);
      let label, before;
      if (a.which === 'global' || a.which === 'owner') {
        if (!perm[a.which === 'global' ? 'global_rules' : 'boss_rules']) throw new Error('You are not allowed to change those rules.');
        const key = a.which === 'global' ? 'global_rules' : 'boss_rules';
        [label, before] = [a.which === 'global' ? 'the global rules' : 'the rules for talking to the owner', setting(key)];
        setSetting(key, text);
      } else if (a.which === 'individual') {
        const who = a.employee ? findEmployee(a.employee) : me;
        if (!who) throw new Error(`No teammate called "${a.employee}".`);
        if (!perm.team_rules || !isUnder(who, me)) throw new Error('You can only change the individual rules of yourself and people under you, and only with permission.');
        [label, before] = [who.id === me.id ? 'their own rules' : `${who.name}'s rules`, who.rules];
        exec('UPDATE employees SET rules = ? WHERE id = ?', text, who.id);
      } else throw new Error('which must be global, owner or individual.');
      say(here.id, 'memory', me.name, `${me.name} changed ${label}`, `Before:\n${before || '(none)'}\n\nAfter:\n${text || '(none)'}`);
      return 'Rules updated.';
    },
  },
  {
    name: 'hire',
    description: 'Hire a new employee into the company. They report to you unless you name someone under you, or "owner" when the owner wants them working directly under them. ' +
      'Only hire when the owner asks you to or clearly agrees. Write their job description and personality to them ("You are...").',
    inputSchema: { type: 'object', required: ['name', 'title', 'job_description'], properties: {
      name: { type: 'string', description: 'One word, not already taken, e.g. Nova' },
      title: { type: 'string', description: 'Job title, e.g. Front-end Developer' },
      job_description: { type: 'string', description: 'What they do and what good work looks like' },
      personality: { type: 'string', description: 'How they come across: tone, style' },
      rules: { type: 'string', description: 'Their individual rules (optional)' },
      reports_to: { type: 'string', description: 'Their boss: you (default), someone under you, or "owner" to report straight to the owner (only when the owner asks for that)' },
      model: { type: 'string', enum: ['default', ...MODELS], description: '"default" follows the owner\'s settings' },
      file_access: { type: 'string', enum: ACCESS_ORDER, description: 'read, edit or full; at most your own access' },
    } },
    run(a, ctx) {
      const me = employee(ctx.employeeId), here = task(ctx.taskId);
      if (!permsOf(me).hire) throw new Error('You are not allowed to hire.');
      if ((ctx.hired ?? 0) >= LIMITS.hiresPerTurn) throw new Error(`You can hire at most ${LIMITS.hiresPerTurn} people per reply.`);
      if (one('SELECT count(*) AS n FROM employees').n >= LIMITS.team) throw new Error(`The company is full (${LIMITS.team} people). The owner can make room in Settings.`);
      const boss = pickBoss(a.reports_to, me);
      const access = a.file_access || 'read';
      if (!ACCESS_ORDER.includes(access)) throw new Error('file_access must be read, edit or full.');
      if (ACCESS_ORDER.indexOf(access) > ACCESS_ORDER.indexOf(me.access))
        throw new Error(`You can't give more file access than you have ("${me.access}"). Hire them with "${me.access}"; the owner can raise it in Settings.`);
      // New hires never get to hire or change rules: only the owner grants those.
      saveEmployee({ name: a.name, title: a.title, role: a.job_description, personality: a.personality, rules: a.rules, reports_to: boss?.id ?? null,
        model: a.model || 'default', effort: 'default', access, perms: { hire: false, global_rules: false, boss_rules: false, team_rules: false } });
      ctx.hired = (ctx.hired ?? 0) + 1;
      say(here.id, 'note', me.name, `${me.name} hired ${String(a.name).trim()}${a.title ? ', ' + String(a.title).trim() : ''} (reports to ${boss ? boss.name : setting('owner_name') || 'you'}, files: ${access})`);
      return `Hired ${String(a.name).trim()}. They can take tasks right away.${access === 'read' ? ' They can read files but not change them; if they need to build things, tell the owner to raise their file access in Settings.' : ''}`;
    },
  },
  {
    name: 'ask_owner',
    description: 'Ask the owner 1 to 4 questions as a quick form: each question has 2 to 6 options to click, and they can always type their own answer. ' +
      'Use it whenever you need the owner to decide something, instead of writing the questions in your reply. Call it once, then end your reply with one short line; ' +
      "the questions show under your reply and the answers come back as the owner's next message.",
    inputSchema: { type: 'object', required: ['questions'], properties: { questions: { type: 'array', minItems: 1, maxItems: 4, items: {
      type: 'object', required: ['question', 'options'], properties: {
        question: { type: 'string', description: 'One clear question' },
        options: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'object', required: ['label'], properties: {
          label: { type: 'string', description: 'A short answer, 1 to 5 words' },
          description: { type: 'string', description: 'What picking it means (optional, one line)' } } } },
        multi: { type: 'boolean', description: 'true if they may pick more than one' } } } } } },
    run(a, ctx) {
      const here = task(ctx.taskId);
      if (!ownerReads(here)) throw new Error('Only replies that go to the owner can ask them questions. Ask whoever gave you this task, in your reply.');
      const qs = cleanQuestions(a.questions);
      asking.set(here.id, qs);
      return `The owner will see ${qs.length === 1 ? 'your question' : `your ${qs.length} questions`} as a form under your reply. End your reply now in one short line, without repeating them. Their answers come back as their next message.`;
    },
  },
  {
    name: 'update_teammate',
    description: 'Change the title, job description, personality or boss of someone who works under you, when the owner asks. ' +
      "Only send what changes. You can't change your own profile, or anyone's model, file access or permissions: the owner does that in Settings.",
    inputSchema: { type: 'object', required: ['name'], properties: {
      name: { type: 'string', description: 'Who to change' },
      title: { type: 'string', description: 'New job title' },
      job_description: { type: 'string', description: 'New job description, written to them ("You are...")' },
      personality: { type: 'string', description: 'New personality' },
      reports_to: { type: 'string', description: 'New boss: you, someone under you, or "owner" to report straight to the owner' },
    } },
    run(a, ctx) {
      const me = employee(ctx.employeeId), here = task(ctx.taskId);
      if (!permsOf(me).hire) throw new Error("You aren't allowed to change people's profiles. The owner can allow it in Settings.");
      const who = findEmployee(a.name);
      if (!who) throw new Error(`No teammate called "${a.name}".`);
      if (who.id === me.id) throw new Error("You can't change your own profile. Ask the owner; they can do it in Settings.");
      if (!isUnder(who, me)) throw new Error(`${who.name} doesn't work under you, so you can't change their profile.`);
      const text = (v, max) => String(v).trim().slice(0, max), done = [];
      if (a.title != null) { exec('UPDATE employees SET title = ? WHERE id = ?', text(a.title, 60), who.id); done.push(`title is now "${text(a.title, 60)}"`); }
      if (a.job_description != null) {
        if (!text(a.job_description, 5000)) throw new Error('A job description can\'t be empty.');
        exec('UPDATE employees SET role = ? WHERE id = ?', text(a.job_description, 5000), who.id);
        done.push('new job description');
      }
      if (a.personality != null) { exec('UPDATE employees SET personality = ? WHERE id = ?', text(a.personality, 3000), who.id); done.push('new personality'); }
      if (a.reports_to != null) {
        const boss = pickBoss(a.reports_to, me);
        setBoss(who.id, boss?.id ?? null);
        done.push(`now reports to ${boss ? boss.name : setting('owner_name') || 'the owner'}`);
      }
      if (!done.length) throw new Error('Say what to change: title, job_description, personality or reports_to.');
      say(here.id, 'note', me.name, `${me.name} updated ${who.name}: ${done.join(', ')}`);
      return `Updated ${who.name}: ${done.join(', ')}. It applies from their next reply.`;
    },
  },
];
const approvals = new Map(); // waiting for you: id -> request (+ resolve)
const APPROVAL_WAIT = 30 * 60 * 1000;
let approvalSeq = 0;
TOOLS.push({
  name: 'permission_prompt',
  description: 'Orbit uses this internally to ask the owner for permission. Never call it yourself.',
  inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } } },
  async run(a, ctx) {
    const no = (message) => JSON.stringify({ behavior: 'deny', message });
    if (!a.tool_name || !a.tool_use_id) return no('This tool is only for Orbit.');
    const e = employee(ctx.employeeId), t = task(ctx.taskId);
    if (!e || !t) return no('This work has ended.');
    if (preApproved(e, ctx.cwd, a.tool_name, a.input)) return JSON.stringify({ behavior: 'allow', updatedInput: a.input });
    const d = describe(e, ctx.cwd, a.tool_name, a.input);
    // Their own words just before asking are the best "why".
    const words = t.log.split('\n').filter((l) => l.trim() && !/^[→✋⏳]/.test(l)).slice(-3).join('\n').slice(-600) || d.reason ||
      (() => { const asked = one(`SELECT text FROM messages WHERE task_id = ? AND kind IN ('me', 'asker') ORDER BY id DESC LIMIT 1`, t.id)?.text || t.body;
        return asked ? `(They didn't explain. They're working on: "${asked.slice(0, 300)}${asked.length > 300 ? '…' : ''}")` : ''; })();
    const id = ++approvalSeq;
    appendLog(t.id, `⏳ Waiting for your OK: ${d.what.split('\n')[0].slice(0, 140)}\n`);
    const decision = await new Promise((resolve) => {
      const timer = setTimeout(() => decide(id, false, false, 'No answer from the owner within 30 minutes. Carry on without it, or say what you need.'), APPROVAL_WAIT);
      approvals.set(id, { id, taskId: t.id, employeeId: e.id, title: t.title, kind: t.kind, tool: a.tool_name, ...d, why: [...new Set([d.reason, words].filter(Boolean))].join('\n\n'),
        at: Date.now(), resolve: (x) => { clearTimeout(timer); resolve(x); } });
    });
    return decision.allow ? JSON.stringify({ behavior: 'allow', updatedInput: a.input }) : no(decision.message);
  },
});

function decide(id, allow, always, message = 'The owner said no. Don\'t try that again; find another way, or explain what you need.') {
  const ap = approvals.get(id);
  if (!ap) throw new Error('That request is no longer waiting. The work may have stopped.');
  approvals.delete(id);
  const e = employee(ap.employeeId);
  if (allow && always && e) {
    const a = allowOf(e);
    if (ap.always.kind === 'access') exec("UPDATE employees SET access = 'edit' WHERE id = ? AND access = 'read'", e.id);
    if (ap.always.kind === 'dir' && !a.dirs.includes(ap.always.dir)) a.dirs.push(ap.always.dir);
    if (ap.always.kind === 'rule' && !a.rules.includes(ap.always.rule)) a.rules.push(ap.always.rule);
    exec('UPDATE employees SET allow = ? WHERE id = ?', JSON.stringify(a), e.id);
  }
  if (task(ap.taskId)) say(ap.taskId, 'note', 'me', allow ? `You allowed ${e?.name ?? 'them'}: ${ap.what.split('\n')[0]}${always ? ` (from now on: ${ap.always.label.replace(/^\w/, (c) => c.toLowerCase())})` : ''}`
    : `${message.startsWith('No answer') ? 'Nobody answered' : 'You said no to'} ${e?.name ?? 'them'}: ${ap.what.split('\n')[0]}`);
  ap.resolve(allow ? { allow: true } : { allow: false, message });
}

const toolAllowed = (name, perm) => (name === 'create_task' ? perm.tasks : ['hire', 'update_teammate'].includes(name) ? perm.hire
  : ['read_rules', 'update_rules'].includes(name) ? perm.global_rules || perm.boss_rules || perm.team_rules : true);

// MCP over HTTP, the small subset Claude Code needs: JSON answers, no streams. Only a live run's secret gets in.
async function serveTools(req, res) {
  const ctx = runs.get(String(req.headers.authorization).replace(/^Bearer /, ''));
  if (!ctx) return res.writeHead(401).end();
  if (req.method !== 'POST') return res.writeHead(405).end();
  let m;
  try { let raw = ''; for await (const chunk of req) raw += chunk; m = JSON.parse(raw); } catch { return res.writeHead(400).end(); }
  if (m.id === undefined) return res.writeHead(202).end(); // a notification: nothing to answer
  const reply = (body) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, ...body })); };
  if (m.method === 'initialize')
    return reply({ result: { protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'crew', version: '1' } } });
  if (m.method === 'ping') return reply({ result: {} });
  const perm = permsOf(employee(ctx.employeeId) ?? {});
  if (m.method === 'tools/list') return reply({ result: { tools: TOOLS.filter((t) => toolAllowed(t.name, perm)).map(({ run, ...t }) => t) } });
  if (m.method === 'tools/call') {
    const tool = TOOLS.find((t) => t.name === m.params?.name && toolAllowed(t.name, perm));
    let text, isError = false;
    try { text = tool ? await tool.run(m.params.arguments ?? {}, ctx) : `Unknown tool ${m.params?.name}.`; isError = !tool; }
    catch (err) { text = err.message; isError = true; }
    reply({ result: { content: [{ type: 'text', text }], isError } });
    return pump(); // a new task may be ready to start
  }
  reply({ error: { code: -32601, message: 'Method not found' } });
}

// ---------- running Claude ----------
const running = new Map(); // task id -> child process
const stopping = new Set();
const reflecting = new Map(); // task id -> child writing notes after "Mark done"

// Start Claude Code for an employee, on your login, without your personal connectors or hooks.
function claude(e, cwd, args, prompt, model, effort) {
  const env = { ...process.env };
  for (const k of ['ANTHROPIC_API_KEY', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']) delete env[k]; // never an API key
  env.MCP_TOOL_TIMEOUT = String(APPROVAL_WAIT + 5 * 60 * 1000); // a popup may wait for you a while
  const skills = e.id && !args.includes('--tools') ? skillPlugin(e) : null; // their skills, for this run only (pictures need none)
  const child = spawn(CLAUDE, ['-p', '--output-format', 'stream-json', '--verbose', '--model', model, ...(effort ? ['--effort', effort] : []),
    '--strict-mcp-config', // only Orbit's own tools; your personal connectors (Gmail, etc.) stay away from employees
    // and your personal hooks, and Claude Code's own hidden memory (their notes file is the one memory you can see)
    '--settings', '{"disableAllHooks":true,"autoMemoryEnabled":false}',
    '--setting-sources', 'project,local', // not your own Claude Code settings, so your plugins and skills only go to people you give them to
    ...(skills ? ['--plugin-dir', skills] : []),
    '--disallowedTools', ...BLOCKED_TOOLS, ...(permsOf(e).web ? [] : ['WebSearch', 'WebFetch']),
    ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.on('error', () => {}); // spawn failure surfaces via the child's 'error' event
  if (skills) child.on('close', () => fs.rmSync(skills, { recursive: true, force: true }));
  child.stdin.end(prompt);
  return child;
}

function pump() {
  for (const e of all('SELECT * FROM employees')) {
    if (one(`SELECT 1 FROM tasks WHERE employee_id = ? AND status = 'working'`, e.id)) continue;
    const next = one(`SELECT * FROM tasks WHERE employee_id = ? AND status = 'queued' ORDER BY updated_at, id LIMIT 1`, e.id);
    if (next && !reflecting.has(next.id)) run(next, e); // wait until they finish writing notes on it
  }
}

function toolLine(c, cwd) {
  const i = c.input || {};
  const what = i.command || i.file_path || i.pattern || i.url || i.query || i.title || i.note || i.description || '';
  return `→ ${c.name.replace(/^mcp__crew__/, '')} ${String(what).replace(cwd + '/', '').split('\n')[0].slice(0, 140)}\n`;
}

function run(t, e) {
  const p = t.project_id && project(t.project_id);
  if (!t.folder && p?.folder && !fs.existsSync(expand(p.folder))) { // moved or deleted since: stop instead of making an empty one
    say(t.id, 'note', e.name, `Couldn't start: the ${p.name} project folder is missing (${p.folder}). Fix it in the project's settings, then send a message to try again.`);
    return setTask(t.id, { status: 'failed' });
  }
  const cwd = expand(t.folder || p?.folder || e.folder);
  fs.mkdirSync(cwd, { recursive: true });
  const secret = crypto.randomUUID();
  runs.set(secret, { taskId: t.id, employeeId: e.id, created: 0, hired: 0, cwd });
  const tools = JSON.stringify({ mcpServers: { crew: { type: 'http', url: `http://localhost:${PORT}/mcp`, headers: { Authorization: `Bearer ${secret}` } } } });
  const { rules } = allowOf(e);
  const uploads = all('SELECT attachments FROM messages WHERE task_id = ? AND attachments IS NOT NULL', t.id).flatMap(attachmentsOf).filter((f) => f.how === 'upload').map((f) => path.dirname(f.path));
  const dirs = [...new Set([...allowOf(e).dirs, ...uploads])]; // folders you allowed, and the files you uploaded here
  // Their briefing goes in a file: it can be long, and Windows caps a command line at about 32,000 characters.
  const brief = path.join(DATA, 'briefs', `${t.id}-${crypto.randomBytes(4).toString('hex')}.md`);
  fs.mkdirSync(path.dirname(brief), { recursive: true });
  fs.writeFileSync(brief, systemPrompt(e, t, cwd));
  const args = ['--append-system-prompt-file', brief, '--mcp-config', tools, ...ACCESS[e.access], ...(permsOf(e).chrome ? ['--chrome'] : []),
    '--allowedTools', ...READ_TOOLS, ...rules, ...(dirs.length ? ['--add-dir', ...dirs] : []),
    '--permission-prompts', 'host', '--permission-prompt-tool', 'mcp__crew__permission_prompt']; // anything else asks you
  if (t.session_id) args.push('--resume', t.session_id);
  setTask(t.id, { status: 'working', next_prompt: null, log: '' }); // log = what they do during this turn
  const child = claude(e, cwd, args, t.next_prompt, modelFor(t, e), effortFor(t, e));
  child.on('close', () => fs.rmSync(brief, { force: true }));
  running.set(t.id, child);

  let final = null, stderr = '', ended = false, usedModel = null;
  const changed = new Set(); // files this turn created or changed
  child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)));
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    if (m.type === 'system' && m.subtype === 'init') { setTask(t.id, { session_id: m.session_id }); usedModel = m.model; }
    if (m.type === 'assistant') for (const c of m.message.content) {
      if (c.type === 'text' && c.text.trim()) appendLog(t.id, c.text.trim() + '\n');
      if (c.type === 'tool_use') appendLog(t.id, toolLine(c, cwd));
      if (c.type === 'tool_use' && EDIT_TOOLS.includes(c.name) && (c.input?.file_path || c.input?.notebook_path)) changed.add(path.resolve(cwd, c.input.file_path || c.input.notebook_path));
    }
    if (m.type === 'system' && m.subtype === 'permission_denied') appendLog(t.id, '✋ blocked by access level\n');
    if (m.type === 'result') final = m;
  });
  const end = () => {
    if (ended) return;
    ended = true;
    running.delete(t.id);
    runs.delete(secret);
    for (const ap of [...approvals.values()].filter((x) => x.taskId === t.id)) { approvals.delete(ap.id); ap.resolve({ allow: false, message: 'The work stopped.' }); }
    if (final) exec('UPDATE tasks SET cost = cost + ? WHERE id = ?', final.total_cost_usd || 0, t.id);
    const now = task(t.id), questions = asking.get(t.id);
    asking.delete(t.id);
    if (stopping.delete(t.id)) {
      say(t.id, 'note', e.name, 'Stopped by you', now.log.trim());
      setTask(t.id, { status: 'stopped' });
    } else if (!final || final.is_error) {
      say(t.id, 'note', e.name, `Failed: ${final?.result || stderr.trim() || 'Claude exited without a result'}`, now.log.trim());
      setTask(t.id, { status: 'failed' });
    } else finish(now, e, final.result || '', { model: usedModel || Object.keys(final.modelUsage || {})[0] || null, effort: effortFor(t, e) || 'standard', files: [...changed], questions });
    pump();
  };
  child.on('close', end);
  child.on('error', (err) => { stderr += err.message; end(); }); // e.g. `claude` not installed
}

// Replies the owner reads: chats, and tasks the owner (or a schedule) gave out. Subtasks go back to the teammate who asked.
const ownerReads = (t) => t.kind === 'chat' || !t.parent_id || ['me', 'schedule'].includes(t.created_by);
function finish(t, e, text, stamp) {
  // The activity log ends with the reply itself; keep only the steps that led to it.
  const activity = t.log.trim().endsWith(text.trim()) ? t.log.trim().slice(0, -text.trim().length).trim() : t.log.trim();
  say(t.id, 'reply', e.name, text.trim() || '(no reply)', activity, stamp);
  setTask(t.id, { result: text.trim() });
  const now = task(t.id);
  if (now.kind === 'chat') return setTask(t.id, { status: now.next_prompt ? 'queued' : 'idle' });
  if (one(`SELECT count(*) AS n FROM tasks WHERE parent_id = ? AND reported = 0 AND status != 'done'`, t.id).n)
    return setTask(t.id, { status: 'waiting' }); // they handed parts out; their results bring this back
  if (now.next_prompt) return setTask(t.id, { status: 'queued' }); // you (or a finished subtask) sent something meanwhile
  if (ownerReads(now)) return setTask(t.id, { status: 'review' });
  markDone(now, false); // a teammate's subtask: the result goes straight back to whoever asked
}

// ---------- tasks and chats ----------
function createTask({ kind = 'task', employee_id = 0, title, description = '', project_id = null, parent_id = null, folder = null, schedule_id = null, created_by = 'me', attachments = [] }) {
  const prompt = kind === 'chat' ? description + filesNote(attachments) : [title, description].filter(Boolean).join('\n\n');
  const id = exec(`INSERT INTO tasks (kind, title, body, employee_id, project_id, parent_id, folder, schedule_id, created_by, status, next_prompt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, kind, title, description, employee_id || 0, project_id || null, parent_id || null,
    String(folder || '').trim() || null, schedule_id, created_by, employee_id ? 'queued' : 'todo', employee_id ? prompt : null).lastInsertRowid;
  if (kind === 'chat') say(id, 'me', 'me', description, '', { attachments });
  return id;
}
const shortTitle = (text) => { const first = text.split('\n')[0]; return first.length > 70 ? first.slice(0, 70).replace(/\s+\S*$/, '') + '…' : first; };

// Queue a message for the assignee's next turn; anything sent while they work waits until they finish.
function queueMessage(t, prompt) {
  exec(`UPDATE tasks SET next_prompt = COALESCE(next_prompt || char(10) || char(10), '') || ?,
    status = CASE WHEN status IN ('working', 'waiting') THEN status ELSE 'queued' END,
    updated_at = CURRENT_TIMESTAMP WHERE id = ?`, prompt, t.id);
}

function sendMessage(t, text, files = []) {
  say(t.id, 'me', 'me', text, '', { attachments: files });
  if (!t.employee_id) return; // unassigned: the note waits on the task for whoever takes it
  const said = text + filesNote(files);
  const prompt = t.kind === 'task' && !['me', 'schedule'].includes(t.created_by) ? `Message from the owner:\n${said}` : said;
  if (t.session_id || ['working', 'queued'].includes(t.status)) return queueMessage(t, prompt);
  // Claude never got going on this: send the whole thing so far.
  const history = all(`SELECT text, attachments FROM messages WHERE task_id = ? AND kind IN ('me', 'asker') ORDER BY id`, t.id).map((m) => m.text + filesNote(attachmentsOf(m)));
  setTask(t.id, { status: 'queued', next_prompt: (t.kind === 'task' ? [t.title, t.body, ...history] : history).filter(Boolean).join('\n\n') });
}

// When every open subtask of a task is done, its assignee gets the results and continues.
function deliverToParent(t) {
  const p = t.parent_id && task(t.parent_id);
  if (!p) return;
  const kids = all('SELECT * FROM tasks WHERE parent_id = ? AND reported = 0', p.id);
  if (kids.some((k) => k.status !== 'done')) return; // still waiting on another one
  exec('UPDATE tasks SET reported = 1 WHERE parent_id = ? AND reported = 0', p.id);
  for (const k of kids) say(p.id, 'teammate', k.employee_id ? nameOf(k.employee_id) : 'Subtask', `Finished #${k.id} "${k.title}":\n${k.result || '(no result)'}`, '',
    { ...(one(`SELECT model, effort FROM messages WHERE task_id = ? AND kind = 'reply' ORDER BY id DESC LIMIT 1`, k.id) ?? {}),
      files: [...new Set(all(`SELECT activity, files FROM messages WHERE task_id = ? AND kind IN ('reply', 'teammate')`, k.id).flatMap((m) => messageFiles(m, cwdOf(k)).map((f) => f.path)))] });
  if (p.status === 'done' || !p.employee_id) return; // closed, or nobody assigned to continue
  const results = kids.map((k) => `${p.kind === 'chat' ? 'Task' : 'Subtask'} #${k.id} "${k.title}" is done (${k.employee_id ? nameOf(k.employee_id) : 'unassigned'}):\n${k.result || '(no result)'}`).join('\n\n');
  queueMessage(p, p.kind === 'chat' ? `Work you handed out from this chat is done.\n\n${results}\n\nCheck the results, then tell the owner what was done and anything that needs them.`
    : `${results}\n\nContinue your task.`);
  if (p.status === 'waiting') setTask(p.id, { status: 'queued' });
}

function markDone(t, reflectToo = true) {
  setTask(t.id, { status: 'done' });
  if (reflectToo) reflect(t);
  deliverToParent(t);
}

function stop(t) {
  if (running.has(t.id)) { stopping.add(t.id); running.get(t.id).kill('SIGTERM'); }
  else setTask(t.id, { status: 'stopped' });
}

const NOTES_PROMPT = (notes, p, memory) => `This task is now finished. Look back at this conversation and pick out what is worth remembering for FUTURE work: the owner's preferences and corrections, facts, decisions, lessons learned. Skip anything that only matters for this one task, and anything already written down below.

Reply with ONLY short bullet lines starting with "- " (at most 5 in total).${p ? `
Put points about the ${p.name} project (its goals, decisions, facts, where things are) after a line that says exactly PROJECT: and points about the owner or your own way of working before that line.` : ''}
If there is nothing new worth keeping, reply with exactly: NOTHING

Your notes so far:
${notes.trim() || '(empty)'}${p ? `\n\nProject memory so far:\n${memory.trim() || '(empty)'}` : ''}`;

// After you mark a task done, its assignee adds what's worth remembering to their notes and the project memory.
function reflect(t) {
  const e = employee(t.employee_id);
  if (!e || !t.session_id || t.kind !== 'task' || reflecting.has(t.id)) return;
  const p = permsOf(e).project_memory && t.project_id && project(t.project_id); // no project notes without permission
  const prompt = NOTES_PROMPT(readFile(notesFile(e.name)), p, p ? readFile(memoryFile(p.name)) : '');
  const child = claude(e, expand(t.folder || p?.folder || e.folder), ['--resume', t.session_id, '--permission-mode', 'dontAsk'], prompt, modelFor(t, e), 'low'); // a short summary needs little thinking
  reflecting.set(t.id, child);
  let final = null;
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    try { const m = JSON.parse(line); if (m.type === 'result') final = m; } catch {}
  });
  const end = () => {
    if (!reflecting.delete(t.id)) return;
    if (final) exec('UPDATE tasks SET cost = cost + ? WHERE id = ?', final.total_cost_usd || 0, t.id);
    const { mine, project: shared } = final && !final.is_error ? splitNotes(final.result || '') : { mine: [], project: [] };
    if (mine.length) {
      addNotes(notesFile(e.name), NOTES_HEAD(e.name), t.title, mine);
      say(t.id, 'memory', e.name, `${e.name} added ${mine.length === 1 ? '1 thing' : mine.length + ' things'} to their notes`, mine.join('\n'));
    }
    if (shared.length && p) {
      addNotes(memoryFile(p.name), MEMORY_HEAD(p.name), `${t.title} (${e.name})`, shared);
      say(t.id, 'memory', e.name, `${e.name} added ${shared.length === 1 ? '1 thing' : shared.length + ' things'} to the ${p.name} project memory`, shared.join('\n'));
    }
    pump();
  };
  child.on('close', end);
  child.on('error', end);
}

// ---------- schedules ----------
const EVERY = ['daily', 'weekdays', 'weekly', 'monthly'];

// Start one run of a schedule as a new task. Returns the task id, or an error message.
function startSchedule(s) {
  const prev = s.last_task_id && task(s.last_task_id);
  if (prev && ['queued', 'working'].includes(prev.status)) return `${nameOf(s.employee_id)} is still on the last one.`;
  const id = createTask({ employee_id: s.employee_id, description: s.message, folder: s.folder, schedule_id: s.id, project_id: s.project_id,
    created_by: 'schedule', title: `${s.title} · ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` });
  say(id, 'note', 'schedule', `Started by your schedule "${s.title}"`);
  exec('UPDATE schedules SET last_task_id = ? WHERE id = ?', id, s.id);
  return id;
}

// Runs every 30 seconds. A run missed while the Mac was off or asleep happens once, now.
function runSchedules(now = new Date()) {
  for (const s of all('SELECT * FROM schedules WHERE paused = 0 AND next_run <= ?', now.toISOString())) {
    startSchedule(s);
    exec('UPDATE schedules SET next_run = ? WHERE id = ?', nextRun(s, now).toISOString(), s.id);
  }
  pump();
}

function saveSchedule(b, id) {
  const message = String(b.message || '').trim();
  const s = {
    title: String(b.title || '').trim() || message.split('\n')[0].slice(0, 60), message, employee_id: Number(b.employee_id),
    project_id: Number(b.project_id) || null, folder: String(b.folder || '').trim() || null, every: b.every,
    day: b.day === '' || b.day == null ? null : Number(b.day), at: String(b.at || ''), paused: b.paused ? 1 : 0,
  };
  if (!message) throw new Error('Write the message they get each time.');
  if (!employee(s.employee_id)) throw new Error('Pick who should do it.');
  if (s.project_id && !project(s.project_id)) throw new Error('That project no longer exists.');
  notArchived(employee(s.employee_id), s.project_id && project(s.project_id));
  if (!EVERY.includes(s.every)) throw new Error('Pick how often.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.at)) throw new Error('Pick a time.');
  if (s.every === 'weekly' && !(Number.isInteger(s.day) && s.day >= 0 && s.day <= 6)) throw new Error('Pick a day of the week.');
  if (s.every === 'monthly' && !(Number.isInteger(s.day) && s.day >= 1 && s.day <= 28)) throw new Error('Pick a day of the month (1 to 28).');
  if (!['weekly', 'monthly'].includes(s.every)) s.day = null;
  s.next_run = nextRun(s, new Date()).toISOString(); // saving or resuming never triggers a catch-up run
  const cols = Object.keys(s);
  if (id) exec(`UPDATE schedules SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...Object.values(s), id);
  else exec(`INSERT INTO schedules (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...Object.values(s));
}

// ---------- appearance ----------
// How Orbit looks. The page owns the theme names and colours; this only keeps the values sane.
const fontSpec = (x) => (typeof x === 'string' && /^[A-Za-z0-9 ]{1,50}(:wght@\d{3}(;\d{3}){0,8})?$/.test(x) ? x : '');
export function cleanAppearance(a = {}) {
  return {
    mode: ['system', 'light', 'dark'].includes(a.mode) ? a.mode : 'system',
    palette: typeof a.palette === 'string' && /^[a-z]{1,20}$/.test(a.palette) ? a.palette : 'claude', // (a missing value would test as the word "undefined")
    accent: typeof a.accent === 'string' && /^#[0-9a-f]{6}$/i.test(a.accent) ? a.accent.toLowerCase() : '', // '' = the theme's own accent
    background: typeof a.background === 'string' && /^[a-z]{1,20}$/.test(a.background) ? a.background : 'none', // 'custom' = your picture
    dim: Math.min(0.92, Math.max(0.3, Number(a.dim) || 0.7)), // how much the page colour covers the background
    v: Number(a.v) || 0, // changes when you upload a new picture, so the browser fetches it
    fontHeading: fontSpec(a.fontHeading), fontBody: fontSpec(a.fontBody), // '' = the built-in fonts
    myFonts: [...new Set([].concat(a.myFonts ?? []).map(fontSpec).filter(Boolean))].slice(0, 12), // fonts you've picked before
  };
}
const BG_DIR = path.join(DATA, 'appearance');

// ---------- fonts: search Google Fonts. The catalogue is fetched once a week and kept in your data folder. ----------
const FONTS_FILE = path.join(DATA, 'google-fonts.json');
let fontList = null;
async function googleFonts() {
  if (fontList) return fontList;
  const saved = () => JSON.parse(fs.readFileSync(FONTS_FILE, 'utf8'));
  try { if (Date.now() - fs.statSync(FONTS_FILE).mtimeMs < 7 * 864e5) return (fontList = saved()); } catch {}
  const r = await fetch('https://fonts.google.com/metadata/fonts', { signal: AbortSignal.timeout(20000) }).catch(() => null);
  if (!r?.ok) { try { return (fontList = saved()); } catch { throw new Error("Couldn't reach Google Fonts. Check your internet connection."); } }
  const meta = JSON.parse((await r.text()).replace(/^\)\]\}'\s*/, ''));
  fontList = meta.familyMetadataList.map((f) => ({ family: f.family, category: f.category, popularity: f.popularity,
    weights: Object.keys(f.fonts).filter((w) => /^\d+$/.test(w)).map(Number) }));
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(FONTS_FILE, JSON.stringify(fontList));
  return fontList;
}
// Best matches first (names that start with what you typed, then the most popular), with the weights to ask Google for.
export function searchFonts(list, q = '', cat = '') {
  q = String(q).trim().toLowerCase();
  return list.filter((f) => (!q || f.family.toLowerCase().includes(q)) && (!cat || f.category === cat))
    .sort((a, b) => (b.family.toLowerCase().startsWith(q) - a.family.toLowerCase().startsWith(q)) || a.popularity - b.popularity)
    .slice(0, 30).map((f) => {
      const pick = [400, 500, 600, 700].filter((w) => f.weights.includes(w)), w = pick.length ? pick : f.weights.slice(0, 1);
      return { family: f.family, category: f.category, spec: w.length === 1 && w[0] === 400 ? f.family : `${f.family}:wght@${w.join(';')}` };
    });
}

// ---------- profile pictures: Claude draws each one as an SVG, in the style you pick ----------
const AVATAR_DIR = path.join(DATA, 'avatars');
export const STYLES = { // key: [label, a few words for you, what Claude is asked for]
  pixel: ['Pixel art', '16-bit game look', 'Pixel art: a 32×32 grid of crisp square pixels (every shape is an 8×8 rect on the grid, shape-rendering="crispEdges"), a limited palette of about 12 colours, like a 16-bit game character portrait.'],
  anime: ['Anime', 'Big eyes, cel shading', 'Anime style: large expressive eyes with highlights, a small nose and mouth, clean dark outlines, two-tone cel shading and vivid stylised hair.'],
  cartoon: ['Cartoon', 'Bold and playful', 'Cartoon: bold rounded shapes, thick outlines, playful proportions and flat bright colours, like a modern animated series.'],
  realistic: ['Realistic', 'Painted portrait', 'As realistic as an illustration can be: natural proportions and skin tones, soft shading with linear and radial gradients, subtle highlights and shadows, a painted-portrait feel.'],
  flat: ['Flat', 'Clean app illustration', 'Flat minimal: simple geometric shapes, no outlines, a 4–5 colour palette, like a modern app illustration.'],
  clay: ['3D clay', 'Soft and rounded', '3D clay look: soft rounded forms, radial gradients for volume, soft shadows and pastel colours, like a claymation figure.'],
  line: ['Line art', 'Ink sketch', 'Line art: confident single-weight ink lines on a warm paper-coloured background with one accent colour, like an editorial sketch.'],
  robot: ['Robot', 'Their robot twin', 'A friendly robot version of them: a rounded metal head, glowing eyes, a small antenna and a detail that hints at their job, flat colours with soft shading.'],
};
// What comes back is shown as a picture, so it may only draw: no scripts, no links out, nothing loaded from elsewhere.
export function cleanSvg(text) {
  let svg = String(text ?? '').match(/<svg[\s\S]*<\/svg>/i)?.[0];
  if (!svg || svg.length > 300_000) return null;
  if (/<(script|foreignObject|iframe|image|a)\b|\son\w+\s*=|javascript:|@import|href\s*=(?!\s*["']?#)|url\((?!\s*["']?#)/i.test(svg)) return null;
  if (!/^<svg[^>]*\sxmlns=/i.test(svg)) svg = svg.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return svg;
}
const drawing = new Set(); // employee ids (or 'me') being drawn right now
function removeMyPicture() {
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
  for (const f of fs.readdirSync(AVATAR_DIR)) if (/^me\.(svg|png|jpg|webp)$/.test(f)) fs.rmSync(path.join(AVATAR_DIR, f));
}
function drawAvatar(e, style, details, model) {
  const prompt = [
    'Draw a square profile picture for a member of my team, as one SVG.', '',
    `Who: ${e.name}, ${e.title || 'a team member'}.`,
    `What they do: ${e.role.slice(0, 400)}`,
    e.personality ? `Personality: ${e.personality.slice(0, 300)}` : '',
    details ? `How they look (from me): ${details}` : 'Choose a look that suits their job and personality.',
    `Style: ${STYLES[style][2]}`, '',
    'Requirements:',
    '- <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">',
    '- A head-and-shoulders portrait, centred, facing the viewer, with a friendly expression.',
    '- Fill the whole square with a background that suits the style; it is shown cropped to a rounded square.',
    '- No text, letters or logos. No <image>, <script>, <foreignObject>, links, external files or fonts. Gradients and filters are fine (refer to them with url(#id)).',
    '- Keep it under 20 KB.', '',
    'Reply with only the SVG code: start with <svg and end with </svg>, nothing else.',
  ].filter((x) => x !== null).join('\n');
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
  const child = claude(e, AVATAR_DIR, ['--tools', ''], prompt, MODELS.includes(model) ? model : setting('default_model'), '');
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => child.kill(), 4 * 60 * 1000);
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => reject(new Error('Could not start Claude Code.')));
    child.on('close', () => {
      clearTimeout(timer);
      const result = out.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((x) => x?.type === 'result');
      if (result?.total_cost_usd) setSetting('picture_cost', String(Number(setting('picture_cost')) + result.total_cost_usd));
      const svg = !result?.is_error && cleanSvg(result?.result);
      svg ? resolve(svg) : reject(new Error(result?.is_error ? `Claude couldn't draw it: ${result.result || 'unknown error'}` : "That one didn't come out as a clean picture. Try again."));
    });
  });
}
const bgFile = () => { try { return fs.readdirSync(BG_DIR).find((f) => /^background\.(jpg|png|webp)$/.test(f)); } catch { return null; } };

// ---------- people and projects ----------
function saveEmployee(b, id) {
  const str = (k, max) => String(b[k] ?? '').trim().slice(0, max);
  const e = { name: str('name', 30), title: str('title', 60), role: str('role', 5000), personality: str('personality', 3000), rules: str('rules', 5000),
    reports_to: Number(b.reports_to) || null, model: b.model || 'default', effort: b.effort || 'default', access: b.access,
    perms: JSON.stringify(Object.fromEntries(Object.entries(PERMS).map(([k, v]) => [k, typeof b.perms?.[k] === 'boolean' ? b.perms[k] : v.on]))),
    skills: Array.isArray(b.skills) ? JSON.stringify([...new Set(b.skills.map(String))].filter((x) => findSkills().some((k) => k.id === x))) : id ? employee(id).skills : '[]' };
  if (!/^[\w-]{1,30}$/.test(e.name)) throw new Error('Name must be one word: letters, numbers, - or _.');
  if (!e.role) throw new Error('Write their job description.');
  if (!['default', ...MODELS].includes(e.model)) throw new Error('Pick a model.');
  if (!['default', ...EFFORTS].includes(e.effort)) throw new Error('Pick an effort level.');
  if (!ACCESS[e.access]) throw new Error('Pick their file access.');
  const boss = e.reports_to && employee(e.reports_to);
  if (e.reports_to && !boss) throw new Error('That boss is no longer on the team.');
  if (boss && id && isUnder(boss, employee(id))) throw new Error(`${boss.name} can't be their boss: ${boss.name} is under them.`);
  e.folder = str('folder', 500) || path.join(DATA, 'workspace', e.name.toLowerCase());
  const cols = Object.keys(e);
  try {
    if (!id) return { id: exec(`INSERT INTO employees (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...Object.values(e)).lastInsertRowid };
    const before = employee(id);
    exec(`UPDATE employees SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...Object.values(e), id);
    const [from, to] = [notesFile(before.name), notesFile(e.name)];
    if (from !== to && fs.existsSync(from) && !fs.existsSync(to)) fs.renameSync(from, to);
    if (typeof b.notes === 'string' && b.notes !== readFile(notesFile(e.name))) writeFile(notesFile(e.name), b.notes);
    if (b.allow) { const kept = allowOf({ allow: JSON.stringify(b.allow) }), had = allowOf(before);
      exec('UPDATE employees SET allow = ? WHERE id = ?', JSON.stringify({ rules: had.rules.filter((r) => kept.rules.includes(r)), dirs: had.dirs.filter((d) => kept.dirs.includes(d)) }), id); }
    return { id };
  } catch (err) {
    throw new Error(String(err.message).includes('UNIQUE') ? `You already have someone called ${e.name}.` : err.message);
  }
}

async function saveProject(b, id) {
  const name = String(b.name || '').trim(), description = String(b.description || '').trim();
  if (!name || name.length > 60) throw new Error('Give the project a name (up to 60 characters).');
  const folder = await checkFolder(b.folder);
  try {
    if (id) {
      const before = project(id);
      exec('UPDATE projects SET name = ?, description = ?, folder = ? WHERE id = ?', name, description, folder, id);
      const [from, to] = [memoryFile(before.name), memoryFile(name)];
      if (from !== to && fs.existsSync(from) && !fs.existsSync(to)) fs.renameSync(from, to);
      return { id };
    }
    return { id: exec('INSERT INTO projects (name, description, folder) VALUES (?, ?, ?)', name, description, folder).lastInsertRowid };
  } catch (err) {
    throw new Error(String(err.message).includes('UNIQUE') ? `You already have a project called ${name}.` : err.message);
  }
}

// ---------- HTTP ----------
const OPEN = "('queued','working','waiting')";
const routes = {
  'GET /api/state': () => ({
    settings: { default_model: setting('default_model'), default_effort: setting('default_effort'), owner_name: setting('owner_name'), owner_avatar: setting('owner_avatar'),
      main_assistant: Number(setting('main_assistant')) || null, picture_cost: Number(setting('picture_cost')) || 0, appearance: cleanAppearance(JSON.parse(setting('appearance') || '{}')) },
    perms: PERMS,
    styles: Object.fromEntries(Object.entries(STYLES).map(([k, [label, blurb]]) => [k, { label, blurb }])),
    employees: all('SELECT * FROM employees ORDER BY name').map((e) => ({ ...e, perms: permsOf(e), allow: allowOf(e), skills: skillsOf(e) })),
    approvals: [...approvals.values()].map(({ resolve, ...ap }) => ap),
    projects: all('SELECT * FROM projects ORDER BY name'),
    schedules: all('SELECT * FROM schedules ORDER BY paused, next_run'),
    tasks: all(`SELECT id, kind, title, employee_id, project_id, parent_id, created_by, schedule_id, model, effort, status, cost, created_at, updated_at, archived_at,
      (SELECT substr(text, 1, 160) FROM messages m WHERE m.task_id = tasks.id AND m.kind NOT IN ('note', 'memory') ORDER BY m.id DESC LIMIT 1) AS last,
      (SELECT m.questions IS NOT NULL FROM messages m WHERE m.task_id = tasks.id AND m.kind NOT IN ('note', 'memory') ORDER BY m.id DESC LIMIT 1) AS asking
      FROM tasks ORDER BY updated_at DESC LIMIT 500`),
  }),
  'GET /api/tasks/:id': (t) => ({
    ...t,
    messages: all('SELECT * FROM messages WHERE task_id = ? ORDER BY id', t.id).map((m) => ({ ...m, deliverables: deliverablesOf(m, t), questions: m.questions ? JSON.parse(m.questions) : null, attachments: attachmentsOf(m) })),
    children: all('SELECT id, title, status, employee_id FROM tasks WHERE parent_id = ? ORDER BY id', t.id),
    parent: t.parent_id ? one('SELECT id, title, status FROM tasks WHERE id = ?', t.parent_id) : null,
  }),
  'POST /api/chats': (_, b) => {
    if (!employee(b.employee_id)) throw new Error('Pick who to talk to.');
    if (b.project_id && !project(b.project_id)) throw new Error('That project no longer exists.');
    notArchived(employee(b.employee_id), project(b.project_id));
    const files = cleanAttachments(b.attachments, expand(String(b.folder || '').trim() || project(b.project_id)?.folder || employee(b.employee_id).folder));
    const message = String(b.message || '').trim() || (files.length ? 'Please look at the files I attached.' : '');
    if (!message) throw new Error('Write your first message.');
    if (b.model && !MODELS.includes(b.model)) throw new Error('Pick a model.');
    if (b.effort && !EFFORTS.includes(b.effort)) throw new Error('Pick an effort level.');
    const id = createTask({ kind: 'chat', employee_id: Number(b.employee_id), title: String(b.title || '').trim() || shortTitle(message),
      description: message, project_id: Number(b.project_id) || null, folder: b.folder, attachments: files });
    if (b.model) setTask(id, { model: b.model });
    if (b.effort) setTask(id, { effort: b.effort });
    return { id };
  },
  'POST /api/tasks': (_, b) => {
    const title = String(b.title || '').trim();
    if (!title) throw new Error('Give the task a title.');
    if (Number(b.employee_id) && !employee(b.employee_id)) throw new Error('That person is no longer on the team.');
    if (b.project_id && !project(b.project_id)) throw new Error('That project no longer exists.');
    notArchived(Number(b.employee_id) && employee(b.employee_id), b.project_id && project(b.project_id));
    const parent = b.parent_id ? task(b.parent_id) : null;
    if (b.parent_id && parent?.kind !== 'task') throw new Error('That parent task no longer exists.');
    return { id: createTask({ title, description: String(b.description || '').trim(), employee_id: Number(b.employee_id) || 0,
      project_id: Number(b.project_id) || parent?.project_id || null, parent_id: parent?.id ?? null, folder: b.folder }) };
  },
  // Edit a task: rename, move to a project, or (re)assign it, which starts it.
  'PUT /api/tasks/:id': (t, b) => {
    const title = String(b.title ?? t.title).trim(), description = String(b.description ?? t.body).trim();
    const employee_id = b.employee_id === undefined ? t.employee_id : Number(b.employee_id) || 0;
    const project_id = b.project_id === undefined ? t.project_id : Number(b.project_id) || null;
    if (!title) throw new Error('Give it a title.');
    if (employee_id && !employee(employee_id)) throw new Error('That person is no longer on the team.');
    if (project_id && !project(project_id)) throw new Error('That project no longer exists.');
    notArchived(employee_id !== t.employee_id && employee(employee_id), project_id !== t.project_id && project(project_id));
    if (employee_id !== t.employee_id && t.status === 'working') throw new Error('Stop it before giving it to someone else.');
    if (b.model && !MODELS.includes(b.model)) throw new Error('Pick a model.');
    if (b.effort && !EFFORTS.includes(b.effort)) throw new Error('Pick an effort level.');
    setTask(t.id, { title, body: description, project_id, // the next turn uses a new model or effort
      model: b.model === undefined ? t.model : b.model || null, effort: b.effort === undefined ? t.effort : b.effort || null });
    if (employee_id === t.employee_id || t.kind === 'chat') return;
    if (!employee_id) return setTask(t.id, { employee_id: 0, status: 'todo', session_id: null, next_prompt: null });
    say(t.id, 'note', 'me', `Assigned to ${nameOf(employee_id)}`);
    const notes = all(`SELECT text FROM messages WHERE task_id = ? AND kind = 'me' ORDER BY id`, t.id).map((m) => m.text);
    // A new person starts fresh, with the task and your notes on it.
    setTask(t.id, { employee_id, session_id: null, status: t.status === 'done' ? 'done' : 'queued',
      next_prompt: [title, description, ...notes].filter(Boolean).join('\n\n') });
  },
  'POST /api/tasks/:id/messages': (t, b) => {
    const files = cleanAttachments(b.attachments, cwdOf(t)), text = String(b.text || '').trim();
    if (!text && !files.length) throw new Error('Write a message first.');
    notArchived(employee(t.employee_id));
    if (t.archived_at) archive('chat', t.id, false); // writing in an archived chat brings it back
    sendMessage(t, text || 'Please look at the files I attached.', files);
  },
  // Upload a file to attach. It's kept in your Orbit data (uploads/), never in a project folder.
  'POST /api/uploads': (_, b) => {
    const name = path.basename(String(b.name || 'file')).replace(/[^\w.\- ()]+/g, '_').slice(-120).replace(/^\.+/, '') || 'file';
    const buf = Buffer.from(String(b.data || ''), 'base64');
    if (!buf.length) throw new Error('That file is empty.');
    if (buf.length > 25e6) throw new Error('That file is too big (25 MB at most).');
    const dir = path.join(UPLOADS, crypto.randomBytes(5).toString('hex'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), buf);
    return { path: path.join(dir, name), name, size: buf.length };
  },
  // Files to point at: in a conversation's folder, or (for a new chat) the folder it would use.
  'GET /api/pointable': async (_, b) => {
    const t = Number(b.task) ? task(Number(b.task)) : null, e = employee(Number(b.employee)), p = project(Number(b.project));
    let root;
    try { root = t ? cwdOf(t) : await checkFolder(String(b.folder || '').trim() || p?.folder || e?.folder || ''); }
    catch { return { folder: '', files: [], note: 'There are no files to point at here yet.' }; }
    if (!fs.existsSync(root)) return { folder: root, files: [], note: 'This folder is empty so far.' };
    return { folder: root, files: rankFiles(await filesIn(root), root, b.q) };
  },
  'POST /api/tasks/:id/done': (t) => {
    if (t.kind === 'chat') throw new Error('Chats are never "done"; just start a new one.');
    if (['working', 'done'].includes(t.status)) throw new Error(t.status === 'done' ? 'Already done.' : 'Stop them first, or wait for their reply.');
    markDone(t);
  },
  'POST /api/tasks/:id/stop': (t) => {
    if (!['queued', 'working'].includes(t.status)) throw new Error('It is not running.');
    stop(t);
  },
  'GET /api/settings': () => ({ ...Object.fromEntries(Object.keys(SETTINGS).map((k) => [k, setting(k)])), code_dir: DIR, data_dir: DATA }),
  'PUT /api/settings': (_, b) => {
    if (b.default_model !== undefined && !MODELS.includes(b.default_model)) throw new Error('Pick a default model.');
    if (b.default_effort !== undefined && b.default_effort !== '' && !EFFORTS.includes(b.default_effort)) throw new Error('Pick a default effort.');
    if (b.default_model !== undefined) setSetting('default_model', b.default_model);
    if (b.default_effort !== undefined) setSetting('default_effort', b.default_effort);
    if (typeof b.owner_name === 'string') setSetting('owner_name', b.owner_name.trim().slice(0, 40));
    if (b.appearance !== undefined) setSetting('appearance', JSON.stringify(cleanAppearance(b.appearance)));
    if (b.main_assistant !== undefined) {
      if (b.main_assistant && !employee(Number(b.main_assistant))) throw new Error('That person is no longer on the team.');
      setSetting('main_assistant', b.main_assistant ? String(Number(b.main_assistant)) : '');
    }
    for (const k of ['global_rules', 'boss_rules']) if (typeof b[k] === 'string') setSetting(k, b[k].trim().slice(0, 10000));
  },
  'POST /api/employees': (_, b) => saveEmployee(b),
  'POST /api/employees/:id/sidebar': (_, b, id) => {
    if (!employee(id)) throw new Error('No such employee.');
    exec('UPDATE employees SET hidden = ? WHERE id = ?', b.hidden ? 1 : 0, id);
  },
  'GET /api/employees/:id/notes': (_, b, id) => ({ notes: employee(id) ? readFile(notesFile(employee(id).name)) : '' }),
  'PUT /api/employees/:id': (_, b, id) => { if (!employee(id)) throw new Error('No such employee.'); return saveEmployee(b, id); },
  'GET /api/skills': () => findSkills().map(({ dir, ...x }) => (x.mine ? { ...x, ...readSkillMd(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8')), name: x.name } : x)),
  'POST /api/skills': (_, b) => saveSkill(b),
  'POST /api/skills/remove': (_, b) => {
    const slug = skillSlug(b.slug), id = `orbit/${slug}`;
    if (!slug || !fs.existsSync(path.join(SKILLS_DIR, slug))) throw new Error('No such skill.');
    assignSkill(id, []);
    fs.rmSync(path.join(SKILLS_DIR, slug), { recursive: true, force: true });
  },
  'POST /api/skills/assign': (_, b) => assignSkill(String(b.id), b.employees),
  'POST /api/archive': (_, b) => archive(String(b.kind), Number(b.id), b.archived !== false),
  // The team chart's edit mode: a new boss (or none: straight under you). Never someone who works under them.
  'POST /api/employees/:id/boss': (_, b, id) => setBoss(id, b.reports_to),
  // Profile pictures: draw a new one (kept as a draft), use the draft, or go back to their initial.
  'POST /api/employees/:id/avatar': async (_, b, id) => {
    const e = employee(id);
    if (!e) throw new Error('No such employee.');
    if (!STYLES[b.style]) throw new Error('Pick a style.');
    if (drawing.has(id)) throw new Error(`Already drawing ${e.name}. Give it a moment.`);
    drawing.add(id);
    try {
      fs.writeFileSync(path.join(AVATAR_DIR, `draft-${id}.svg`), await drawAvatar(e, b.style, String(b.details ?? '').trim().slice(0, 300), b.model));
      return { draft: `/avatars/draft-${id}.svg?v=${Date.now()}` };
    } finally { drawing.delete(id); }
  },
  'PUT /api/employees/:id/avatar': (_, b, id) => {
    const draft = path.join(AVATAR_DIR, `draft-${id}.svg`);
    if (!employee(id) || !fs.existsSync(draft)) throw new Error('Nothing to use yet. Generate one first.');
    fs.renameSync(draft, path.join(AVATAR_DIR, `${id}.svg`));
    exec('UPDATE employees SET avatar = ? WHERE id = ?', String(Date.now()), id);
  },
  'DELETE /api/employees/:id/avatar': (_, b, id) => {
    fs.rmSync(path.join(AVATAR_DIR, `${id}.svg`), { force: true });
    exec("UPDATE employees SET avatar = '' WHERE id = ?", id);
  },
  'DELETE /api/employees/:id': (_, b, id) => {
    if (one(`SELECT 1 FROM tasks WHERE employee_id = ? AND status IN ${OPEN}`, id))
      throw new Error('They still have unfinished work. Stop or finish it first.');
    if (one('SELECT 1 FROM schedules WHERE employee_id = ?', id))
      throw new Error('They have scheduled tasks. Delete those or give them to someone else first.');
    exec('UPDATE employees SET reports_to = ? WHERE reports_to = ?', employee(id)?.reports_to ?? null, id); // their team moves up a level
    exec('DELETE FROM employees WHERE id = ?', id);
    for (const f of [`${id}.svg`, `draft-${id}.svg`]) fs.rmSync(path.join(AVATAR_DIR, f), { force: true });
    if (Number(setting('main_assistant')) === id) setSetting('main_assistant', '');
  },
  'GET /api/folders': (_, b) => listFolder(b.path),
  // "New folder" in the picker: you asked for it, so this is the one place Orbit makes a folder.
  // Make macOS ask: a quick look inside the folder, from Orbit itself, so macOS shows its "Allow access?" window.
  // It runs as a separate little process, so if no window ever comes, it's simply stopped and Orbit never hangs.
  'POST /api/folders/ask': async (_, b) => {
    const name = String(b.name ?? '');
    if (!ASKABLE.includes(name)) throw new Error('Orbit can ask for Desktop, Documents or Downloads.');
    if (askingMac) throw new Error('macOS is already asking about a folder. Answer that window first.');
    askingMac = true;
    try {
      const out = await new Promise((res) => {
        const c = spawn('/bin/ls', [path.join(os.homedir(), name)], { stdio: ['ignore', 'ignore', 'pipe'] });
        let err = '';
        c.stderr.on('data', (d) => (err += d));
        const timer = setTimeout(() => { c.kill(); res('timeout'); }, 90_000);
        c.on('error', () => { clearTimeout(timer); res('error'); });
        c.on('close', (code) => { clearTimeout(timer); res(code === 0 ? 'ok' : /not permitted/i.test(err) ? 'denied' : 'error'); });
      });
      if (out === 'ok') { setSetting('mac_folders', JSON.stringify([...new Set([...macAllowed(), name])])); return { ok: true }; }
      const fix = `You can switch it on in System Settings → Privacy & Security → Files and Folders → node → ${name}.`;
      return { ok: false, message: out === 'denied' ? `macOS said no to ${name}. ${fix}` : out === 'timeout' ? `macOS didn't show its window in time. ${fix}` : `Orbit couldn't open ${name}. ${fix}` };
    } finally { askingMac = false; }
  },
  'POST /api/folders': async (_, b) => {
    const parent = (await listFolder(b.path)).path, name = String(b.name ?? '').trim();
    if (!name || /[/:]/.test(name) || name === '.' || name === '..' || name.length > 100) throw new Error('Give the new folder a simple name, without slashes.');
    const full = path.join(parent, name);
    if (fs.existsSync(full)) throw new Error(`There's already something called "${name}" here.`);
    fs.mkdirSync(full);
    return { path: full };
  },
  'POST /api/approvals/:id': (_, b, id) => decide(id, Boolean(b.allow), Boolean(b.always)),
  // Your background picture (already resized by the page) lives with your data.
  'POST /api/background': (_, b) => {
    const m = String(b.image ?? '').match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!m) throw new Error('That isn\'t a picture Orbit can use. Try a JPG, PNG or WebP.');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 3e6) throw new Error('That picture is too big, even after resizing. Try a smaller one.');
    fs.mkdirSync(BG_DIR, { recursive: true });
    if (bgFile()) fs.rmSync(path.join(BG_DIR, bgFile()));
    fs.writeFileSync(path.join(BG_DIR, `background.${m[1] === 'jpeg' ? 'jpg' : m[1]}`), buf);
    return { v: Date.now() };
  },
  'GET /api/fonts': async (_, b) => searchFonts(await googleFonts(), b.q, b.cat),
  // Your own picture: a photo (resized in the browser), or one Claude draws like the team's.
  'POST /api/me/photo': (_, b) => {
    const m = String(b.image ?? '').match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!m) throw new Error("That isn't a picture Orbit can use. Try a JPG, PNG or WebP.");
    const buf = Buffer.from(m[2], 'base64'), ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    if (buf.length > 3e6) throw new Error('That picture is too big. Try a smaller one.');
    removeMyPicture();
    fs.writeFileSync(path.join(AVATAR_DIR, `me.${ext}`), buf);
    setSetting('owner_avatar', `${ext}:${Date.now()}`);
  },
  'POST /api/me/avatar': async (_, b) => {
    if (!STYLES[b.style]) throw new Error('Pick a style.');
    if (drawing.has('me')) throw new Error('Already drawing your picture. Give it a moment.');
    drawing.add('me');
    const me = { name: setting('owner_name') || 'the owner', title: 'the owner, who the whole team works for', role: 'Runs the team and decides what gets done.', personality: '', perms: '{}' };
    try {
      fs.writeFileSync(path.join(AVATAR_DIR, 'draft-me.svg'), await drawAvatar(me, b.style, String(b.details ?? '').trim().slice(0, 300), b.model));
      return { draft: `/avatars/draft-me.svg?v=${Date.now()}` };
    } finally { drawing.delete('me'); }
  },
  'PUT /api/me/avatar': () => {
    const draft = path.join(AVATAR_DIR, 'draft-me.svg');
    if (!fs.existsSync(draft)) throw new Error('Nothing to use yet. Generate one first.');
    removeMyPicture();
    fs.renameSync(draft, path.join(AVATAR_DIR, 'me.svg'));
    setSetting('owner_avatar', `svg:${Date.now()}`);
  },
  'DELETE /api/me/avatar': () => { removeMyPicture(); setSetting('owner_avatar', ''); },
  'DELETE /api/background': () => { if (bgFile()) fs.rmSync(path.join(BG_DIR, bgFile())); },
  'POST /api/data/open': () => openOnComputer(DATA, false), // show your data folder
  'POST /api/files': (_, b) => {
    const t = task(Number(b.task_id)), file = path.resolve(String(b.path ?? ''));
    if (!t || !fileAllowed(t, file) || !fs.existsSync(file)) throw new Error('Orbit can only open files your team made in this conversation, or files in its folder.');
    openOnComputer(file, b.action === 'reveal');
  },
  'POST /api/projects': (_, b) => saveProject(b),
  'GET /api/projects/:id/memory': (_, b, id) => ({ memory: project(id) ? readFile(memoryFile(project(id).name)) : '' }),
  'PUT /api/projects/:id': (_, b, id) => { if (!project(id)) throw new Error('No such project.'); return saveProject(b, id); },
  'DELETE /api/projects/:id': (_, b, id) => {
    if (one(`SELECT 1 FROM tasks WHERE project_id = ? AND status IN ${OPEN}`, id)) throw new Error('It still has work going on. Stop or finish it first.');
    if (one('SELECT 1 FROM schedules WHERE project_id = ?', id)) throw new Error('It has schedules. Delete those first.');
    exec('UPDATE tasks SET project_id = NULL WHERE project_id = ?', id); // its tasks stay, and so does its memory file
    exec('DELETE FROM projects WHERE id = ?', id);
  },
  'POST /api/schedules': (_, b) => saveSchedule(b),
  'PUT /api/schedules/:id': (_, b, id) => { if (!schedule(id)) throw new Error('No such schedule.'); saveSchedule(b, id); },
  'DELETE /api/schedules/:id': (_, b, id) => { exec('DELETE FROM schedules WHERE id = ?', id); },
  'POST /api/schedules/:id/run': (_, b, id) => {
    const s = schedule(id);
    if (!s) throw new Error('No such schedule.');
    const out = startSchedule(s);
    if (typeof out === 'string') throw new Error(out);
    return { id: out };
  },
};

if (import.meta.main) http.createServer(async (req, res) => {
  const send = (code, data, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type });
    res.end(type === 'application/json' ? JSON.stringify(data ?? { ok: true }) : data);
  };
  // This server can run commands on your Mac, so only accept requests from its own page (and its own employees' tools).
  if (!HOSTS.includes(req.headers.host)) return send(403, { error: 'Forbidden host' });
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/mcp') return serveTools(req, res);
  if (req.method !== 'GET' && !String(req.headers['content-type']).startsWith('application/json'))
    return send(415, { error: 'JSON only' });
  if (req.method === 'GET' && url.pathname === '/') return send(200, fs.readFileSync(path.join(DIR, 'index.html')), 'text/html');
  // Installable app: the manifest, icons, offline page and its service worker live with the code, in brand/.
  const APP_FILES = { '/manifest.webmanifest': 'manifest.webmanifest', '/sw.js': 'sw.js', '/offline.html': 'offline.html' };
  if (req.method === 'GET' && (APP_FILES[url.pathname] || /^\/icons\/[\w-]+\.(png|svg)$/.test(url.pathname))) {
    const f = path.join(DIR, 'brand', APP_FILES[url.pathname] ?? path.join('icons', path.basename(url.pathname)));
    if (!fs.existsSync(f)) return send(404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': { webmanifest: 'application/manifest+json', png: 'image/png', svg: 'image/svg+xml', js: 'text/javascript', html: 'text/html' }[f.split('.').pop()], 'Cache-Control': 'no-cache' });
    return res.end(fs.readFileSync(f));
  }
  // A file to preview: /files/<task>/<full path>, so a web page's own styles and scripts load next to it.
  if (req.method === 'GET' && url.pathname.startsWith('/files/')) {
    const [, , id, ...rest] = url.pathname.split('/'), file = path.resolve((WIN ? '' : '/') + rest.map(decodeURIComponent).join('/')), t = task(Number(id));
    let st;
    try { st = fs.statSync(file); } catch {}
    if (!t || !st?.isFile() || !fileAllowed(t, file)) return send(404, { error: 'Not found' });
    if (st.size > 15e6) return send(413, { error: 'Too big to preview; use Open.' });
    // Previewed pages run in a sealed box: they can't reach Orbit or act as you.
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).slice(1).toLowerCase()] ?? 'text/plain; charset=utf-8',
      'Content-Security-Policy': 'sandbox allow-scripts', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
    return res.end(fs.readFileSync(file));
  }
  if (req.method === 'GET' && /^\/avatars\/(draft-)?(\d+|me)\.(svg|png|jpg|webp)$/.test(url.pathname)) {
    const f = path.join(AVATAR_DIR, path.basename(url.pathname));
    if (!fs.existsSync(f)) return send(404, { error: 'No picture' });
    res.writeHead(200, { 'Content-Type': { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[f.split('.').pop()],
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
    return res.end(fs.readFileSync(f));
  }
  // "Download a backup": your whole data folder as one file (made fresh each time, then removed).
  if (req.method === 'GET' && url.pathname === '/api/backup') {
    const file = path.join(os.tmpdir(), `orbit-backup-${crypto.randomBytes(4).toString('hex')}.tar.gz`);
    try { await makeBackup(DATA, file); } catch (err) { fs.rmSync(file, { force: true }); return send(500, { error: `Couldn't make the backup: ${err.message}` }); }
    res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Length': fs.statSync(file).size,
      'Content-Disposition': `attachment; filename="Orbit backup ${new Date().toISOString().slice(0, 10)}.tar.gz"` });
    return fs.createReadStream(file).on('close', () => fs.rmSync(file, { force: true })).pipe(res);
  }
  if (req.method === 'GET' && url.pathname === '/background') {
    const f = bgFile();
    if (!f) return send(404, { error: 'No background picture' });
    res.writeHead(200, { 'Content-Type': { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[f.split('.').pop()], 'Cache-Control': 'no-cache' });
    return res.end(fs.readFileSync(path.join(BG_DIR, f)));
  }

  const id = Number(url.pathname.match(/\/(\d+)(\/|$)/)?.[1]);
  const handler = routes[`${req.method} ${url.pathname.replace(/\/\d+(?=\/|$)/, '/:id')}`];
  if (!handler) return send(404, { error: 'Not found' });
  try {
    let raw = '';
    const limit = url.pathname === '/api/uploads' ? 36e6 : 5e6; // uploads up to 25 MB (sent as base64); everything else is small
    for await (const chunk of req) if ((raw += chunk).length > limit) throw new Error('Too large.');
    const body = raw ? JSON.parse(raw) : Object.fromEntries(url.searchParams); // GET details come in the address
    const t = url.pathname.startsWith('/api/tasks/') ? task(id) : null;
    if (url.pathname.startsWith('/api/tasks/') && !t) return send(404, { error: 'No such task.' });
    const out = await handler(t, body, id);
    if (req.method !== 'GET') pump();
    send(200, out);
  } catch (err) {
    send(400, { error: err.message });
  }
}).listen(PORT, '127.0.0.1', () => {
  // Anything "working" when the app last closed was cut off.
  for (const t of all(`SELECT * FROM tasks WHERE status = 'working'`)) {
    say(t.id, 'note', nameOf(t.employee_id), 'Interrupted: the app was closed', t.log.trim());
    setTask(t.id, { status: 'stopped' });
  }
  runSchedules();
  setInterval(runSchedules, 30_000);
  // Closing the app stops everyone, so nothing keeps running (and using your plan) in the background.
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { for (const c of [...running.values(), ...reflecting.values()]) c.kill(); process.exit(); });
  console.log(`Orbit is running → http://localhost:${PORT}`);
});
