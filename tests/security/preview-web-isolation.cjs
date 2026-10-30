// Nonvisual security check: real browser origins, no provider or native command execution.
const { chromium } = require(process.env.ORBIT_PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const http = require('node:http');
const assert = require('node:assert/strict');
(async () => {
 const server = http.createServer((request, response) => {
  if (request.url === '/probe.js') { response.setHeader('Content-Type','application/javascript'); response.end(`globalThis.moduleLoaded=true; try { globalThis.parentBridgeReadable=!!window.parent.__TAURI_INTERNALS__; } catch { globalThis.parentBridgeReadable=false; }`); }
  else { response.setHeader('Content-Type','text/html'); response.end('<!doctype html><script type="module" src="/probe.js"></script><p>Isolated web-origin probe</p>'); }
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser = await chromium.launch({headless:true,...(process.env.ORBIT_CHROME_PATH?{executablePath:process.env.ORBIT_CHROME_PATH}:{})});
 try {
  const page = await browser.newPage();
  const response = await page.goto(process.env.ORBIT_QA_URL || 'http://127.0.0.1:1420');
  assert(response.headers()['content-security-policy'].includes("frame-ancestors 'none'"));
  const remote=`http://127.0.0.1:${server.address().port}`;
  const source = fs.readFileSync('src/features/preview/WebPreview.tsx','utf8');
  const sandbox = source.match(/sandbox="([^"]+)"/)[1];
  assert.equal(sandbox,'allow-scripts allow-forms allow-same-origin');
  await page.evaluate(({remote,sandbox})=>{window.__TAURI_INTERNALS__={privilegedSentinel:true};const frame=document.createElement('iframe');frame.name='preview-security';frame.sandbox=sandbox;frame.src=remote;document.body.append(frame);},{remote,sandbox});
  await page.waitForFunction(()=>document.querySelector('iframe[name="preview-security"]'));
  const frame = page.frame({name:'preview-security'});
  await frame.waitForFunction(()=>globalThis.moduleLoaded===true);
  assert.equal(await frame.evaluate(()=>globalThis.parentBridgeReadable),false,'Remote web content must not read the parent bridge');
  const violation = page.waitForEvent('console', { predicate: message=>/frame-ancestors/.test(message.text()), timeout:5000 });
  await frame.goto(process.env.ORBIT_QA_URL || 'http://127.0.0.1:1420').catch(()=>{});
  await violation; // Navigation can fail before the browser emits its CSP violation.

  console.log(JSON.stringify({scope:'nonvisual web-origin isolation in Chromium; no native IPC/provider execution',checks:['local ES modules run in the preview origin','remote content cannot read parent bridge','privileged Orbit UI refuses framing/redirect framing'],passed:true},null,2));
 } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
