// Browser integration against the built application with an explicit fake native transport.
// No Claude process or provider request is started by this test.
const { chromium } = require(process.env.ORBIT_PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = process.env.ORBIT_QA_OUTPUT || 'qa-output-supervision';
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.ORBIT_CHROME_PATH ? { executablePath: process.env.ORBIT_CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
    const errors = [];
    const providerRequests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => { if (/api\.anthropic\.com|api\.openai\.com|aptabase/.test(request.url())) providerRequests.push(request.url()); });
    // Share the existing workspace fixture exactly, including native event dispatch.
    const workspace = fs.readFileSync(path.join(__dirname, 'workspace-smoke.cjs'), 'utf8');
    const fixture = workspace.split('await page.addInitScript(() => {')[1]?.split('\n });')[0];
    assert(fixture, 'Workspace fixture boundaries must be present');
    await page.addInitScript({ content: `(() => {${fixture}\n})()` });
    await page.goto(process.env.ORBIT_QA_URL || 'http://127.0.0.1:1437');
    await page.getByTestId('sidebar').waitFor();
    await page.waitForFunction(() => window.__qaCalls.some((c) => c.cmd === 'spawn_pty' && c.args.sessionId === 'qa-terminal-1'));
    const lifecycle = () => page.evaluate(() => window.__qaCalls.filter((c) => ['spawn_pty', 'kill_pty'].includes(c.cmd)).map((c) => ({ cmd: c.cmd, id: c.args.sessionId })));
    const before = await lifecycle();
    await page.getByRole('button', { name: 'Supervision', exact: true }).click();
    await page.getByRole('heading', { name: 'Supervision', exact: true }).waitFor();
    await page.evaluate(() => {
      const ts = Date.now(); window.__subagentTs = ts;
      const emit = (data) => window.__qaEmit('session-state-changed', JSON.stringify(data));
      emit({ session_id: 'qa-conversation', state: 'working', tool: 'Read', ts });
      emit({ session_id: 'qa-conversation', hook_event_name: 'SubagentStart', agent_id: 'observed-child-a', agent_type: 'Explore', ts: ts + 1 });
      emit({ session_id: 'qa-conversation', state: 'idle', ts: ts + 2 });
      // A failed parent's late child must not reappear as a running agent.
      emit({ session_id: 'qa-conversation-2', hook_event_name: 'SubagentStart', agent_id: 'foreign-late-child', agent_type: 'Must not appear', ts: ts + 3 });
    });
    const parent = page.locator('.supervision__session').filter({ has: page.getByRole('button', { name: 'Ouvrir Review fixtures — QA Workspace', exact: true }) });
    await parent.locator('.supervision__status').getByText('En cours', { exact: true }).waitFor();
    await parent.locator('summary').click();
    await parent.getByText('Explore', { exact: true }).waitFor();
    assert.equal(await page.getByText('Must not appear', { exact: true }).count(), 0);
    await page.screenshot({ path: `${output}/subagents-running.png`, fullPage: true });
    await page.evaluate(() => {
      const emit = (data) => window.__qaEmit('session-state-changed', JSON.stringify(data));
      const ts = window.__subagentTs;
      emit({ session_id: 'qa-conversation', hook_event_name: 'SubagentStop', agent_id: 'observed-child-a', agent_type: 'Explore', ts: ts + 4 });
      emit({ session_id: 'qa-conversation', hook_event_name: 'SubagentStart', agent_id: 'observed-child-a', agent_type: 'Explore', ts: ts + 1 });
    });
    await parent.getByText('Arrêt observé', { exact: true }).waitFor();
    // The genuine parent Stop was deferred until its final child stopped.
    // The result must now be unread, not silently return to idle.
    await parent.locator('.supervision__status').getByText('Résultat à lire', { exact: true }).waitFor();
    await page.getByRole('button', { name: /^À traiter/ }).click();
    assert.equal(await page.getByRole('button', { name: 'Ouvrir Review fixtures — QA Workspace', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Ouvrir Background task — QA Secondary', exact: true }).waitFor();
    await page.getByRole('button', { name: /^Toutes/ }).click();
    const search = page.locator('.supervision input[type="search"]');
    await search.fill('absent-fixture');
    await page.locator('.supervision').getByText('Aucune session correspondante', { exact: true }).waitFor();
    await search.fill('');
    await page.getByRole('button', { name: 'Ouvrir Terminal checks — QA Workspace', exact: true }).click();
    await page.getByRole('button', { name: 'Supervision', exact: true }).click();
    assert.deepEqual(await lifecycle(), before, 'Supervision navigation must not respawn/kill existing terminals');
    for (const width of [800, 1280]) {
      await page.setViewportSize({ width, height: 850 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'No horizontal document overflow');
      await page.screenshot({ path: `${output}/supervision-${width}.png`, fullPage: true });
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(providerRequests, []);
    const report = { stage: 'claude-supervision-browser', transport: 'explicit native fixture; no real Claude inference', checks: ['cross-project supervision', 'live child keeps idle parent active', 'child is scoped to parent', 'failed parent ignores late children', 'observed stop is not success', 'old child start cannot resurrect stopped child', 'attention filter', 'local search', 'navigation preserves PTY lifecycle', '800/1280 layout'], errors, providerRequests };
    fs.writeFileSync(`${output}/supervision-report.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exit(1); });
