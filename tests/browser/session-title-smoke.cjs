// Real xterm mouse reporting; injected native transport, no Claude/model call.
const { chromium } = require(process.env.ORBIT_PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = process.env.ORBIT_QA_OUTPUT || 'qa-output/session-title';
fs.mkdirSync(output, { recursive: true });
(async () => {
 const browser = await chromium.launch({headless:true,...(process.env.ORBIT_CHROME_PATH ? {executablePath:process.env.ORBIT_CHROME_PATH} : {})});
 try {
  const page = await browser.newPage({viewport:{width:1280,height:850}});
  const errors = [], checks = [];
  page.on('pageerror', e => errors.push(e.message));
  const baseline = fs.readFileSync(path.join(__dirname, 'workspace-smoke.cjs'),'utf8');
  const prefix = ' await page.addInitScript(() => {';
  const start = baseline.indexOf(prefix) + prefix.length;
  const end = baseline.indexOf('\n });',start);
  assert(start >= prefix.length && end > start);
  const fixture = baseline.slice(start,end)
   .replace("activeSid:'qa-terminal-1'","activeSid:'qa-agent-1'")
   .replace("'qa-project-1':'qa-terminal-1'","'qa-project-1':'qa-agent-1'")
   .replace("name:'Review fixtures'","name:'35;189;7M<35;181;10M<35;177;11M<35;1'")
   .replace("if(cmd==='load_scrollback') return null;","if(cmd==='load_scrollback') return null; if(cmd==='claude_sessions_snapshot') return {available:true,sessions:[]};")
   .replace("if(cmd==='generate_title') return 'Local fixture title';","if(cmd==='generate_title') return args.prompt.trim();");
  await page.addInitScript({content:`(() => {${fixture}})()`});
  await page.goto(process.env.ORBIT_QA_URL || 'http://127.0.0.1:1461');
  await page.getByTestId('sidebar').waitFor();
  // Hydration is asynchronous; import the exact URL used by the UI, including
  // a Vite HMR timestamp, rather than accidentally creating a second store.
  const waitLoaded = async () => {
   const deadline = Date.now()+10000;
   while (Date.now()<deadline) {
    const loaded = await page.evaluate(async () => {
     const url = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname==='/src/core/store.ts')?.name;
     if (!url) return false;
     const {useStore} = await import(url);
     window.__qaStore = useStore;
     const state = useStore.getState();
     return state.loaded && state.projects[0]?.id==='qa-project-1';
    });
    if (loaded) return;
    await new Promise(resolve => setTimeout(resolve,50));
   }
   assert.fail('fixture store did not finish hydration');
  };
  await waitLoaded();
  const session = () => page.evaluate(() => window.__qaStore.getState().projects[0].sessions[0]);
  assert.equal((await session()).name,'session-1');
  assert.equal((await session()).claudeSessionId,'qa-conversation');
  checks.push('stored protocol-only title repaired without changing conversation ID');
  await page.getByRole('button',{name:'Reprendre',exact:true}).click();
  await page.waitForFunction(() => window.__qaCalls.some(c => c.cmd==='spawn_pty' && c.args.sessionId==='qa-agent-1'));
  await page.evaluate(() => {
   const launch = window.__qaCalls.find(c => c.cmd==='spawn_pty' && c.args.sessionId==='qa-agent-1');
   window.__qaEmit('pty-output',{session_id:'qa-agent-1',generation_id:launch.args.generationId,data:'Session title regression — simulated native transport\r\n\x1b[?1003h\x1b[?1006h❯ '});
  });
  const terminal = page.locator('.terminal-wrapper:not(.terminal-wrapper--hidden) .xterm-screen');
  const box = await terminal.boundingBox();
  assert(box && box.width > 100);
  await page.mouse.click(box.x+60,box.y+40);
  await page.mouse.move(box.x+160,box.y+90,{steps:12});
  await page.waitForFunction(() => window.__qaCalls.some(c => c.cmd==='write_pty' && /\x1b\[<35;/.test(c.args.data || '')));
  checks.push('real xterm emits and forwards SGR mouse-motion reports');
  const input = page.locator('.terminal-wrapper:not(.terminal-wrapper--hidden) .xterm-helper-textarea');
  await input.focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.__qaCalls.filter(c => c.cmd==='generate_title').length),0);
  checks.push('mouse reports plus Enter never generate a title');
  await page.keyboard.type('test');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__qaCalls.some(c => c.cmd==='generate_title' && c.args.prompt==='test'));
  await page.waitForFunction(() => window.__qaData.projects[0].sessions[0].name==='test');
  assert.equal((await session()).name,'test');
  assert.equal((await session()).claudeSessionId,'qa-conversation');
  checks.push('only typed test becomes the title and persists');
  await page.screenshot({path:path.join(output,'session-title-fixed.png'),fullPage:true});
  await page.reload();
  await page.getByTestId('sidebar').waitFor();
  await waitLoaded();
  assert.equal((await session()).name,'test');
  checks.push('valid title survives reload');
  assert.deepEqual(errors,[]);
  const result = {checks,errors,nativeTransport:'injected',modelCalls:0};
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
