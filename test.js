// Run: node --test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const MAC = process.platform === 'darwin';
const aFile = path.join(os.tmpdir(), 'orbit-test-a-file.txt'); // a plain file, wherever Orbit itself was downloaded
// Tests get a throwaway data folder, so they never touch your real data.
process.env.CREW_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-test-'));
process.env.CREW_CLAUDE_HOME = path.join(process.env.CREW_DATA, 'claude-home'); // a pretend ~/.claude, so tests never read yours
fs.writeFileSync(aFile, 'x');
after(() => { fs.rmSync(process.env.CREW_DATA, { recursive: true, force: true }); fs.rmSync(aFile, { force: true }); });
const { pickNotes, splitNotes, nextRun, permsOf, checkFolder, listFolder, bashPrefix, preApproved, describe, cleanAppearance, messageFiles, cleanSvg, STYLES, TOOLS, searchFonts, setBoss, cleanQuestions, cleanAttachments, rankFiles, archive, readSkillMd, saveSkill, findSkills, assignSkill, skillsOf } = await import('./server.js');

test('notes keep only bullet lines; NOTHING adds nothing', () => {
  assert.deepEqual(pickNotes('Here is what I learned:\n- Prefers British spelling\n* Likes short answers\nThanks!'),
    ['- Prefers British spelling', '- Likes short answers']);
  assert.deepEqual(pickNotes('NOTHING'), []);
});

test('notes split into the employee\'s own and the project\'s', () => {
  assert.deepEqual(splitNotes('- Boss likes tables\nPROJECT:\n- Site uses Next.js\n- Deadline is 1 Nov'),
    { mine: ['- Boss likes tables'], project: ['- Site uses Next.js', '- Deadline is 1 Nov'] });
  assert.deepEqual(splitNotes('**PROJECT:**\n- Only a project fact'), { mine: [], project: ['- Only a project fact'] });
  assert.deepEqual(splitNotes('- Only about me'), { mine: ['- Only about me'], project: [] });
});

test('schedules: next run time on the Mac clock', () => {
  const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi); // local time
  const mon10 = at(2026, 10, 5, 10, 0); // Monday 5 Oct 2026, 10:00
  assert.deepEqual(nextRun({ every: 'daily', at: '11:30' }, mon10), at(2026, 10, 5, 11, 30)); // later today
  assert.deepEqual(nextRun({ every: 'daily', at: '09:00' }, mon10), at(2026, 10, 6, 9, 0)); // already passed: tomorrow
  assert.deepEqual(nextRun({ every: 'daily', at: '10:00' }, mon10), at(2026, 10, 6, 10, 0)); // exactly now: next time
  assert.deepEqual(nextRun({ every: 'weekdays', at: '09:00' }, at(2026, 10, 9, 18, 0)), at(2026, 10, 12, 9, 0)); // skips the weekend
  assert.deepEqual(nextRun({ every: 'weekly', day: 1, at: '09:00' }, mon10), at(2026, 10, 12, 9, 0)); // next Monday
  assert.deepEqual(nextRun({ every: 'weekly', day: 3, at: '09:00' }, mon10), at(2026, 10, 7, 9, 0)); // this Wednesday
  assert.deepEqual(nextRun({ every: 'monthly', day: 5, at: '09:00' }, mon10), at(2026, 11, 5, 9, 0)); // passed: next month
  assert.deepEqual(nextRun({ every: 'monthly', day: 20, at: '09:00' }, mon10), at(2026, 10, 20, 9, 0));
  assert.deepEqual(nextRun({ every: 'monthly', day: 28, at: '09:00' }, at(2026, 12, 30, 9, 0)), at(2027, 1, 28, 9, 0)); // over new year
});

test('schedules: a missing weekly day can never hang the app', () => {
  assert.ok(nextRun({ every: 'weekly', day: null, at: '09:00' }, new Date(2026, 9, 5, 10, 0)) instanceof Date);
});

test('permissions: safe defaults, your choices win, junk is ignored', () => {
  const d = permsOf({ perms: '{}' });
  assert.equal(d.web, true); assert.equal(d.tasks, true); assert.equal(d.global_rules, false); assert.equal(d.team_rules, false);
  assert.equal(permsOf({ perms: '{"tasks":false,"global_rules":true}' }).tasks, false);
  assert.equal(permsOf({ perms: '{"tasks":false,"global_rules":true}' }).global_rules, true);
  assert.equal(permsOf({ perms: '{"web":"yes"}' }).web, true); // not a true/false value: default
  assert.equal(permsOf({ perms: 'not json' }).boss_rules, false);
});

test('project folders must exist, be folders, and avoid places macOS blocks', async () => {
  assert.equal(await checkFolder(os.tmpdir()), os.tmpdir()); // a real folder: accepted
  await assert.rejects(() => checkFolder(''), /Pick the project's folder/);
  await assert.rejects(() => checkFolder('~/no-such-folder-crew-test'), /doesn't exist/);
  await assert.rejects(() => checkFolder(aFile), /file, not a folder/);
  if (MAC) await assert.rejects(() => checkFolder('~/Documents'), /macOS/);
  if (MAC) await assert.rejects(() => checkFolder('~/Downloads/stuff'), /macOS/); // only macOS guards these
  if (MAC) await assert.rejects(() => checkFolder('~/Library/Containers'), /macOS/);
  await assert.rejects(() => checkFolder('my-project'), /full path/);
});

test('folder picker: lists folders, marks the ones macOS blocks, refuses to open them', async () => {
  const home = await listFolder('~');
  assert.equal(home.path, os.homedir());
  assert.ok(home.folders.every((f) => !f.name.startsWith('.')));
  const docs = home.folders.find((f) => f.name === 'Documents');
  if (docs) assert.equal(docs.locked, MAC);
  if (MAC) assert.equal(home.folders.find((f) => f.name === 'Library')?.locked ?? true, true);
  if (MAC) await assert.rejects(() => listFolder('~/Documents'), /macOS/);
  assert.equal(home.crumbs.at(-1).name, 'Home');
  assert.equal(home.crumbs[0].path, path.parse(os.homedir()).root);
  await assert.rejects(() => listFolder('~/no-such-folder-crew-test'), /doesn't exist/);
  await assert.rejects(() => listFolder(aFile), /file, not a folder/);
});

test('approvals: what "don\'t ask me again" covers', () => {
  assert.equal(bashPrefix('npm install express'), 'npm install');
  assert.equal(bashPrefix('ls -la'), 'ls');
  assert.equal(bashPrefix('git status'), 'git status');
  const ws = '/work/flux', reader = { name: 'Flux', access: 'read', allow: '{}' }, editor = { name: 'Flux', access: 'edit', allow: '{}' };
  // a read-only person writing inside their folder: asks; "always" means Can edit
  assert.equal(preApproved(reader, ws, 'Write', { file_path: '/work/flux/a.js' }), false);
  assert.equal(describe(reader, ws, 'Write', { file_path: '/work/flux/a.js', content: 'x' }).always.kind, 'access');
  // Can edit covers their folder, not elsewhere; "always" for elsewhere means that folder
  assert.equal(preApproved(editor, ws, 'Edit', { file_path: '/work/flux/a.js' }), true);
  assert.equal(preApproved(editor, ws, 'Edit', { file_path: '/work/other/a.js' }), false);
  assert.equal(describe(editor, ws, 'Edit', { file_path: '/work/other/a.js' }).always.dir, '/work/other');
  assert.equal(preApproved({ ...editor, allow: '{"dirs":["/work/other"]}' }, ws, 'Edit', { file_path: '/work/other/b/c.js' }), true);
  assert.equal(preApproved({ ...editor, allow: '{"dirs":["/work/other"]}' }, ws, 'Edit', { file_path: '/work/otherwise/c.js' }), false); // not a prefix trick
  // commands: by their first words
  const npm = { ...editor, allow: '{"rules":["Bash(npm install:*)"]}' };
  assert.equal(describe(editor, ws, 'Bash', { command: 'npm install express' }).always.rule, 'Bash(npm install:*)');
  assert.equal(preApproved(npm, ws, 'Bash', { command: 'npm install express' }), true);
  assert.equal(preApproved(npm, ws, 'Bash', { command: 'npm installer' }), false);
  assert.equal(preApproved(npm, ws, 'Bash', { command: 'npm publish' }), false);
});

test('appearance: only sane values are kept', () => {
  const plain = { fontHeading: '', fontBody: '', myFonts: [] };
  assert.deepEqual(cleanAppearance({}), { mode: 'system', palette: 'claude', accent: '', background: 'none', dim: 0.7, v: 0, ...plain });
  const a = cleanAppearance({ mode: 'dark', palette: 'forest', accent: '#AABBCC', background: 'custom', dim: 0.5, v: 7, fontHeading: 'Fraunces:wght@400;600', fontBody: 'Inter', myFonts: ['Inter', 'Inter', 'Lobster'] });
  assert.deepEqual(a, { mode: 'dark', palette: 'forest', accent: '#aabbcc', background: 'custom', dim: 0.5, v: 7, fontHeading: 'Fraunces:wght@400;600', fontBody: 'Inter', myFonts: ['Inter', 'Lobster'] });
  const bad = cleanAppearance({ mode: 'neon', palette: '<script>', accent: 'red; x', background: '../../etc', dim: 5, fontHeading: 'X"); } body { display:none', myFonts: 'Inter&family=evil' });
  assert.deepEqual(bad, { mode: 'system', palette: 'claude', accent: '', background: 'none', dim: 0.92, v: 0, ...plain });
});

test('deliverables: files a reply made, still on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-files-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>hi</h1>');
  fs.mkdirSync(path.join(dir, 'css'));
  fs.writeFileSync(path.join(dir, 'css', 'a.css'), 'x');
  const recorded = messageFiles({ files: JSON.stringify([path.join(dir, 'index.html'), path.join(dir, 'gone.txt')]) }, dir);
  assert.deepEqual(recorded.map((f) => f.name), ['index.html']); // deleted files drop out
  const older = messageFiles({ activity: 'Looking around\n→ Read notes.md\n→ Write index.html\n→ Edit css/a.css\n→ Write index.html' }, dir);
  assert.deepEqual(older.map((f) => f.name), ['index.html', 'a.css']); // from the activity log, once each
  assert.deepEqual(messageFiles({ activity: '→ Bash npm test' }, dir), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('approvals: Chrome actions are described plainly, and one "don\'t ask" covers all of Chrome', () => {
  const ava = { name: 'Ava', access: 'read', allow: '{}' };
  const nav = describe(ava, '/w', 'mcp__claude-in-chrome__navigate', { url: 'https://example.com' });
  assert.equal(nav.what, 'Open https://example.com in your Chrome');
  assert.equal(nav.always.rule, 'mcp__claude-in-chrome');
  assert.equal(describe(ava, '/w', 'mcp__claude-in-chrome__computer', { action: 'type', text: 'hello' }).what, 'Type "hello" on a page in your Chrome');
  assert.equal(preApproved(ava, '/w', 'mcp__claude-in-chrome__computer', { action: 'left_click' }), false);
  const trusted = { ...ava, allow: '{"rules":["mcp__claude-in-chrome"]}' };
  assert.equal(preApproved(trusted, '/w', 'mcp__claude-in-chrome__computer', { action: 'left_click' }), true);
  assert.equal(preApproved(trusted, '/w', 'Bash', { command: 'rm -rf x' }), false); // Chrome trust doesn't spill over
});

test('markdown: tables, lists, headings and code are formatted; their HTML stays text', () => {
  const page = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const esc = page.match(/^const esc = .*$/m)[0];
  const block = page.slice(page.indexOf('// ---------- markdown'), page.indexOf('// ---------- end markdown'));
  const md = new Function(`${esc}\n${block}\nreturn md;`)();
  const out = md([
    '## Files created', '',
    '| File | Lines |', '|---|---|', '| index.html | 212 |', '| app.js | 909 |', '',
    '**What I verified**', '- Write access works', '  - nested point', '- Uses `node --check`', '',
    '3. third', '4. fourth', '',
    '```', '<script>alert(1)</script>', 'line two', '```',
    '#12 is a task, not a heading. <img src=x onerror=alert(1)>',
  ].join('\n'));
  assert.match(out, /<h4>Files created<\/h4>/);
  assert.match(out, /<table><thead><tr><th>File<\/th><th>Lines<\/th><\/tr><\/thead><tbody><tr><td>index\.html<\/td><td>212<\/td><\/tr>/);
  assert.match(out, /<p><b>What I verified<\/b><\/p><ul><li>Write access works<ul><li>nested point<\/li><\/ul><\/li><li>Uses <code>node --check<\/code><\/li><\/ul>/);
  assert.match(out, /<ol start="3"><li>third<\/li><li>fourth<\/li><\/ol>/);
  assert.match(out, /<pre class="code">&lt;script&gt;alert\(1\)&lt;\/script&gt;\nline two<\/pre>/);
  assert.match(out, /<p>#12 is a task, not a heading\. &lt;img src=x onerror=alert\(1\)&gt;<\/p>/);
  assert.ok(!/<script|<img/.test(out), 'no real tags from their text');
  assert.ok(!out.replace(/<pre[\s\S]*?<\/pre>/g, '').includes('\n'), 'no raw newlines outside code blocks');
});

test('profile pictures: only drawings get through, never scripts or outside links', () => {
  const ok = '<svg viewBox="0 0 256 256"><defs><linearGradient id="g"/></defs><rect fill="url(#g)" width="256" height="256"/><use href="#g"/><use xlink:href=\'#g\'/></svg>';
  assert.equal(cleanSvg(`Here you go:\n${ok}\nEnjoy!`), ok.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'));
  for (const bad of ['<svg><script>alert(1)</script></svg>', '<svg onload="alert(1)"></svg>', '<svg><image href="https://x.com/a.png"/></svg>',
    '<svg><rect fill="url(https://x.com/a)"/></svg>', '<svg><a href="javascript:alert(1)"><rect/></a></svg>', '<svg><foreignObject/></svg>', 'no picture here'])
    assert.equal(cleanSvg(bad), null, bad);
  assert.ok(Object.keys(STYLES).includes('pixel') && Object.keys(STYLES).includes('anime') && Object.keys(STYLES).includes('realistic'));
});

test('hiring: straight under the owner when asked, never above the hirer', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(process.env.CREW_DATA, 'crew.db'));
  const add = (name, boss, perms) => Number(db.prepare("INSERT INTO employees (name, role, model, access, folder, perms, reports_to) VALUES (?, 'x', 'default', 'edit', ?, ?, ?)").run(name, path.join(process.env.CREW_DATA, name), JSON.stringify(perms), boss).lastInsertRowid);
  const chief = add('Chief', null, { hire: true }), peer = add('Peer', null, {}), helper = add('Helper', chief, {});
  const t1 = Number(db.prepare("INSERT INTO tasks (kind, title, employee_id, status) VALUES ('chat', 'hiring', ?, 'working')").run(chief).lastInsertRowid);
  const hire = TOOLS.find((x) => x.name === 'hire'), ctx = () => ({ employeeId: chief, taskId: t1 });
  const bossOf = (name) => db.prepare('SELECT reports_to FROM employees WHERE name = ?').get(name).reports_to;
  hire.run({ name: 'Ada', title: 'Researcher', job_description: 'You research.', reports_to: 'owner' }, ctx());
  assert.equal(bossOf('Ada'), null); // straight under you
  hire.run({ name: 'Bo', title: 'Analyst', job_description: 'You analyse.' }, ctx());
  assert.equal(bossOf('Bo'), chief); // default: under the hirer
  hire.run({ name: 'Cy', title: 'Aide', job_description: 'You help.', reports_to: 'Helper' }, ctx());
  assert.equal(bossOf('Cy'), helper);
  assert.throws(() => hire.run({ name: 'Di', title: 'X', job_description: 'x', reports_to: 'Peer' }, ctx()), /report to you, to someone under you, or to the owner/);
  db.close();
});

test('fonts: search finds the right Google Fonts and only asks for weights they have', () => {
  const list = [{ family: 'Inter', category: 'Sans Serif', popularity: 2, weights: [100, 400, 500, 600, 700, 900] },
    { family: 'Inter Tight', category: 'Sans Serif', popularity: 90, weights: [400, 700] }, { family: 'Lobster', category: 'Display', popularity: 50, weights: [400] },
    { family: 'Buda', category: 'Display', popularity: 900, weights: [300] }, { family: 'Splinter', category: 'Display', popularity: 5, weights: [400] }];
  assert.deepEqual(searchFonts(list, 'inter').map((f) => f.family), ['Inter', 'Inter Tight', 'Splinter']); // starts-with first, then popular
  assert.equal(searchFonts(list, 'inter')[0].spec, 'Inter:wght@400;500;600;700');
  assert.equal(searchFonts(list, 'lobster')[0].spec, 'Lobster'); // regular only
  assert.equal(searchFonts(list, 'buda')[0].spec, 'Buda:wght@300'); // no regular: its one weight
  assert.deepEqual(searchFonts(list, '', 'Display').map((f) => f.family), ['Splinter', 'Lobster', 'Buda']);
});

test('team chart: moving someone to a new boss, never under their own team', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(process.env.CREW_DATA, 'crew.db'));
  const add = (name, boss) => Number(db.prepare("INSERT INTO employees (name, role, model, access, folder, reports_to) VALUES (?, 'x', 'default', 'read', ?, ?)").run(name, path.join(process.env.CREW_DATA, name), boss).lastInsertRowid);
  const lead = add('Lead', null), mid = add('Mid', lead), low = add('Low', mid), solo = add('Solo', null);
  const bossOf = (id) => db.prepare('SELECT reports_to FROM employees WHERE id = ?').get(id).reports_to;
  setBoss(solo, mid); assert.equal(bossOf(solo), mid);
  setBoss(solo, null); assert.equal(bossOf(solo), null); // straight under you
  assert.throws(() => setBoss(lead, low), /Low can't be Lead's boss: Low works under Lead/); // no loops
  assert.throws(() => setBoss(mid, mid), /own boss/);
  assert.equal(bossOf(lead), null);
  db.close();
});

test('update_teammate: changes people under you, never yourself or anyone outside your team', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(process.env.CREW_DATA, 'crew.db'));
  const add = (name, boss, perms) => Number(db.prepare("INSERT INTO employees (name, role, model, access, folder, perms, reports_to) VALUES (?, 'x', 'default', 'read', ?, ?, ?)").run(name, path.join(process.env.CREW_DATA, name), JSON.stringify(perms), boss).lastInsertRowid);
  const ceo = add('Ceo', null, { hire: true }), pm = add('Pm', ceo, {}), dev = add('Dev', pm, {}), other = add('Other', null, {}), plain = add('Plain', null, {});
  const chat = (who) => Number(db.prepare("INSERT INTO tasks (kind, title, employee_id, status) VALUES ('chat', 'x', ?, 'working')").run(who).lastInsertRowid);
  const tool = TOOLS.find((x) => x.name === 'update_teammate'), as = (who) => ({ employeeId: who, taskId: chat(who) });
  const row = (id) => db.prepare('SELECT title, role, reports_to FROM employees WHERE id = ?').get(id);
  tool.run({ name: 'Pm', title: 'Head of Development' }, as(ceo));
  assert.equal(row(pm).title, 'Head of Development');
  tool.run({ name: 'Dev', reports_to: 'owner', job_description: 'You build things.' }, as(ceo)); // deeper down, and straight to the owner
  assert.equal(row(dev).reports_to, null); assert.equal(row(dev).role, 'You build things.');
  assert.throws(() => tool.run({ name: 'Ceo', title: 'King' }, as(ceo)), /own profile/);
  assert.throws(() => tool.run({ name: 'Other', title: 'X' }, as(ceo)), /doesn't work under you/);
  assert.throws(() => tool.run({ name: 'Pm', title: 'X' }, as(plain)), /aren't allowed/);
  assert.throws(() => tool.run({ name: 'Pm' }, as(ceo)), /Say what to change/);
  db.close();
});

test('ask_owner: tidy questions, only in replies that go to the owner', async () => {
  assert.deepEqual(cleanQuestions([{ question: ' Move them to Juno? ', options: ['Yes', { label: 'No', description: 'Keep them with Movis' }, ''] }]),
    [{ question: 'Move them to Juno?', multi: false, options: [{ label: 'Yes' }, { label: 'No', description: 'Keep them with Movis' }] }]);
  assert.throws(() => cleanQuestions([{ question: 'Only one way?', options: ['Yes'] }]), /at least two options/);
  assert.throws(() => cleanQuestions([]), /at least one question/);
  assert.equal(cleanQuestions(Array.from({ length: 9 }, (_, i) => ({ question: 'Q' + i, options: ['a', 'b'] }))).length, 4);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(process.env.CREW_DATA, 'crew.db'));
  const who = Number(db.prepare("INSERT INTO employees (name, role, model, access, folder) VALUES ('Asker', 'x', 'default', 'read', ?)").run(path.join(process.env.CREW_DATA, 'asker')).lastInsertRowid);
  const mk = (kind, parent, by) => Number(db.prepare("INSERT INTO tasks (kind, title, employee_id, status, parent_id, created_by) VALUES (?, 'x', ?, 'working', ?, ?)").run(kind, who, parent, by).lastInsertRowid);
  const chat = mk('chat', null, 'me'), sub = mk('task', chat, 'Movis');
  const tool = TOOLS.find((x) => x.name === 'ask_owner'), q = { questions: [{ question: 'Go?', options: ['Yes', 'No'] }] };
  assert.match(tool.run(q, { employeeId: who, taskId: chat }), /form under your reply/);
  assert.throws(() => tool.run(q, { employeeId: who, taskId: sub }), /Only replies that go to the owner/);
  db.close();
});

test('attachments: only uploads or files in the conversation folder; the best file matches first', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-work-')), up = path.join(process.env.CREW_DATA, 'uploads', 'abc');
  fs.mkdirSync(path.join(work, 'src'), { recursive: true }); fs.mkdirSync(up, { recursive: true });
  for (const f of ['src/app.js', 'src/app.test.js', 'index.html', 'README.md']) fs.writeFileSync(path.join(work, f), 'x');
  fs.writeFileSync(path.join(up, 'shot.png'), 'png');
  const got = cleanAttachments([path.join(work, 'index.html'), path.join(up, 'shot.png'), path.join(work, 'index.html')], work);
  assert.deepEqual(got.map((f) => [f.name, f.how]), [['index.html', 'file'], ['shot.png', 'upload']]); // no duplicates
  assert.throws(() => cleanAttachments(['/etc/passwd'], work), /upload, or files in this conversation's folder/);
  assert.throws(() => cleanAttachments([path.join(work, 'gone.txt')], work), /isn't there any more/);
  const files = ['src/app.js', 'src/app.test.js', 'index.html', 'README.md'].map((f) => path.join(work, f));
  assert.deepEqual(rankFiles(files, work, 'app').map((f) => f.rel), ['src/app.js', 'src/app.test.js']);
  assert.deepEqual(rankFiles(files, work, 'src').map((f) => f.rel), ['src/app.js', 'src/app.test.js']); // in the path
  assert.equal(rankFiles(files, work, '').length, 4);
  assert.equal(rankFiles(files, work, '')[0].rel, 'index.html'); // shallow files first
  fs.rmSync(work, { recursive: true, force: true });
});

test('archive: people, projects and chats come back with Restore; busy or main people stay', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(process.env.CREW_DATA, 'crew.db'));
  const add = (name, boss) => Number(db.prepare("INSERT INTO employees (name, role, model, access, folder, reports_to) VALUES (?, 'x', 'default', 'read', ?, ?)").run(name, path.join(process.env.CREW_DATA, name), boss).lastInsertRowid);
  const lead = add('ArcLead', null), mid = add('ArcMid', lead), low = add('ArcLow', mid), busy = add('ArcBusy', null);
  const row = (table, id) => db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  archive('employee', mid, true);
  assert.ok(row('employees', mid).archived_at);
  assert.equal(row('employees', low).reports_to, lead); // their team moved up
  archive('employee', mid, false);
  assert.equal(row('employees', mid).archived_at, null);
  db.prepare("INSERT INTO tasks (kind, title, employee_id, status) VALUES ('task', 'x', ?, 'queued')").run(busy);
  assert.throws(() => archive('employee', busy, true), /unfinished work/);
  db.prepare("INSERT INTO settings (key, value) VALUES ('main_assistant', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(lead));
  assert.throws(() => archive('employee', lead, true), /main assistant/);
  db.prepare("UPDATE settings SET value = '' WHERE key = 'main_assistant'").run();
  const chat = Number(db.prepare("INSERT INTO tasks (kind, title, employee_id, status) VALUES ('chat', 'x', ?, 'working')").run(lead).lastInsertRowid);
  assert.throws(() => archive('chat', chat, true), /still working/);
  db.prepare("UPDATE tasks SET status = 'idle' WHERE id = ?").run(chat);
  archive('chat', chat, true); assert.ok(row('tasks', chat).archived_at);
  const proj = Number(db.prepare("INSERT INTO projects (name, folder) VALUES ('ArcProj', '/tmp')").run().lastInsertRowid);
  archive('project', proj, true); assert.ok(row('projects', proj).archived_at);
  archive('project', proj, false); assert.equal(row('projects', proj).archived_at, null);
  db.close();
});

test('skills: read SKILL.md, make your own, find installed ones, give them to people', async () => {
  assert.deepEqual(readSkillMd('---\nname: pdf\ndescription: "Use for PDFs."\nlicense: x\n---\n\nDo it well.'), { name: 'pdf', description: 'Use for PDFs.', body: 'Do it well.' });
  const home = process.env.CREW_CLAUDE_HOME;
  fs.mkdirSync(path.join(home, 'skills', 'synced', 'acct', 'docx'), { recursive: true });
  fs.writeFileSync(path.join(home, 'skills', 'synced', 'acct', 'docx', 'SKILL.md'), '---\nname: docx\ndescription: Word files.\n---\nx');
  fs.mkdirSync(path.join(home, 'plugins', 'synced', 'acct', 'p1', '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(home, 'plugins', 'synced', 'acct', 'p1', '.claude-plugin', 'plugin.json'), '{"name":"marketing"}');
  fs.mkdirSync(path.join(home, 'plugins', 'synced', 'acct', 'p1', 'skills', 'seo-audit'), { recursive: true });
  fs.writeFileSync(path.join(home, 'plugins', 'synced', 'acct', 'p1', 'skills', 'seo-audit', 'SKILL.md'), '---\nname: seo-audit\ndescription: Audit SEO.\n---\nx');
  assert.deepEqual(saveSkill({ name: 'Write Blog Posts!', description: 'When the owner wants a blog post.', body: 'Plan, draft, edit.' }), { id: 'orbit/write-blog-posts' });
  assert.throws(() => saveSkill({ name: 'write blog posts', description: 'x', body: 'y' }), /already a skill/);
  assert.throws(() => saveSkill({ name: 'empty', description: 'x', body: '' }), /instructions/);
  const ids = findSkills().map((x) => x.id).sort();
  assert.deepEqual(ids, ['orbit/write-blog-posts', 'plugin/marketing/seo-audit', 'user/docx']);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(process.env.CREW_DATA, 'crew.db'));
  const add = (name) => Number(db.prepare("INSERT INTO employees (name, role, model, access, folder) VALUES (?, 'x', 'default', 'read', ?)").run(name, path.join(process.env.CREW_DATA, name)).lastInsertRowid);
  const a = add('SkA'), b = add('SkB');
  assignSkill('user/docx', [a, b]);
  assignSkill('plugin/marketing/seo-audit', [b]);
  assignSkill('user/docx', [b]); // take it from A
  const skills = (id) => skillsOf(db.prepare('SELECT skills FROM employees WHERE id = ?').get(id));
  assert.deepEqual(skills(a), []);
  assert.deepEqual(skills(b), ['user/docx', 'plugin/marketing/seo-audit']);
  assert.throws(() => assignSkill('user/nope', [a]), /gone/);
  db.close();
});

test('macOS folders: Desktop, Documents and Downloads can be asked for; once allowed they open', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(process.env.CREW_DATA, 'crew.db'));
  const set = (v) => db.prepare("INSERT INTO settings (key, value) VALUES ('mac_folders', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(v);
  const home = await listFolder(os.homedir()), row = (list, n) => list.folders.find((f) => f.name === n);
  if (!MAC) return db.close(); // other systems don't guard these folders
  if (row(home, 'Documents')) assert.deepEqual([row(home, 'Documents').locked, row(home, 'Documents').askable], [true, true]);
  if (row(home, 'Library')) assert.deepEqual([row(home, 'Library').locked, row(home, 'Library').askable], [true, false]); // never
  set('["Documents"]');
  const after = await listFolder(os.homedir());
  if (row(after, 'Documents')) assert.equal(row(after, 'Documents').locked, false);
  if (row(after, 'Desktop')) assert.equal(row(after, 'Desktop').locked, true);
  set('[]');
  db.close();
});

test('backups: a data folder goes into one file and comes back, with paths pointing at the new place', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { makeBackup, inspect, restore, summary, aside } = await import('./backup.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-bk-')), from = path.join(root, 'data'), to = path.join(root, 'new place');
  fs.mkdirSync(path.join(from, 'workspace', 'ada'), { recursive: true });
  fs.writeFileSync(path.join(from, 'workspace', 'ada', 'plan.md'), 'the plan');
  fs.mkdirSync(path.join(from, 'skillsets', 'x'), { recursive: true }); // temporary: left out
  const db = new DatabaseSync(path.join(from, 'crew.db'));
  db.exec(`CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT, folder TEXT, allow TEXT); CREATE TABLE tasks (id INTEGER PRIMARY KEY, kind TEXT, folder TEXT, updated_at TEXT);
    CREATE TABLE projects (id INTEGER PRIMARY KEY); CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE schedules (id INTEGER PRIMARY KEY, folder TEXT);
    CREATE TABLE messages (id INTEGER PRIMARY KEY, attachments TEXT, files TEXT);`);
  db.prepare('INSERT INTO employees (name, folder, allow) VALUES (?, ?, ?)').run('Ada', path.join(from, 'workspace', 'ada'), '{}');
  db.prepare("INSERT INTO tasks (kind, updated_at) VALUES ('chat', '2026-10-07 09:00:00')").run();
  db.prepare("INSERT INTO settings VALUES ('owner_name', 'Sam')").run();
  db.prepare('INSERT INTO messages (attachments) VALUES (?)').run(JSON.stringify([{ path: path.join(from, 'uploads', 'a', 'shot.png') }]));
  db.close();
  assert.deepEqual(summary(from), { owner: 'Sam', people: 1, chats: 1, tasks: 0, projects: 0, lastUsed: '2026-10-07 09:00:00' });
  const file = path.join(root, 'Orbit backup.tar.gz');
  await makeBackup(from, file);
  assert.deepEqual([(await inspect(file)).owner, (await inspect(file)).people, (await inspect(file)).from], ['Sam', 1, from]);
  assert.equal(await inspect(path.join(root, 'nope.tar.gz')), null);
  await restore(file, to);
  assert.equal(fs.readFileSync(path.join(to, 'workspace', 'ada', 'plan.md'), 'utf8'), 'the plan');
  assert.ok(!fs.existsSync(path.join(to, 'skillsets')) && !fs.existsSync(path.join(to, 'orbit-backup.json')));
  const back = new DatabaseSync(path.join(to, 'crew.db'));
  assert.equal(back.prepare('SELECT folder FROM employees').get().folder, path.join(to, 'workspace', 'ada')); // follows the data
  assert.equal(JSON.parse(back.prepare('SELECT attachments FROM messages').get().attachments)[0].path, path.join(to, 'uploads', 'a', 'shot.png'));
  back.close();
  await assert.rejects(() => restore(file, to), /isn't empty/);
  const moved = aside(to);
  assert.ok(moved.includes('-old-') && fs.existsSync(path.join(moved, 'crew.db')) && !fs.existsSync(to));
  fs.rmSync(root, { recursive: true, force: true });
});
