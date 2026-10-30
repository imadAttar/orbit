// Real React/xterm, deliberately injected native transport; no Claude/model calls.
const { chromium } = require(process.env.ORBIT_PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = process.env.ORBIT_QA_OUTPUT || 'qa-output/native-observation';
fs.mkdirSync(output, { recursive: true });
(async () => {
 const browser = await chromium.launch({ headless: true, ...(process.env.ORBIT_CHROME_PATH ? { executablePath: process.env.ORBIT_CHROME_PATH } : {}) });
 try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  const errors = [], checks = [];
  page.on('pageerror', e => errors.push(e.message));
  const baseline = fs.readFileSync(path.join(__dirname, 'workspace-smoke.cjs'), 'utf8');
  const prefix = ' await page.addInitScript(() => {';
  const start = baseline.indexOf(prefix) + prefix.length;
  const end = baseline.indexOf('\n });', start);
  assert(start >= prefix.length && end > start);
  let fixture = baseline.slice(start, end)
   .replace("activeSid:'qa-terminal-1'", "activeSid:'qa-agent-1'")
   .replace("'qa-project-1':'qa-terminal-1'", "'qa-project-1':'qa-agent-1'")
   .replace("if(cmd==='load_scrollback') return null;", `if(cmd==='load_scrollback') return null;
    if(cmd==='claude_sessions_snapshot') return window.__qaSnapshotUnavailable
      ? {available:false,sessions:[],error:'unavailable'}
      : {available:true,sessions:window.__qaEmptySnapshot ? [] : [{sessionId:'qa-conversation',kind:'interactive',status:window.__qaStatus||'idle'}]};`);
  await page.addInitScript({ content: `(() => {${fixture}})()` });
  await page.goto(process.env.ORBIT_QA_URL || 'http://127.0.0.1:1461');
  await page.getByTestId('sidebar').waitFor();
  await page.getByRole('button', { name: 'Reprendre', exact: true }).click();
  await page.waitForFunction(() => window.__qaCalls.some(c => c.cmd === 'spawn_pty' && c.args.sessionId === 'qa-agent-1'));
  const state = () => page.evaluate(async () => {
   const { useStore } = await import('/src/core/store.ts');
   return useStore.getState().sessionStates['qa-conversation'] || null;
  });
  const waitState = async expected => {
   const deadline = Date.now() + 9000;
   let actual;
   while (Date.now() < deadline) {
    actual = await state();
    if (actual === expected) return;
    await new Promise(resolve => setTimeout(resolve,100));
   }
   assert.equal(actual, expected, 'native state did not settle before timeout');
  };
  await waitState('idle'); checks.push('native snapshot idle');
  const text = Array.from({length:6}, (_,i) => `❯ Demande de démonstration ${i+1} : vérifier le composant ${i+1}\r\n` + Array.from({length:18}, (_,j) => `Sortie de démonstration ${j+1}`).join('\r\n') + '\r\n').join('');
  await page.evaluate(text => {
   const launch = window.__qaCalls.filter(c => c.cmd === 'spawn_pty' && c.args.sessionId === 'qa-agent-1').at(-1);
   window.__qaEmit('pty-output', {session_id:'qa-agent-1',generation_id:launch.args.generationId,data:text});
  }, text);
  const markers = page.locator('.terminal-wrapper:not(.terminal-wrapper--hidden) .prompt-peek__marker');
  await page.waitForFunction(() => document.querySelectorAll('.terminal-wrapper:not(.terminal-wrapper--hidden) .prompt-peek__marker').length === 6);
  checks.push('six rendered prompt markers');
  const beforeWrites = await page.evaluate(() => window.__qaCalls.filter(c => c.cmd === 'write_pty').length);
  await markers.first().hover();
  await page.getByRole('tooltip').filter({hasText:'Demande de démonstration 1'}).waitFor();
  await page.screenshot({path:path.join(output,'prompt-preview-dark.png'),fullPage:true});
  checks.push('pointer hover shows first prompt excerpt');
  await markers.first().click();
  await page.waitForFunction(() => document.querySelector('.terminal-wrapper:not(.terminal-wrapper--hidden) .xterm-rows > div')?.textContent.includes('Demande de démonstration 1'));
  checks.push('click visibly scrolls real xterm to first prompt');
  await page.screenshot({path:path.join(output,'prompt-jump.png'),fullPage:true});
  await markers.last().focus();
  await page.keyboard.press('Home');
  // Home selects the rail's first control (the previous-prompt button).
  assert.equal(await page.locator('.terminal-wrapper:not(.terminal-wrapper--hidden) .prompt-peek button').first().evaluate(e => document.activeElement === e),true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.terminal-wrapper:not(.terminal-wrapper--hidden) .xterm-helper-textarea').evaluate(e => document.activeElement === e),true);
  assert.equal(await page.evaluate(() => window.__qaCalls.filter(c => c.cmd === 'write_pty').length),beforeWrites);
  checks.push('keyboard navigation and escape preserve native PTY input');
  await page.evaluate(() => { window.__qaStatus='busy'; });
  await waitState('working'); checks.push('busy maps to working');
  await page.evaluate(() => { window.__qaStatus='waiting'; });
  await waitState('waiting'); checks.push('waiting maps to waiting');
  await page.evaluate(() => { window.__qaEmptySnapshot=true; });
  await waitState(null); checks.push('missing live session becomes unknown, not completed');
  await page.evaluate(() => { window.__qaEmptySnapshot=false;window.__qaStatus='busy'; });
  await waitState('working');
  await page.evaluate(() => { window.__qaSnapshotUnavailable=true; });
  await waitState(null); checks.push('unavailable native source clears stale activity');
  await page.evaluate(() => { window.__qaSnapshotUnavailable=false;window.__qaStatus='idle'; });
  await waitState('idle');
  const forbidden = await page.evaluate(() => window.__qaCalls.filter(c => ['enable_session_hooks','check_session_hooks','remove_session_hooks','create_statusline','has_statusline','install_claude'].includes(c.cmd)).map(c => c.cmd));
  assert.deepEqual(forbidden,[]); checks.push('startup and polling never configure Claude');
  assert.equal(await page.locator('.context-bar').count(),0); checks.push('retired custom status-line metrics absent');
  assert.deepEqual(errors,[]); checks.push('no browser page errors');
  await waitState('idle');
  const finalState = await state();
  assert.equal(finalState,'idle');
  const report={boundary:'Real React/xterm with mocked native transport; not native IPC or provider verification',checks,check_count:checks.length,errors,finalState};
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
 } finally { await browser.close(); }
})().catch(e => {console.error(e);process.exitCode=1;});
