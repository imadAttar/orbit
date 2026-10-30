const { chromium } = require(process.env.ORBIT_PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const output = process.env.ORBIT_QA_OUTPUT || 'qa-output';
fs.mkdirSync(output, { recursive: true });
(async () => {
 const browser = await chromium.launch({headless:true,...(process.env.ORBIT_CHROME_PATH ? {executablePath:process.env.ORBIT_CHROME_PATH} : {})});
 const page = await browser.newPage({viewport:{width:1280,height:850}});
 const errors=[]; const requests=[];
 page.on('pageerror', e=>errors.push(e.message));
 page.on('request', r=>{if(r.url().includes('aptabase')) requests.push(r.url());});
 await page.addInitScript(() => {
  const now=Date.now();
  const fixture={projects:[{id:'qa-project-1',name:'QA Workspace',dir:'/tmp/orbit-fixture-1',sessions:[{id:'qa-agent-1',name:'Review fixtures',type:'claude',claudeSessionId:'qa-conversation',hasConversation:true,lastActivityAt:now},{id:'qa-terminal-1',name:'Terminal checks',type:'terminal',lastActivityAt:now-60000}]},{id:'qa-project-2',name:'QA Secondary',dir:'/tmp/orbit-fixture-2',sessions:[{id:'qa-agent-2',name:'Background task',type:'claude',claudeSessionId:'qa-conversation-2',hasConversation:true,lastActivityAt:now-120000}]}],activePid:'qa-project-1',activeSid:'qa-terminal-1',projectSessions:{'qa-project-1':'qa-terminal-1','qa-project-2':'qa-agent-2'},settings:{analytics:false,autoNotifications:false,autoUpdate:false,statuslineAsked:true,defaultMode:'normal',language:'fr',theme:'orbit',fontSize:13,sidebarWidth:280,terminal:'default',editor:'vscode'}};
  fixture.projects[1].sessions[0].runtimeStatus = 'failed';
  fixture.projects[1].sessions[0].failureReason = 'resume';
  window.__qaCalls=[]; window.__qaData=JSON.parse(localStorage.getItem('qa-data')||'null')||fixture;
  const handlers=new Map(); let next=1; const listeners=new Map();
  window.__qaEmit=(event,payload)=>{for(const id of listeners.get(event)||[]) handlers.get(id)?.({event,payload,id});};
  window.__TAURI_INTERNALS__={
   metadata:{currentWindow:{label:'main'},currentWebview:{label:'main',windowLabel:'main'}},
   transformCallback:(cb)=>{const id=next++;handlers.set(id,cb);return id;},
   unregisterCallback:(id)=>handlers.delete(id),
   invoke:async(cmd,args={})=>{
    window.__qaCalls.push({cmd,args});
    if(cmd==='read_orbit_file') return JSON.stringify(window.__qaData);
    if(cmd==='write_orbit_file'){window.__qaData=JSON.parse(args.data);localStorage.setItem('qa-data',args.data);return;}
    if(cmd==='check_claude_installed'||cmd==='has_statusline') return true;
    if(cmd==='load_scrollback') return null;
    if(cmd==='plugin:updater|check') return null;
    if(cmd==='plugin:event|listen'){ const arr=listeners.get(args.event)||[];arr.push(args.handler);listeners.set(args.event,arr);return args.handler; }
    if(cmd==='plugin:event|unlisten')return;
    if(cmd==='generate_title') return 'Local fixture title';
    return null;
   }
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
 });
 await page.goto(process.env.ORBIT_QA_URL || 'http://127.0.0.1:1437');
 await page.getByTestId('sidebar').waitFor();
 // A visible shell does not imply its deferred terminal has finished starting.
 // Establish the first launch before asserting that archive/restore launches it again.
 await page.waitForFunction(()=>window.__qaCalls.some(c=>c.cmd==='spawn_pty'&&c.args.sessionId==='qa-terminal-1'));
 const initialLifecycle=await page.evaluate(()=>window.__qaCalls.filter(c=>['spawn_pty','kill_pty'].includes(c.cmd)));
 const writesBefore=await page.evaluate(()=>window.__qaCalls.filter(c=>c.cmd==='write_pty').length);
 const localSearch=page.getByRole('button',{name:'Rechercher dans le terminal',exact:true});
 await localSearch.click();
 const localSearchInput=page.locator('.terminal-wrapper:not(.terminal-wrapper--hidden) .search-bar__input');
 await localSearchInput.fill('readability-check');
 await localSearchInput.press('Enter');
 await localSearchInput.press('Escape');
 await localSearchInput.waitFor({state:'detached'});
 await page.getByRole('button',{name:'Augmenter la taille',exact:true}).click();
 await page.waitForFunction(()=>window.__qaData.settings.fontSize===14);
 await page.getByRole('button',{name:'Reduire la taille',exact:true}).click();
 await page.waitForFunction(()=>window.__qaData.settings.fontSize===13);
 if(await page.evaluate(()=>window.__qaCalls.filter(c=>c.cmd==='write_pty').length)!==writesBefore) throw Error('Readability controls sent input to the PTY');
 if(JSON.stringify(await page.evaluate(()=>window.__qaCalls.filter(c=>['spawn_pty','kill_pty'].includes(c.cmd))))!==JSON.stringify(initialLifecycle)) throw Error('Readability controls changed PTY lifecycle');
 await page.evaluate(()=>window.__qaEmit('statusline-updated',JSON.stringify({context_pct:77,model:'Unscoped metric'})));
 if(await page.locator('.context-bar').count()) throw Error('Plain terminal displays global Claude context');
 await page.screenshot({path:`${output}/terminal-readability.png`,fullPage:true});
 const navigationBaseline=await page.evaluate(()=>window.__qaCalls.filter(c=>['spawn_pty','kill_pty'].includes(c.cmd)).length);
 for (const [before,after] of [['Review fixtures','Review fixtures renamed'],['Review fixtures renamed','Review fixtures']]) {
  // Inline actions appear on row hover, as they do with a real pointer.
  await page.getByTestId('session-item').filter({hasText:before}).hover();
  await page.getByRole('button',{name:`Actions de la session ${before}`,exact:true}).click();
  await page.getByRole('button',{name:'Renommer',exact:true}).click();
  const input=page.getByTestId('inline-rename-input');
  await input.waitFor();
  if(!await input.evaluate(el=>document.activeElement===el)) throw Error('Rename field lost focus after menu closure');
  await input.fill(after); await input.press('Enter');
  await page.waitForFunction(name=>window.__qaData.projects[0].sessions[0].name===name,after);
 }
 const menuOpener=page.getByRole('button',{name:'Actions de la session Review fixtures',exact:true});
 await page.getByTestId('session-item').filter({hasText:'Review fixtures'}).hover();
 await menuOpener.click(); await page.keyboard.press('Escape');
 await page.getByRole('menu').waitFor({state:'detached'});
 if(!await menuOpener.evaluate(el=>document.activeElement===el)) throw Error('Ordinary menu close did not restore opener focus');
 await page.getByRole('button',{name:'Épingler Review fixtures',exact:true}).click();
 await page.waitForFunction(()=>window.__qaData.projects[0].sessions[0].pinned===true);
 await page.getByRole('button',{name:'Replier QA Workspace',exact:true}).click();
 await page.getByRole('region',{name:'Épinglées',exact:true}).getByText('Review fixtures',{exact:true}).waitFor();
 await page.getByRole('searchbox').fill('Background task');
 await page.getByText('Background task',{exact:true}).waitFor();
 await page.getByRole('searchbox').fill('');
 await page.getByRole('button',{name:'Déplier QA Workspace',exact:true}).click();
 if(await page.evaluate(()=>window.__qaCalls.filter(c=>['spawn_pty','kill_pty'].includes(c.cmd)).length)!==navigationBaseline) throw Error('Pin/search/collapse changed PTY lifecycle');
 await page.evaluate(()=>{
  const launch=window.__qaCalls.find(c=>c.cmd==='spawn_pty'&&c.args.sessionId==='qa-terminal-1');
  window.__qaEmit('pty-input-error',{session_id:'qa-terminal-1',generation_id:launch.args.generationId});
 });
 await page.getByRole('alert').waitFor();
 await page.screenshot({path:`${output}/input-warning.png`,fullPage:true});
 await page.getByRole('button',{name:'Fermer',exact:true}).click();
 await page.getByRole('alert').waitFor({state:'detached'});
 await page.screenshot({path:`${output}/workspace.png`,fullPage:true});
 await page.getByRole('button',{name:/^À votre attention/}).click();
 await page.getByText('Background task',{exact:true}).waitFor();
 const search=page.getByRole('searchbox');
 await search.fill('absent-fixture');
 await page.getByText('Aucune session correspondante').waitFor();
 await search.fill('');
 await page.getByRole('button',{name:'Archiver Terminal checks',exact:true}).click();
 await page.getByRole('button',{name:'Confirmer l’archivage',exact:true}).click();
 await page.getByRole('button',{name:'Archives',exact:true}).click();
 await page.getByRole('button',{name:'Restaurer et ouvrir Terminal checks',exact:true}).click();
 await page.waitForFunction(()=>window.__qaCalls.filter(c=>c.cmd==='spawn_pty'&&c.args.sessionId==='qa-terminal-1').length>=2).catch(async error => {
  await page.screenshot({path:`${output}/restore-failure.png`,fullPage:true});
  console.error(JSON.stringify({errors, fixtureState:await page.evaluate(()=>({spawns:window.__qaCalls.filter(c=>c.cmd==='spawn_pty'),activePid:window.__qaData.activePid,activeSid:window.__qaData.activeSid,projects:window.__qaData.projects}))},null,2));
  throw error;
 });
 await page.waitForFunction(()=>window.__qaData.projects[0].sessions.find(s=>s.id==='qa-terminal-1').archivedAt===undefined);
 await page.getByRole('button',{name:'Projets',exact:true}).click();
 const macBrowser=await page.evaluate(()=>/mac/i.test(navigator.userAgent));
 if(macBrowser) {
  await page.locator('.terminal-wrapper:not(.terminal-wrapper--hidden) .xterm-helper-textarea').focus();
  await page.keyboard.press('Control+t');
  await page.waitForFunction(()=>window.__qaCalls.some(c=>c.cmd==='write_pty'&&c.args.data==='\u0014'));
  if(await page.evaluate(()=>window.__qaData.projects[0].sessions.length)!==2) throw Error('macOS Control+T was stolen from the native terminal');
 }
 await page.keyboard.press(macBrowser ? 'Meta+t' : 'Control+t');
 await page.waitForFunction(()=>window.__qaData.projects[0].sessions.length===3);
 await page.evaluate(()=>{
  const ts = Date.now();
  window.__qaEmit('session-state-changed',JSON.stringify({session_id:'qa-conversation',state:'working',ts}));
  window.__qaEmit('session-state-changed',JSON.stringify({session_id:'qa-conversation',state:'idle',ts:ts+1}));
 });
 await page.getByRole('button',{name:/^À votre attention/}).click();
 await page.getByRole('heading',{name:'Résultats non consultés',exact:true}).waitFor();
 await page.screenshot({path:`${output}/activity.png`,fullPage:true});
 await page.getByRole('button',{name:/QA Secondary.*Background task/}).click();
 await page.waitForFunction(()=>window.__qaData.activePid==='qa-project-2');
 await page.getByRole('button',{name:'Reessayer',exact:true}).click();
 await page.waitForFunction(()=>window.__qaCalls.some(c=>c.cmd==='spawn_pty'&&c.args.sessionId==='qa-agent-2'&&c.args.claudeSessionId==='qa-conversation-2'&&c.args.resumeMode===true&&c.args.dangerousMode===false));
 await page.reload();
 await page.getByTestId('sidebar').waitFor();
 await page.waitForFunction(()=>window.__qaData.activeSid==='qa-agent-2');
 await page.waitForFunction(()=>window.__qaData.projects[0].sessions[0].pinned===true);
 await page.getByRole('region',{name:'Épinglées',exact:true}).getByText('Review fixtures',{exact:true}).waitFor();
 if(await page.locator('.tab-bar').count()) throw Error('Duplicate project tab navigation remains');
 await page.locator('.terminal-wrapper:not(.terminal-wrapper--hidden)').waitFor();
 for (const width of [800,1280]) {
  await page.setViewportSize({width,height:850});
  await page.screenshot({path:`${output}/workspace-${width}.png`,fullPage:true});
 }
 const report={stage:'full-browser-smoke',checks:['global project/session navigation without duplicate tabs','context-menu rename retains focus and persists a background-session name','Escape restores menu opener focus','persistent pin survives reload','pin/search/collapse leave PTY lifecycle unchanged','input error event shows dismissible warning','cross-project activity','local search','confirmed archive','restore/open','terminal shortcut','unread results','failed-session retry reaches spawn with saved conversation and resolved normal mode','reload and remembered project','800/1280 viewport'],errors,requests};
 fs.writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
 await browser.close();
 if(errors.length||requests.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1)});
