// Isolated, mocked-native React/xterm QA. No real agents, preferences or HOME I/O.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.ORBIT_PLAYWRIGHT_MODULE || 'playwright');
const repo = path.resolve(__dirname, '../..');
const output = process.env.ORBIT_QA_OUTPUT || path.join(os.homedir(), '.hermes/cache/scratch/orbit-corrections/themes');
const port = process.env.ORBIT_THEME_PORT || '1483';
fs.mkdirSync(output, { recursive: true });
const copy = fs.mkdtempSync(path.join(output, 'source-'));
for (const item of ['src', 'public', 'index.html', 'package.json', 'vite.config.ts', 'tsconfig.json']) {
  if (fs.existsSync(path.join(repo, item))) fs.cpSync(path.join(repo, item), path.join(copy, item), { recursive: true });
}
fs.symlinkSync(path.join(repo, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
// Inspection-only reference, exclusively in the disposable copy; real xterm is not mocked.
const ptyFile = path.join(copy, 'src/features/terminal/hooks/usePTY.ts');
let source = fs.readFileSync(ptyFile, 'utf8');
assert(source.includes('termRef.current = term;'), 'xterm inspection anchor changed');
source = source.replace('termRef.current = term;', 'termRef.current = term; ((window as any).__qaTerms ??= {})[sessionId] = term;');
fs.writeFileSync(ptyFile, source);
const child = spawn(process.execPath, [path.join(repo, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', port, '--strictPort'], { cwd: copy, env: { ...process.env, HOME: copy, TAURI_DEV_HOST: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
child.stdout.on('data', d => serverLog += d); child.stderr.on('data', d => serverLog += d);
let browser;
(async () => {
  const url = `http://127.0.0.1:${port}`;
  for (let n = 0; ; n++) {
    if (child.exitCode !== null) throw Error(serverLog);
    try { if ((await fetch(url)).ok) break; } catch {}
    if (n > 100) throw Error(`Vite not ready: ${serverLog}`);
    await new Promise(r => setTimeout(r, 100));
  }
  browser = await chromium.launch({ headless: true, ...(process.env.ORBIT_CHROME_PATH ? { executablePath: process.env.ORBIT_CHROME_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 }, reducedMotion: 'reduce' });
  const errors = [], blocked = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname === '127.0.0.1' || u.protocol === 'data:') return route.continue();
    blocked.push(route.request().url()); return route.abort();
  });
  await page.addInitScript(() => {
    const fixture = { projects: [{ id: 'theme-project', name: 'Palette workspace', dir: '/disposable/theme-fixture', sessions: [
      { id: 'theme-a', name: 'Visible terminal', type: 'terminal' },
      { id: 'theme-b', name: 'Background terminal', type: 'terminal' }
    ] }], activePid: 'theme-project', activeSid: 'theme-a', settings: { theme: 'orbit', fontSize: 13, sidebarWidth: 280, analytics: false, autoUpdate: false, autoNotifications: false, statuslineAsked: true, language: 'en', defaultMode: 'normal', terminal: 'default', editor: 'vscode' } };
    window.__qaCalls = []; window.__qaData = fixture;
    const callbacks = new Map(), listeners = new Map(); let next = 1;
    window.__qaEmit = (event, payload) => { for (const id of listeners.get(event) || []) callbacks.get(id)?.({ event, payload, id }); };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
      transformCallback: cb => { const id = next++; callbacks.set(id, cb); return id; },
      unregisterCallback: id => callbacks.delete(id),
      invoke: async (cmd, args = {}) => {
        window.__qaCalls.push({ cmd, args });
        if (cmd === 'read_orbit_file') return JSON.stringify(window.__qaData);
        if (cmd === 'write_orbit_file') { window.__qaData = JSON.parse(args.data); return; }
        if (cmd === 'check_claude_installed' || cmd === 'has_statusline') return true;
        if (cmd === 'load_scrollback') return null;
        if (cmd === 'preview_list_files') return [{ name: 'theme.md', path: 'theme.md', kind: 'file' }];
        if (cmd === 'preview_read_file') return { name: 'theme.md', path: 'theme.md', kind: 'markdown', mime: 'text/markdown', modifiedAt: 1, content: '# Palette preview\n\nText and `inline code`\n\n```js\nconst answer = 42;\n```\n\n> Quoted text\n\n| Status | Value |\n|---|---|\n| OK | yes |' };
        if (cmd === 'plugin:event|listen') { const ids = listeners.get(args.event) || []; ids.push(args.handler); listeners.set(args.event, ids); return args.handler; }
        if (cmd === 'plugin:event|unlisten') return;
        // All invocations stay inside this explicit in-memory native boundary.
        if (['spawn_pty','resize_pty','kill_pty','save_scrollback','write_pty','enable_session_hooks','check_session_hooks','plugin:window|set_theme','plugin:window|set_background_color'].includes(cmd)) return null;
        throw Error(`Unmocked native command: ${cmd}`);
      }
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  });
  await page.goto(url);
  await page.getByTestId('sidebar').waitFor();
  // Palette assertions test final colors, not headless animation clock scheduling.
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  await page.waitForFunction(() => window.__qaTerms?.['theme-a']);
  await page.evaluate(async () => { const { useStore } = await import('/src/core/store.ts'); useStore.getState().setActiveSession('theme-b'); });
  await page.waitForFunction(() => window.__qaTerms?.['theme-b']);
  await page.evaluate(async () => { const { useStore } = await import('/src/core/store.ts'); useStore.getState().setActiveSession('theme-a'); });
  await page.waitForFunction(() => window.__qaCalls.filter(c => c.cmd === 'spawn_pty').length === 2);
  await page.evaluate(async () => { const { usePreviewStore } = await import('/src/features/preview/previewStore.ts'); usePreviewStore.getState().dispatch('theme-project', { type: 'file', path: 'theme.md' }); });
  await page.locator('.preview-pane .preview-markdown pre').waitFor();
  await page.evaluate(async () => {
    window.__qaEmit('pty-output', { session_id: 'theme-a', data: 'Native bytes: \x1b[31mred ANSI\x1b[0m \x1b[38;2;17;34;51mtruecolor\x1b[0m\r\n' });
    window.__qaEmit('pty-output', { session_id: 'theme-b', data: 'Hidden terminal keeps its buffer\r\n' });
    await new Promise(r => window.__qaTerms['theme-b'].write('', r));
    const { THEMES } = await import('/src/lib/themes.ts');
    window.__qaPalette = THEMES;
    // Render real FileContent plus representative body portals: same CSS contract outside .app.
    const ReactModule = await import('/node_modules/.vite/deps/react.js');
    const React = ReactModule.default ?? ReactModule;
    const client = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { createRoot } = client.default ?? client;
    const dom = await import('/node_modules/.vite/deps/react-dom.js');
    const { createPortal } = dom.default ?? dom;
    const { default: FileContent } = await import('/src/features/preview/FileContent.tsx');
    const host = document.createElement('div'); host.id = 'qa-portal-host'; document.body.append(host);
    createRoot(host).render(createPortal(React.createElement('div', { id: 'qa-surfaces', style: { position: 'fixed', right: 10, top: 60, width: 350, pointerEvents: 'none' } },
      React.createElement('div', { className: 'modal' }, 'Body portal', React.createElement(FileContent, { file: { kind: 'markdown', content: '# Palette preview\n\nText and `inline code`\n\n```js\nconst answer = 42;\n```\n\n> quoted text\n\n| Status | Value |\n|---|---|\n| OK | yes |', name: 'theme.md' }, path: 'theme.md', source: false, dispatch: () => {} })),
      React.createElement('div', { className: 'preview-error' }, 'Notification / warning tint'),
      React.createElement('iframe', { id: 'qa-external', srcDoc: '<body style="background:rgb(240,230,220);color:rgb(12,34,56)">External content</body>', style: { width: 350, height: 45 } }),
      React.createElement('img', { id: 'qa-image', src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=', width: 10, height: 10 })
    ), document.body));
  });
  await page.locator('#qa-surfaces .preview-markdown pre').waitFor();
  const keys = await page.evaluate(() => Object.keys(window.__qaPalette));
  fs.writeFileSync(path.join(output, 'inventory.json'), JSON.stringify({ keys, sourceCopy: copy, scope: 'real React frontend and real xterm, in-memory native mock', blockedExternalRequests: blocked }, null, 2));
  const baseline = await page.evaluate(() => {
    window.__qaTerminalSnapshot = t => ({
      font: [t.options.fontFamily, t.options.fontSize, t.options.lineHeight],
      lines: Array.from({ length: t.buffer.active.length }, (_, i) => {
        const line = t.buffer.active.getLine(i);
        return { text: line.translateToString(), cells: Array.from({length: line.length}, (_, x) => { const c = line.getCell(x); return [c.getFgColorMode(), c.getFgColor(), c.getBgColorMode(), c.getBgColor(), c.isBold(), c.isItalic()]; }) };
      })
    });
    window.__qaBuffer = Object.fromEntries(Object.entries(window.__qaTerms).map(([k, t]) => [k, JSON.stringify(window.__qaTerminalSnapshot(t))]));
    return window.__qaCalls.filter(c => ['spawn_pty','kill_pty','write_pty'].includes(c.cmd));
  });
  const reports = [];
  for (const key of keys) {
    // Exercise real preferences live preview, not only direct applyChrome calls.
    await page.evaluate(async () => { const { useStore } = await import('/src/core/store.ts'); useStore.getState().updateSettings({ theme: 'orbit' }); });
    await page.getByRole('button', { name: 'Preferences', exact: true }).click();
    await page.getByTestId('theme-select').selectOption(key);
    await page.waitForFunction(key => {
      const palette = window.__qaPalette[key];
      return document.documentElement.style.getPropertyValue('--bg') === palette.chrome.bg;
    }, key);
    // A screenshot drives a real paint (including CSS transitions) before sampling.
    await page.waitForFunction(key => {
      const c = window.__qaPalette[key].chrome.bg;
      const expected = `rgb(${c.slice(1).match(/../g).map(v => parseInt(v, 16)).join(', ')})`;
      return getComputedStyle(document.body).backgroundColor === expected;
    }, key);
    await page.screenshot({ path: path.join(output, `${key}-preferences.png`), fullPage: true });
    await page.waitForTimeout(60);
    const report = await page.evaluate(key => {
      const palette = window.__qaPalette[key]; const failures = [], surfaces = {}; let assertions = 0;
      surfaces.debug = ['.prefs', '#qa-surfaces .modal', '#qa-surfaces blockquote'].map(s => { const cs = getComputedStyle(document.querySelector(s)); return {selector:s,surface:cs.getPropertyValue('--surface'),borderBright:cs.getPropertyValue('--border-bright'),background:cs.backgroundColor,border:cs.borderLeftColor,animations:document.querySelector(s).getAnimations().map(a=>({playState:a.playState,time:a.currentTime}))}; });
      const eq = (label, actual, expected) => { assertions++; if (actual !== expected) failures.push(`${label}: ${actual} != ${expected}`); };
      const rgb = hex => `rgb(${hex.slice(1).match(/../g).map(v => parseInt(v,16)).join(', ')})`;
      const sample = (selector, property, expected) => { const el = document.querySelector(selector); if (!el) { failures.push(`Missing ${selector}`); return; } const value = getComputedStyle(el)[property]; surfaces[`${selector}:${property}`] = value; if (expected) eq(selector + property, value, expected); };
      sample('body','backgroundColor',rgb(palette.chrome.bg));
      sample('.sidebar','backgroundColor',rgb(palette.chrome.sidebarBg));
      sample('.status-bar','backgroundColor',rgb(palette.chrome.bg));
      sample('.prefs','backgroundColor',rgb(palette.terminal.background));
      sample('#qa-surfaces .modal','backgroundColor',rgb(palette.terminal.background));
      sample('#qa-surfaces pre','backgroundColor',rgb(palette.terminal.background));
      sample('#qa-surfaces blockquote','borderLeftColor',rgb(palette.terminal.selectionBackground));
      sample('.terminal-container','backgroundColor',rgb(palette.terminal.background));
      sample('.preview-pane','backgroundColor',rgb(palette.chrome.codeBg));
      sample('.preview-pane .preview-markdown pre','backgroundColor',rgb(palette.terminal.background));
      sample('.preview-pane .preview-markdown','color',rgb(palette.chrome.textBright));
      sample('.preview-pane .preview-markdown th','backgroundColor',rgb(palette.terminal.background));
      sample('#qa-surfaces .preview-error','backgroundColor',`rgba(${palette.chrome.yellow.slice(1).match(/../g).map(v => parseInt(v,16)).join(', ')}, 0.1)`);
      const root = getComputedStyle(document.documentElement);
      for (const variable of ['--font-ui','--ui-line','--ui-muted','--ui-selection']) if (!root.getPropertyValue(variable).trim()) failures.push(`Body portals missing ${variable}`);
      eq('native controls',root.colorScheme,key === 'orbit-light' ? 'light' : 'dark');
      for (const [id, term] of Object.entries(window.__qaTerms)) {
        for (const [name, value] of Object.entries(palette.terminal)) eq(`${id}.${name}`, term.options.theme[name],value);
        eq(`${id} unchanged text/ANSI attributes/font`,JSON.stringify(window.__qaTerminalSnapshot(term)),window.__qaBuffer[id]);
      }
      const frame = document.querySelector('#qa-external');
      eq('external page',getComputedStyle(frame.contentDocument.body).backgroundColor,'rgb(240, 230, 220)');
      eq('image filter',getComputedStyle(document.querySelector('#qa-image')).filter,'none');
      return { key, palette, surfaces, assertions, failures, hiddenTerminals: document.querySelectorAll('.terminal-wrapper--hidden').length, nativeCalls: window.__qaCalls.filter(c => ['spawn_pty','kill_pty','write_pty'].includes(c.cmd)) };
    }, key);
    assert.deepEqual(report.nativeCalls, baseline, 'theme preview changed PTY lifecycle/input');
    fs.writeFileSync(path.join(output, `${key}.json`), JSON.stringify(report, null, 2)); reports.push(report);
    if (['orbit', 'orbit-light'].includes(key)) await page.screenshot({ path: path.join(output, `${key}.png`), fullPage: true });
    await page.keyboard.press('Escape');
    await page.getByTestId('preferences-modal').waitFor({ state: 'detached' });
    const reverted = await page.evaluate(() => Object.values(window.__qaTerms).every(t => t.options.theme.background === window.__qaPalette.orbit.terminal.background));
    assert(reverted, 'Cancel did not restore terminal palette');
    // Verify committed path independently of transient preview.
    await page.evaluate(async key => { const { useStore } = await import('/src/core/store.ts'); useStore.getState().updateSettings({ theme: key }); }, key);
    await page.waitForTimeout(50);
    await page.getByTestId('session-item').filter({ hasText: 'Visible terminal' }).hover();
    await page.getByRole('button', { name: 'Actions for session Visible terminal', exact: true }).click();
    const menu = await page.locator('.context-menu').evaluate(el => ({ background: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderTopColor }));
    assert.equal(menu.background, `rgb(${report.palette.terminal.background.slice(1).match(/../g).map(v=>parseInt(v,16)).join(', ')})`);
    await page.keyboard.press('Escape');
    await page.locator('.preview-file-modes').getByRole('button', { name: 'Source', exact: true }).click();
    const sourceColor = await page.locator('.preview-source').evaluate(el => getComputedStyle(el).color);
    assert.equal(sourceColor, `rgb(${report.palette.chrome.textBright.slice(1).match(/../g).map(v=>parseInt(v,16)).join(', ')})`);
    await page.locator('.preview-file-modes').getByRole('button', { name: 'Preview', exact: true }).click();
    report.committed = { menu, sourceColor, cancelRestoredTerminalPalette: reverted, lifecycleUnchanged: true };
    fs.writeFileSync(path.join(output, `${key}.json`), JSON.stringify(report, null, 2));
    if (['orbit', 'orbit-light'].includes(key)) {
      await page.locator('#qa-surfaces').evaluate(el => el.style.visibility = 'hidden');
      await page.screenshot({ path: path.join(output, `${key}-workspace.png`), fullPage: true });
      await page.locator('#qa-surfaces').evaluate(el => el.style.visibility = 'visible');
    }
  }
  const summary = { themes: reports.length, keys, failures: reports.flatMap(r => r.failures.map(message => ({ theme: r.key, message }))), errors, blockedExternalRequests: blocked, sourceCopy: copy };
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  assert.equal(reports.length, keys.length); assert.deepEqual(summary.failures, []); assert.deepEqual(errors, []);
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { await browser?.close(); child.kill('SIGTERM'); fs.writeFileSync(path.join(output, 'vite.log'), serverLog); });
