// Orbit's tools for Antigravity (Gemini), which only takes tool connections from its own settings.
// Orbit adds this file there as the "orbit" connection. It passes each request on to Orbit's /mcp with the run's secret,
// which Orbit gives it (ORBIT_MCP_URL, ORBIT_MCP_TOKEN) only inside Orbit's own runs. Anywhere else it offers no tools.
import readline from 'node:readline';

const url = process.env.ORBIT_MCP_URL, token = process.env.ORBIT_MCP_TOKEN;
const out = (x) => process.stdout.write(JSON.stringify(x) + '\n');

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (!url || !token) { // outside an Orbit run: an empty connection, so nothing breaks
    if (m.id === undefined) return;
    if (m.method === 'initialize') return out({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'orbit', version: '1' } } });
    if (m.method === 'tools/list') return out({ jsonrpc: '2.0', id: m.id, result: { tools: [] } });
    return out({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: "Orbit's tools only work inside an Orbit run." } });
  }
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: line }).catch(() => null);
  if (m.id === undefined) return; // a notification: nothing to answer
  const text = r ? await r.text() : '';
  try { out(JSON.parse(text)); } catch { out({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: r ? `Orbit answered ${r.status}` : "Orbit isn't answering" } }); }
});
