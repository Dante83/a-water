// usage: node run.mjs <backend> <query> [query...]
// backend: nvidia (ANGLE GL), igpu (ANGLE GL-EGL; half-float sampling bug on radeonsi, see doc),
//          igpuvk (ANGLE Vulkan; select RADV with VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/radeon_icd.json),
//          igpugl, swiftshader
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const [gpu, ...queries] = process.argv.slice(2);
const flags = {nvidia: ['--use-angle=gl'], igpu: ['--use-gl=angle', '--use-angle=gl-egl'],
  swiftshader: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  igpuvk: ['--use-angle=vulkan', '--enable-features=Vulkan'], igpugl: ['--use-angle=gl']}[gpu];
const port = 9300 + Math.floor(Math.random() * 500);
const dir = new URL('.', import.meta.url).pathname;
const chrome = spawn('google-chrome', ['--headless=new', ...flags, '--ignore-gpu-blocklist', '--allow-file-access-from-files',
  '--disable-gpu-watchdog', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'nearshore-spike-'))}`, `--remote-debugging-port=${port}`, 'about:blank'], {stdio: 'ignore'});
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for(let i = 0; i < 100; ++i){ try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(100); } }
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map();
ws.onmessage = m => { const d = JSON.parse(m.data); if(pending.has(d.id)){ pending.get(d.id)(d); pending.delete(d.id); } };
const cmd = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({id: i, method, params})); });
for(const q of queries){
  await cmd('Page.navigate', {url: `file://${dir}sim.html?${q}`});
  let res = null;
  for(let i = 0; i < 6000 && !res; ++i){
    await sleep(100);
    const e = await cmd('Runtime.evaluate', {expression: 'window.__result ? JSON.stringify(window.__result) : ""', returnByValue: true});
    const v = e.result && e.result.result && e.result.result.value; if(v) res = v;
  }
  console.log(q, '=>', res);
}
ws.close(); chrome.kill();
