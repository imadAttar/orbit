const { chromium } = require(process.env.ORBIT_PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const output = process.env.ORBIT_QA_OUTPUT || 'qa-output';
fs.mkdirSync(output, { recursive: true });
(async () => {
 const browser = await chromium.launch({headless:true});
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
 await page.screenshot({path:`${output}/workspace.png`,fullPage:true});
 await page.getByRole('button',{name:'Activité',exact:true}).click();
 await page.getByText('Background task',{exact:true}).waitFor();
 const search=page.getByRole('searchbox');
 await search.fill('absent-fixture');
 await page.getByText('Aucune session correspondante').waitFor();
 await search.fill('');
 await page.getByRole('button',{name:'Archiver Terminal checks',exact:true}).click();
 await page.getByRole('button',{name:'Confirmer l’archivage',exact:true}).click();
 await page.getByRole('button',{name:'Archives',exact:true}).click();
 await page.getByRole('button',{name:'Restaurer et ouvrir Terminal checks',exact:true}).click();
 await page.waitForFunction(()=>window.__qaCalls.filter(c=>c.cmd==='spawn_pty'&&c.args.sessionId==='qa-terminal-1').length>=2);
 await page.waitForFunction(()=>window.__qaData.projects[0].sessions.find(s=>s.id==='qa-terminal-1').archivedAt===undefined);
 await page.getByRole('button',{name:'Sessions',exact:true}).click();
 await page.keyboard.press('Control+t');
 await page.waitForFunction(()=>window.__qaData.projects[0].sessions.length===3);
 await page.evaluate(()=>{
  const ts = Date.now();
  window.__qaEmit('session-state-changed',JSON.stringify({session_id:'qa-conversation',state:'working',ts}));
  window.__qaEmit('session-state-changed',JSON.stringify({session_id:'qa-conversation',state:'idle',ts:ts+1}));
 });
 await page.getByRole('button',{name:'Activité',exact:true}).click();
 await page.getByRole('heading',{name:'Résultats non consultés',exact:true}).waitFor();
 await page.screenshot({path:`${output}/activity.png`,fullPage:true});
 await page.getByRole('button',{name:/QA Secondary.*Background task/}).click();
 await page.waitForFunction(()=>window.__qaData.activePid==='qa-project-2');
 await page.getByRole('button',{name:'Reessayer',exact:true}).click();
 await page.waitForFunction(()=>window.__qaCalls.some(c=>c.cmd==='spawn_pty'&&c.args.sessionId==='qa-agent-2'&&c.args.claudeSessionId==='qa-conversation-2'&&c.args.resumeMode===true&&c.args.dangerousMode===false));
 await page.reload();
 await page.getByTestId('sidebar').waitFor();
 await page.waitForFunction(()=>window.__qaData.activeSid==='qa-agent-2');
 for (const width of [800,1280]) {
  await page.setViewportSize({width,height:850});
  await page.screenshot({path:`${output}/workspace-${width}.png`,fullPage:true});
 }
 console.log(JSON.stringify({stage:'full-browser-smoke',checks:['cross-project activity','local search','confirmed archive','restore/open','terminal shortcut','unread results','failed-session retry reaches spawn with saved conversation and resolved normal mode','reload and remembered project','800/1280 viewport'],errors,requests},null,2));
 await browser.close();
 if(errors.length||requests.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1)});
