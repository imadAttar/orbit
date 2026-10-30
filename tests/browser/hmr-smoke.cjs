// Real Vite HMR over a disposable source copy; explicit fake native transport, no Claude.
const { chromium } = require(process.env.ORBIT_PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
(async () => {
 const root = path.resolve(__dirname, '../..');
 const output = process.env.ORBIT_QA_OUTPUT;
 assert(output && path.isAbsolute(output), 'Set an absolute scratch ORBIT_QA_OUTPUT');
 fs.mkdirSync(output, { recursive: true });
 const dir = fs.mkdtempSync(path.join(output, 'hmr-app-'));
 for (const item of ['src', 'public', 'index.html', 'vite.config.ts', 'package.json', 'tsconfig.json']) fs.cpSync(path.join(root,item), path.join(dir,item), { recursive:true });
 fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');

 const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)); }); });
 const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd:dir, env:{...process.env,TAURI_DEV_HOST:''}, stdio:['ignore','pipe','pipe'] });
 let serverLog = ''; server.stdout.on('data', b=>serverLog+=b); server.stderr.on('data', b=>serverLog+=b);
 let browser;
 try {
  const url = `http://127.0.0.1:${port}`;
  for (let n=0;n<100;n++) {
   if (server.exitCode !== null) throw Error(`Vite failed: ${serverLog}`);
   try { if((await fetch(url)).ok) break; } catch {}
   await new Promise(r=>setTimeout(r,100));
  }
  browser = await chromium.launch({headless:true,...(process.env.ORBIT_CHROME_PATH ? {executablePath:process.env.ORBIT_CHROME_PATH}: {})});
  const page = await browser.newPage({viewport:{width:1280,height:850}});
  const errors = [];
  const providerRequests = [];
  page.on('pageerror', error=>errors.push(error.message));

  page.on('request', request=>{if(/api\.anthropic\.com|api\.openai\.com|aptabase/.test(request.url())) providerRequests.push(request.url());});
  const fixture = fs.readFileSync(path.join(root,'tests/browser/workspace-smoke.cjs'),'utf8').split('await page.addInitScript(() => {')[1]?.split('\n });')[0];
  assert(fixture, 'Existing explicit native fixture required');
  await page.addInitScript({content:`(() => {${fixture}\n})()`});
  await page.goto(url);
  await page.getByTestId('sidebar').waitFor();
  await page.waitForFunction(()=>window.__qaCalls.some(c=>c.cmd==='spawn_pty'&&c.args.sessionId==='qa-terminal-1'));
  await page.evaluate(async()=>{
   window.__hmrStore=(await import('/src/core/store.ts')).useStore;
   window.__qaEmit('session-state-changed',JSON.stringify({session_id:'qa-conversation',state:'working',tool:'Read',ts:Date.now()}));
   window.__hmrInitialAction=window.__hmrStore.getState().setSessionTool;
  });
  const baseline = await page.evaluate(()=>window.__qaCalls.filter(c=>['spawn_pty','kill_pty','read_orbit_file'].includes(c.cmd)).map(c=>({cmd:c.cmd,args:c.args})));
  const source = path.join(dir, 'src/core/store.ts');
  fs.appendFileSync(source, '\n// Disposable HMR probe.\n');
  await page.waitForFunction(()=>window.__hmrStore.getState().setSessionTool!==window.__hmrInitialAction).catch(async error=>{
   console.error(JSON.stringify({errors,diagnostic:await page.evaluate(()=>({loaded:window.__hmrStore.getState().loaded,sidebar:!!document.querySelector('[data-testid="sidebar"]'),text:document.body.innerText.slice(0,500),nativeCalls:window.__qaCalls.map(c=>c.cmd)}))},null,2));
   await page.screenshot({path:path.join(output,'hmr-failure.png'),fullPage:true});
   throw error;
  });
  assert.equal(await page.evaluate(()=>window.__hmrStore.getState().loaded),true,'HMR must preserve loaded state');
  assert.equal(await page.evaluate(()=>window.__hmrStore.getState().sessionStates['qa-conversation']),'working','HMR must preserve live observations');
  await page.getByTestId('sidebar').waitFor();
  assert.deepEqual(await page.evaluate(()=>window.__qaCalls.filter(c=>['spawn_pty','kill_pty','read_orbit_file'].includes(c.cmd)).map(c=>({cmd:c.cmd,args:c.args}))),baseline,'HMR must not reload disk, spawn, or kill a PTY');
  await page.evaluate(()=>window.__hmrStore.getState().setSessionTool('qa-conversation','Updated action'));
  assert.equal(await page.evaluate(()=>window.__hmrStore.getState().sessionTools['qa-conversation']),'Updated action','New action must mutate the live store');
  // Reproduce dictionary hot reload without reloading the window or its terminal.
  const dictionary = path.join(dir, 'src/i18n/fr.json');
  const french = JSON.parse(fs.readFileSync(dictionary, 'utf8'));
  french['sidebar.sessions'] = 'Projets HMR';
  fs.writeFileSync(dictionary, JSON.stringify(french, null, 2));
  await page.waitForFunction(()=>document.querySelector('.sidebar__footer')?.textContent.includes('Projets HMR'), null, {timeout:10000}).catch(async error=>{
   console.error('Dictionary HMR text:', await page.getByTestId('sidebar').innerText());
   throw error;
  });
  assert.doesNotMatch(await page.getByTestId('sidebar').innerText(), /\b(?:sidebar|common|supervision)\./, 'Translation keys must never replace labels after HMR');
  assert.deepEqual(await page.evaluate(()=>window.__qaCalls.filter(c=>['spawn_pty','kill_pty','read_orbit_file'].includes(c.cmd)).map(c=>({cmd:c.cmd,args:c.args}))),baseline,'Dictionary HMR must preserve the workspace and terminal lifecycle');
  assert.deepEqual(errors,[]);
  assert.deepEqual(providerRequests,[]);
  await page.screenshot({path:path.join(output,'hmr-preserved.png'),fullPage:true});
  const report={stage:'real-vite-hmr',transport:'explicit fake native API; disposable source copy; no Claude inference',checks:['live store identity survives HMR','fresh action implementations mutate live state','loaded state and observations preserved','no disk reinitialization','no PTY restart or kill','native UI remains rendered','dictionary updates reach translated labels','no raw translation keys after dictionary HMR','dictionary HMR preserves workspace and PTY lifecycle'],errors,providerRequests};
  fs.writeFileSync(path.join(output,'hmr-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
 } finally {
  await browser?.close();
  server.kill('SIGTERM');
  await new Promise(resolve=>{if(server.exitCode!==null||server.signalCode!==null)resolve();else server.once('exit',resolve);});
  fs.writeFileSync(path.join(output,'vite-hmr.log'),serverLog);
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
