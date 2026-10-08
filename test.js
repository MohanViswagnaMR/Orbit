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
process.env.CLAUDE_BIN = path.join(process.env.CREW_DATA, 'no-claude'); // and never start Claude (hiring draws a picture in the background)
fs.writeFileSync(aFile, 'x');
after(() => { fs.rmSync(process.env.CREW_DATA, { recursive: true, force: true }); fs.rmSync(aFile, { force: true }); });
const { pickNotes, splitNotes, nextRun, permsOf, checkFolder, listFolder, bashPrefix, preApproved, describe, cleanAppearance, messageFiles, cleanSvg, STYLES, TOOLS, searchFonts, setBoss, cleanQuestions, cleanAttachments, rankFiles, archive, readSkillMd, saveSkill, findSkills, assignSkill, skillsOf, pickSkills, parseGithubUrl, searchSkills, readHiring, hireAll, exportPerson, exportTeam, importPerson, engineOf, availableModels, modelOk, readPick, readCodex, readAntigravity, sessionFor, handoff, baseModel } = await import('./server.js');

test('engines: models from every engine, what Auto picks, and each engine read the same way', () => {
  assert.deepEqual([engineOf('sonnet'), engineOf('gpt:gpt-5.5'), engineOf('gemini:gemini-3.1-pro-high')], ['claude', 'gpt', 'gemini']);
  assert.deepEqual(availableModels().map((m) => m.value), ['haiku', 'sonnet', 'opus', 'fable']); // nothing else switched on
  assert.ok(modelOk('opus') && !modelOk('gpt:gpt-5.5'));
  assert.deepEqual([baseModel('light'), baseModel('standard')], ['haiku', 'sonnet']); // Orbit's own jobs, on Claude as the main AI
  const models = availableModels();
  assert.deepEqual(readPick('Sure: {"model": "haiku", "effort": "low", "why": "a quick lookup"}', models), { model: 'haiku', effort: 'low', why: 'a quick lookup' });
  assert.equal(readPick('{"model": "gpt:not-switched-on"}', models), null); // only what you can use
  const reader = () => { const o = { final: null, text: null, logs: [], files: [], skills: [], id: null };
    return Object.assign(o, { session: (id) => (o.id = id), log: (l) => o.logs.push(l), changed: (f) => o.files.push(f), skill: (s) => o.skills.push(s) }); };
  const c = reader(); // Codex (ChatGPT)
  for (const m of [{ type: 'thread.started', thread_id: 'T1' }, { type: 'item.completed', item: { type: 'command_execution', command: '/bin/zsh -lc ls', exit_code: 0 } },
    { type: 'item.completed', item: { type: 'file_change', changes: [{ path: 'a.md', kind: 'add' }] } }, { type: 'item.completed', item: { type: 'mcp_tool_call', tool: 'read_skill', arguments: { id: 'github/pdf' } } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } }, { type: 'turn.completed', usage: {} }]) readCodex(m, c);
  assert.deepEqual([c.id, c.files, c.skills, c.final], ['T1', ['a.md'], ['github/pdf'], { result: 'Done.', is_error: false, total_cost_usd: 0 }]);
  assert.ok(c.logs.includes('→ Bash ls\n'));
  const g = reader(); // Antigravity (Gemini)
  for (const m of [{ event: 'init', conversation_id: 'G1' }, { event: 'step_update', step_update: { step_type: 'tool', state: 'DONE', tool_name: 'write_to_file', tool_info: { parameters: { TargetFile: '/w/b.md' } } } },
    { event: 'result', result: { status: 'SUCCESS', response: '', denied_actions: [{ action: 'command', display_name: 'RunCommand' }] } }]) readAntigravity(m, g);
  assert.deepEqual([g.id, g.files], ['G1', ['/w/b.md']]);
  assert.match(g.final.result, /doesn't allow RunCommand/); // blocked: it says so instead of an empty reply
});

test('switching a chat to another engine: each engine resumes only its own conversation; the new one gets what was said', async () => {
  assert.equal(sessionFor({ session_id: 'abc-123' }, 'claude'), 'abc-123');
  assert.equal(sessionFor({ session_id: 'abc-123' }, 'gemini'), null);
  assert.equal(sessionFor({ session_id: 'gemini:g-1' }, 'gemini'), 'g-1');
  assert.equal(sessionFor({ session_id: 'gemini:g-1' }, 'claude'), null);
  assert.equal(sessionFor({ session_id: null }, 'claude'), null);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(process.env.CREW_DATA, 'crew.db'));
  const t = Number(db.prepare("INSERT INTO tasks (kind, title, employee_id, status) VALUES ('chat', 'switch', 0, 'idle')").run().lastInsertRowid);
  for (const [kind, author, text] of [['me', 'me', 'What models do you have?'], ['reply', 'Movis', 'Haiku, Sonnet and Opus.'], ['me', 'me', 'now tell me']])
    db.prepare('INSERT INTO messages (task_id, kind, author, text) VALUES (?, ?, ?, ?)').run(t, kind, author, text);
  const h = handoff({ id: t, employee_id: 0 });
  assert.match(h, /Owner: What models do you have\?\n\nMovis: Haiku, Sonnet and Opus\./);
  assert.ok(!h.includes('now tell me')); // the newest message comes in the prompt itself
  db.close();
});

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
  // A project takes its chats and tasks with it, and brings back only those; a chat archived before stays archived.
  const inProj = (kind, status) => Number(db.prepare('INSERT INTO tasks (kind, title, employee_id, project_id, status) VALUES (?, ?, ?, ?, ?)').run(kind, 'p', lead, proj, status).lastInsertRowid);
  const pChat = inProj('chat', 'idle'), pTask = inProj('task', 'done'), early = inProj('chat', 'idle');
  db.prepare("UPDATE tasks SET archived_at = '2020-01-01 00:00:00' WHERE id = ?").run(early);
  archive('project', proj, true);
  assert.ok(row('tasks', pChat).archived_at && row('tasks', pTask).archived_at);
  assert.throws(() => archive('chat', pChat, false), /project is archived/);
  archive('project', proj, false);
  assert.equal(row('tasks', pChat).archived_at, null); assert.equal(row('tasks', pTask).archived_at, null);
  assert.equal(row('tasks', early).archived_at, '2020-01-01 00:00:00');
  db.prepare("UPDATE tasks SET status = 'working' WHERE id = ?").run(pTask);
  assert.throws(() => archive('project', proj, true), /work going on/);
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
  assert.deepEqual(ids.filter((x) => !x.startsWith('core/')), ['orbit/write-blog-posts', 'plugin/marketing/seo-audit', 'user/docx']);
  assert.deepEqual(ids.filter((x) => x.startsWith('core/')), ['core/ask-the-owner', 'core/check-results', 'core/choose-model', 'core/delegate-work', 'core/find-skills', 'core/report-back']); // Orbit's own, for everyone
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
  assert.throws(() => assignSkill('core/delegate-work', [a]), /Everyone has/);
  // Searching the whole collection: by name or description, word endings don't matter, core skills are left out
  assert.equal(searchSkills('write a blog post')[0].id, 'orbit/write-blog-posts');
  assert.equal(searchSkills('SEO audits')[0].id, 'plugin/marketing/seo-audit');
  assert.deepEqual(searchSkills('delegate work to teammates'), []);
  assert.throws(() => searchSkills('  '), /few words/);
  const read = TOOLS.find((x) => x.name === 'read_skill').run({ id: 'orbit/write-blog-posts' });
  assert.match(read, /Plan, draft, edit\./);
  db.close();
});

test('auto skills: only skills that exist, at most 8 each, whatever Claude wraps the answer in', () => {
  const people = [{ id: 1 }, { id: 2 }, { id: 3 }], skills = 'abcdefghi'.split('').map((x) => ({ id: `orbit/${x}` }));
  const out = pickSkills('Sure!\n```json\n{"1": ["orbit/a", "orbit/made-up", "orbit/a"], "2": ' + JSON.stringify(skills.map((x) => x.id)) + '}\n```', people, skills);
  assert.deepEqual(out[1], ['orbit/a']); // real and once
  assert.equal(out[2].length, 8);
  assert.deepEqual(out[3], []); // left out: nothing
  assert.deepEqual(pickSkills('no JSON at all', people, skills)[1], []);
});

test('skills from GitHub: a repository, a folder in it, or its SKILL.md', () => {
  assert.deepEqual(parseGithubUrl('https://github.com/anthropics/skills'), { owner: 'anthropics', repo: 'skills', ref: 'HEAD', dir: '' });
  assert.deepEqual(parseGithubUrl('https://github.com/anthropics/skills/tree/main/skills/pdf/'), { owner: 'anthropics', repo: 'skills', ref: 'main', dir: 'skills/pdf' });
  assert.deepEqual(parseGithubUrl('https://github.com/a/b/blob/v2/x/SKILL.md'), { owner: 'a', repo: 'b', ref: 'v2', dir: 'x' });
  assert.equal(parseGithubUrl('github.com/a/b.git'.replace(/^/, 'https://')).repo, 'b');
  assert.throws(() => parseGithubUrl('https://gitlab.com/a/b'), /GitHub link/);
});

test('handing out work: a chosen model, and never back up the chain', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(process.env.CREW_DATA, 'crew.db'));
  const add = (name) => Number(db.prepare("INSERT INTO employees (name, role, model, access, folder) VALUES (?, 'x', 'default', 'edit', ?)").run(name, path.join(process.env.CREW_DATA, name)).lastInsertRowid);
  const a = add('LoopA'), b = add('LoopB'); add('LoopC');
  const chat = Number(db.prepare("INSERT INTO tasks (kind, title, employee_id, status) VALUES ('chat', 'plan', ?, 'working')").run(a).lastInsertRowid);
  const create = TOOLS.find((x) => x.name === 'create_task'), byTitle = (title) => db.prepare('SELECT * FROM tasks WHERE title = ?').get(title);
  create.run({ title: 'Loop research', description: 'x', assignee: 'LoopB', model: 'haiku', effort: 'low' }, { employeeId: a, taskId: chat });
  const t1 = byTitle('Loop research');
  assert.equal(t1.model, 'haiku'); assert.equal(t1.effort, 'low');
  assert.throws(() => create.run({ title: 'Back to A', description: 'x', assignee: 'LoopA' }, { employeeId: b, taskId: t1.id }), /round in circles/);
  create.run({ title: 'Loop detail', description: 'x', assignee: 'LoopC' }, { employeeId: b, taskId: t1.id }); // further down is fine
  const t2 = byTitle('Loop detail');
  assert.equal(t2.model, null); // their own setting
  assert.throws(() => create.run({ title: 'Back to B', description: 'x', assignee: 'LoopB' }, { employeeId: t2.employee_id, taskId: t2.id }), /round in circles/);
  assert.throws(() => create.run({ title: 'x', description: 'x', assignee: 'LoopB', model: 'gpt-9' }, { employeeId: a, taskId: chat }), /model must be/);
  db.close();
});

test('hire with help: questions or a plan from the hiring assistant; bosses are hired before their people', async () => {
  const q = readHiring('Here you go: {"questions": [{"question": "What are you working on?", "options": ["An app", "A shop"]}]}', false);
  assert.deepEqual(q.questions[0].options.map((o) => o.label), ['An app', 'A shop']);
  const plan = readHiring('{"summary": "Two people.", "hires": [{"name": "Hw Lead", "title": "Lead", "job_description": "You lead.", "model": "gpt", "file_access": "root"}, {"name": "", "job_description": "x"}]}', true);
  assert.deepEqual(plan.hires.map((h) => [h.name, h.model, h.file_access, h.reports_to]), [['HwLead', 'auto', 'read', 'owner']]); // cleaned (an unknown model becomes Auto), and the nameless one dropped
  assert.throws(() => readHiring('{"questions": [{"question": "x?", "options": ["a", "b"]}]}', true), /didn't come back with a plan/); // last round: questions don't count
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(process.env.CREW_DATA, 'crew.db')), row = (n) => db.prepare('SELECT * FROM employees WHERE name = ?').get(n);
  db.prepare('DELETE FROM employees').run(); // the earlier tests' people would fill the company
  const { hired } = hireAll([{ name: 'HwB', title: 'Helper', job_description: 'You help.', reports_to: 'HwA' }, { name: 'HwA', title: 'Lead', job_description: 'You lead.', reports_to: 'owner' }]);
  assert.deepEqual(hired.map((x) => x.name), ['HwA', 'HwB']); // the boss first
  assert.equal(row('HwB').reports_to, row('HwA').id);
  assert.equal(row('HwA').reports_to, null);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'main_assistant'").get().value, String(row('HwA').id)); // the first teammate runs the team
  assert.throws(() => hireAll([{ name: 'HwA', job_description: 'x' }]), /already have someone/);
  assert.throws(() => hireAll([{ name: 'HwC', job_description: 'x' }, { name: 'hwc', job_description: 'y' }]), /same name/);
  assert.throws(() => hireAll([{ name: 'HwD', job_description: 'x' }, { name: 'HwE', job_description: ' ' }]), /job description/);
  assert.equal(row('HwD'), undefined); // nobody half hired
  fs.mkdirSync(path.join(process.env.CREW_DATA, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(process.env.CREW_DATA, 'notes', 'hwn.md'), '- notes of someone let go'); // a leftover with the same name
  hireAll([{ name: 'HwN', job_description: 'You start fresh.' }]);
  assert.ok(!fs.existsSync(path.join(process.env.CREW_DATA, 'notes', 'hwn.md'))); // not inherited
  db.close();
});

test('a teammate as a file: exported with their skills, imported safely into another Orbit', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(process.env.CREW_DATA, 'crew.db')), row = (n) => db.prepare('SELECT * FROM employees WHERE name = ?').get(n);
  const id = Number(db.prepare(`INSERT INTO employees (name, title, role, personality, model, access, folder, skills, avatar) VALUES ('ExA', 'Writer', 'You write.', 'Warm.', 'haiku', 'full', ?, '["orbit/write-blog-posts"]', '1')`)
    .run(path.join(process.env.CREW_DATA, 'exa')).lastInsertRowid);
  fs.mkdirSync(path.join(process.env.CREW_DATA, 'avatars'), { recursive: true });
  fs.writeFileSync(path.join(process.env.CREW_DATA, 'avatars', `${id}.svg`), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>');
  fs.mkdirSync(path.join(process.env.CREW_DATA, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(process.env.CREW_DATA, 'notes', 'exa.md'), '- Sam likes tea');
  assert.equal(exportPerson(id).notes, null); // notes stay home unless asked for
  const file = exportPerson(id, { notes: true });
  assert.deepEqual([file.orbit, file.person.name, file.skills.map((k) => k.name), Object.keys(file.skills[0].files)], ['teammate', 'ExA', ['write-blog-posts'], ['SKILL.md']]);
  const back = importPerson(JSON.stringify(file)); // a friend's Orbit: here, the same one, so the name is taken
  assert.deepEqual([back.name, back.renamed, back.skills], ['ExA2', true, 1]);
  const ex2 = row('ExA2');
  assert.deepEqual([ex2.title, ex2.model, ex2.access, ex2.reports_to, ex2.skills], ['Writer', 'haiku', 'edit', null, '["orbit/write-blog-posts"]']); // the same skill is shared, full access comes in as edit
  assert.ok(fs.readFileSync(path.join(process.env.CREW_DATA, 'avatars', `${ex2.id}.svg`), 'utf8').startsWith('<svg') && ex2.avatar);
  assert.equal(fs.readFileSync(path.join(process.env.CREW_DATA, 'notes', 'exa2.md'), 'utf8'), '- Sam likes tea');
  const b64 = (t) => Buffer.from(t).toString('base64');
  const sneaky = importPerson({ orbit: 'teammate', person: { name: 'Sly', role: 'You help.', access: 'full' }, picture: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>',
    skills: [{ name: 'evil', files: { 'SKILL.md': b64('---\nname: evil\ndescription: x\n---\nx'), '../../escaped.txt': b64('no') } }] });
  assert.ok(!fs.existsSync(path.join(process.env.CREW_DATA, 'escaped.txt')) && fs.existsSync(path.join(process.env.CREW_DATA, 'skills', 'evil', 'SKILL.md')));
  assert.ok(!fs.existsSync(path.join(process.env.CREW_DATA, 'avatars', `${sneaky.id}.svg`)) && row('Sly').avatar === ''); // a picture with a script in it isn't used at all
  assert.throws(() => importPerson('{"hello": 1}'), /isn't an Orbit teammate or team file/);
  // The whole team: everyone, their bosses, and each skill once
  const team = exportTeam();
  assert.equal(team.orbit, 'team');
  assert.deepEqual(team.people.find((x) => x.person.name === 'HwB').reports_to, 'HwA');
  assert.equal(team.skills.filter((k) => k.name === 'write-blog-posts').length, 1); // ExA and ExA2 share it: stored once
  const before = db.prepare('SELECT count(*) AS n FROM employees').get().n, main = db.prepare("SELECT value FROM settings WHERE key = 'main_assistant'").get().value;
  const got = importPerson(JSON.stringify({ ...team, people: [...team.people].reverse() })); // even with each boss after their people in the file
  assert.equal(got.people.length, team.people.length);
  assert.equal(db.prepare('SELECT count(*) AS n FROM employees').get().n, before + team.people.length);
  const copy = (n) => row(got.people.find((x) => x.name.startsWith(n) && x.name !== n).name);
  assert.equal(copy('HwB').reports_to, copy('HwA').id); // the org chart comes along, pointing at the new copies
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'main_assistant'").get().value, main); // you already had a main assistant: still yours
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
  // Only some parts: the rest stays out, and the database forgets what it left out
  const db2 = new DatabaseSync(path.join(from, 'crew.db'));
  db2.exec(`ALTER TABLE employees ADD COLUMN avatar TEXT; ALTER TABLE employees ADD COLUMN skills TEXT;
    UPDATE employees SET avatar = '123', skills = '["orbit/x","github/y","user/docx"]'; INSERT INTO settings VALUES ('owner_avatar', 'svg:1');`);
  db2.close();
  fs.mkdirSync(path.join(from, 'avatars')); fs.writeFileSync(path.join(from, 'avatars', '1.svg'), '<svg/>');
  fs.mkdirSync(path.join(from, 'notes')); fs.writeFileSync(path.join(from, 'notes', 'Ada.md'), '- likes tea');
  const part = path.join(root, 'part.tar.gz'), to2 = path.join(root, 'part restored');
  await makeBackup(from, part, ['memory']);
  assert.deepEqual((await inspect(part)).parts, ['memory']);
  await restore(part, to2);
  assert.ok(fs.existsSync(path.join(to2, 'notes', 'Ada.md')) && !fs.existsSync(path.join(to2, 'avatars')) && !fs.existsSync(path.join(to2, 'workspace')));
  const b2 = new DatabaseSync(path.join(to2, 'crew.db')), ada = b2.prepare('SELECT avatar, skills FROM employees').get();
  assert.equal(ada.avatar, ''); // no broken picture
  assert.equal(ada.skills, '["user/docx"]'); // skills that weren't in it are gone; Claude's own stay
  assert.equal(b2.prepare("SELECT value FROM settings WHERE key = 'owner_avatar'").get().value, '');
  b2.close();
  assert.ok(fs.existsSync(path.join(from, 'avatars', '1.svg'))); // the real data is untouched
  await assert.rejects(() => restore(file, to), /isn't empty/);
  const moved = aside(to);
  assert.ok(moved.includes('-old-') && fs.existsSync(path.join(moved, 'crew.db')) && !fs.existsSync(to));
  fs.rmSync(root, { recursive: true, force: true });
});
