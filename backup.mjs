// Orbit's data tools: describe, back up and restore your data folder (team, chats, settings, files).
// The app uses these for "Download a backup"; the installers run them from the command line:
//   node backup.mjs info    <dataFolder>              what's in it, as JSON (or null)
//   node backup.mjs backup  <dataFolder> <file>       make a backup file (.tar.gz)
//   node backup.mjs inspect <file>                    what's in a backup file, as JSON (or null)
//   node backup.mjs restore <file> <dataFolder>       unpack a backup into an empty or new folder
//   node backup.mjs aside   <dataFolder>              move a data folder out of the way; prints where to
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

// tar comes with macOS, Linux and Windows 10+. On Windows use the system's own, not another one that may be on PATH.
const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
const LEAVE_OUT = new Set(['skillsets', 'briefs', 'google-fonts.json', 'server.log', 'crew.db', 'crew.db-wal', 'crew.db-shm', 'crew.db-journal']); // temporary, re-made, or copied separately
// What a backup can hold besides the database (team, chats, tasks, projects, settings), which always goes in.
export const PARTS = {
  memory: { label: 'Notes and project memory', what: 'What each person and each project has learned', dirs: ['notes', 'projects'] },
  pictures: { label: 'Profile pictures and background', what: "Your team's pictures, yours, and your background image", dirs: ['avatars', 'appearance'] },
  skills: { label: 'Skills you made or added', what: 'Made in Orbit, and added from GitHub', dirs: ['skills', 'skills-github'] },
  uploads: { label: 'Files you attached', what: 'Files you uploaded into chats', dirs: ['uploads'] },
  work: { label: "Your team's work folders", what: 'Files they made in their own folders. Project folders elsewhere are never included', dirs: ['workspace'] },
};
const partOf = (name) => Object.keys(PARTS).find((k) => PARTS[k].dirs.includes(name));
const sizeOf = (p) => { try { const st = fs.lstatSync(p); return st.isDirectory() ? fs.readdirSync(p).reduce((n, f) => n + sizeOf(path.join(p, f)), 0) : st.size; } catch { return 0; } };
export const partSizes = (dir) => ({ core: sizeOf(path.join(dir, 'crew.db')), ...Object.fromEntries(Object.entries(PARTS).map(([k, p]) => [k, p.dirs.reduce((n, d) => n + sizeOf(path.join(dir, d)), 0)])) });
const run = (args, opts = {}) => new Promise((ok, no) => {
  const c = spawn(TAR, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  let out = '', err = '';
  c.stdout.on('data', (d) => (out += d));
  c.stderr.on('data', (d) => (err += d));
  c.on('error', no);
  c.on('close', (code) => (code === 0 ? ok(out) : no(new Error(err.trim() || `tar failed (${code})`))));
});

// A short description: whose team, how many people and chats, when it was last used.
export function summary(dir) {
  const file = path.join(dir, 'crew.db');
  if (!fs.existsSync(file)) return null;
  const db = new DatabaseSync(file, { readOnly: true });
  const get = (sql, fallback) => { try { return Object.values(db.prepare(sql).get() ?? {})[0] ?? fallback; } catch { return fallback; } };
  try {
    return {
      owner: get("SELECT value FROM settings WHERE key = 'owner_name'", ''),
      people: get('SELECT count(*) FROM employees', 0),
      chats: get("SELECT count(*) FROM tasks WHERE kind = 'chat'", 0),
      tasks: get("SELECT count(*) FROM tasks WHERE kind = 'task'", 0),
      projects: get('SELECT count(*) FROM projects', 0),
      lastUsed: get('SELECT max(updated_at) FROM tasks', '') || '',
    };
  } finally { db.close(); }
}

// Back up a data folder into one file. Safe while Orbit is running: the database is copied as a consistent snapshot.
// parts: which of PARTS go in (all by default).
export async function makeBackup(dir, file, parts = Object.keys(PARTS)) {
  const keep = new Set(parts);
  dir = path.resolve(dir);
  if (!fs.existsSync(path.join(dir, 'crew.db'))) throw new Error(`There's no Orbit data in ${dir}.`);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-backup-'));
  try {
    for (const name of fs.readdirSync(dir)) {
      const part = partOf(name);
      if (!LEAVE_OUT.has(name) && (!part || keep.has(part))) await fs.promises.cp(path.join(dir, name), path.join(stage, name), { recursive: true, verbatimSymlinks: true });
    }
    const db = new DatabaseSync(path.join(dir, 'crew.db'));
    try { db.exec(`VACUUM INTO '${path.join(stage, 'crew.db').replaceAll("'", "''")}'`); } finally { db.close(); }
    const snap = new DatabaseSync(path.join(stage, 'crew.db')); // what was left out is forgotten too: no broken pictures or missing skills after a restore
    try {
      try { snap.exec("UPDATE settings SET value = json_remove(value, '$.grok.key') WHERE key = 'connectors' AND json_valid(value)"); } catch {} // your xAI key stays on this Mac
      if (!keep.has('pictures')) try { snap.exec("UPDATE employees SET avatar = ''; UPDATE settings SET value = '' WHERE key = 'owner_avatar';"); } catch {} // older data may lack these
      if (!keep.has('skills')) try {
        for (const e of snap.prepare('SELECT id, skills FROM employees').all()) {
          let list = [];
          try { list = JSON.parse(e.skills || '[]'); } catch {}
          snap.prepare('UPDATE employees SET skills = ? WHERE id = ?').run(JSON.stringify(list.filter((id) => !/^(orbit|github)\//.test(id))), e.id);
        }
      } catch {}
    } finally { snap.close(); }
    const about = { orbit: 1, created: new Date().toISOString(), from: dir, system: process.platform, parts: [...keep].filter((k) => PARTS[k]), ...summary(stage) };
    fs.writeFileSync(path.join(stage, 'orbit-backup.json'), JSON.stringify(about, null, 2));
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    await run(['-czf', path.resolve(file), '-C', stage, '.']);
    return about;
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}

// What's in a backup file, without unpacking it. null if it isn't an Orbit backup.
export async function inspect(file) {
  try { return JSON.parse(await run(['-xOzf', path.resolve(file), './orbit-backup.json'])); } catch { return null; }
}

// Unpack a backup into a data folder (which must be new or empty), and point stored paths at the new place.
export async function restore(file, dir) {
  const about = await inspect(file);
  if (!about) throw new Error(`${file} isn't an Orbit backup.`);
  dir = path.resolve(dir);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(`${dir} isn't empty. Move it aside first.`);
  fs.mkdirSync(dir, { recursive: true });
  await run(['-xzf', path.resolve(file), '-C', dir]);
  fs.rmSync(path.join(dir, 'orbit-backup.json'), { force: true });
  if (about.from && about.from !== dir) { // e.g. a different computer or user name: work folders moved with the data
    const db = new DatabaseSync(path.join(dir, 'crew.db'));
    const pairs = [[about.from, dir], [JSON.stringify(about.from).slice(1, -1), JSON.stringify(dir).slice(1, -1)]]; // plain, and as written inside JSON
    for (const [table, col] of [['employees', 'folder'], ['employees', 'allow'], ['tasks', 'folder'], ['schedules', 'folder'], ['messages', 'attachments'], ['messages', 'files']]) {
      for (const [from, to] of pairs) try { db.prepare(`UPDATE ${table} SET ${col} = replace(${col}, ?, ?) WHERE instr(${col}, ?) > 0`).run(from, to, from); } catch {}
    }
    db.close();
  }
  return about;
}

// Move a data folder out of the way (nothing is deleted): ~/.orbit -> ~/.orbit-old-2026-10-07 (or -2, -3, ...).
export function aside(dir) {
  dir = path.resolve(dir);
  let to = `${dir}-old-${new Date().toISOString().slice(0, 10)}`;
  for (let i = 2; fs.existsSync(to); i++) to = `${dir}-old-${new Date().toISOString().slice(0, 10)}-${i}`;
  fs.renameSync(dir, to);
  return to;
}

if (import.meta.main) {
  const [cmd, a, b] = process.argv.slice(2);
  try {
    if (cmd === 'info') console.log(JSON.stringify(summary(a)));
    else if (cmd === 'backup') console.log(JSON.stringify(await makeBackup(a, b)));
    else if (cmd === 'inspect') console.log(JSON.stringify(await inspect(a)));
    else if (cmd === 'restore') console.log(JSON.stringify(await restore(a, b)));
    else if (cmd === 'aside') console.log(aside(a));
    else { console.error('Use: node backup.mjs info|backup|inspect|restore|aside ...'); process.exit(2); }
  } catch (err) { console.error(err.message); process.exit(1); }
}
