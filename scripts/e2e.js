/**
 * End-to-end test: loads the real extension into a real Chrome and drives it
 * over the DevTools Protocol. No dependencies - Node 22 has a global WebSocket.
 *
 * This is the test that unit tests and fixtures cannot do: it proves the
 * manifest parses, the service worker registers and survives, the content
 * script is injected, the message round-trip works, and a form actually gets
 * filled by the extension rather than by a script pretending to be one.
 *
 *   npm run e2e            headless
 *   npm run e2e -- --head  watch it happen
 *
 * The extension is staged into a temp directory with one change: the fixture
 * origin is added to content_scripts.matches and host_permissions, because the
 * shipped manifest only lists real ATS domains. That is exactly what the
 * per-site permission flow grants at runtime.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.CDP_PORT || 9333);
const FIXTURE_ORIGIN = process.env.FIXTURE_ORIGIN || 'http://localhost:5173';
const HEADFUL = process.argv.includes('--head');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find((p) => { try { return fs.existsSync(p); } catch { return false; } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`  ${mark}  ${name}${detail ? `  -- ${detail}` : ''}`);
  return ok;
}

// ---------------------------------------------------------------------------
// staging
// ---------------------------------------------------------------------------

function stageExtension() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'applyr-ext-'));
  const copy = (rel) => {
    const from = path.join(ROOT, rel);
    const to = path.join(dir, rel);
    const stat = fs.statSync(from);
    if (stat.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      for (const child of fs.readdirSync(from)) copy(path.join(rel, child));
    } else {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  };
  copy('manifest.json');
  copy('icons');
  copy('src');

  const mfPath = path.join(dir, 'manifest.json');
  const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
  const origin = `${FIXTURE_ORIGIN}/*`;
  mf.host_permissions.push(origin);
  mf.content_scripts[0].matches.push(origin);
  fs.writeFileSync(mfPath, JSON.stringify(mf, null, 2));
  return dir;
}

// ---------------------------------------------------------------------------
// minimal CDP client
// ---------------------------------------------------------------------------

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data || '')})`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error(`cannot connect to ${url}`)), { once: true });
    });
    return new CDP(ws);
  }

  on(fn) { this.listeners.push(fn); }

  send(method, params = {}, sessionId) {
    this.id += 1;
    const id = this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 20000);
    });
  }

  /** Evaluate in an attached target and return the value. */
  async evaluate(sessionId, expression) {
    const res = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true
    }, sessionId);
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    }
    return res.result.value;
  }

  close() { try { this.ws.close(); } catch { /* already gone */ } }
}

async function httpJSON(url) {
  const res = await fetch(url);
  return res.json();
}

async function waitForEndpoint(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      return await httpJSON(`http://127.0.0.1:${PORT}/json/version`);
    } catch {
      await sleep(250);
    }
  }
  throw new Error('Chrome never opened its debugging port');
}

async function findTarget(predicate, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const list = await httpJSON(`http://127.0.0.1:${PORT}/json/list`);
    const hit = list.find(predicate);
    if (hit) return hit;
    await sleep(250);
  }
  return null;
}

// ---------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------

const DEMO = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/demo-profile.json'), 'utf8'));

async function main() {
  if (!CHROME) throw new Error('Chrome not found');

  // Fixtures must be served; content scripts do not run on file:// URLs.
  try {
    await fetch(`${FIXTURE_ORIGIN}/fixtures/index.html`);
  } catch {
    throw new Error(`fixture server not reachable at ${FIXTURE_ORIGIN} - run "npm run serve" first`);
  }

  const extDir = stageExtension();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'applyr-profile-'));
  console.log(`\nextension: ${extDir}\nchrome:    ${CHROME}\n`);

  // Chrome 137+ ignores --load-extension entirely, so the extension is installed
  // over the DevTools Protocol instead. That needs the debugging opt-in flag.
  const args = [
    `--user-data-dir=${profileDir}`,
    '--enable-unsafe-extension-debugging',
    `--remote-debugging-port=${PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-search-engine-choice-screen',
    'about:blank'
  ];
  if (!HEADFUL) args.unshift('--headless=new');

  const chrome = spawn(CHROME, args, { stdio: 'ignore' });
  let cdp = null;
  let aborted = null;

  const cleanup = () => {
    try { cdp?.close(); } catch { /* noop */ }
    try { chrome.kill(); } catch { /* noop */ }
    try { fs.rmSync(extDir, { recursive: true, force: true }); } catch { /* noop */ }
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* noop */ }
  };

  try {
    const version = await waitForEndpoint();
    console.log(`${version.Browser}\n`);
    console.log('--- extension loads ---');

    const browser = await httpJSON(`http://127.0.0.1:${PORT}/json/version`);
    cdp = await CDP.connect(browser.webSocketDebuggerUrl);
    await cdp.send('Target.setDiscoverTargets', { discover: true });

    // 1. install -----------------------------------------------------------
    let extId = null;
    try {
      ({ id: extId } = await cdp.send('Extensions.loadUnpacked', { path: extDir }));
    } catch (err) {
      check('extension installs', false, err.message);
      throw new Error('Extensions.loadUnpacked failed');
    }
    check('extension installs from the shipped manifest', Boolean(extId), extId);

    // Chrome ships component extensions with their own workers, so match on ours.
    const swTarget = await findTarget((t) => (
      t.type === 'service_worker' && t.url.includes(extId)
    ));
    if (!check('service worker registered', Boolean(swTarget),
      swTarget ? 'src/background/service-worker.js' : 'no service_worker target appeared')) {
      throw new Error('service worker never started');
    }

    const welcome = await findTarget((t) => t.url.includes('onboarding/welcome.html'), 12);
    check('onInstalled opens the welcome page', Boolean(welcome),
      welcome ? 'welcome.html' : 'no welcome tab');

    const { sessionId: sw } = await cdp.send('Target.attachToTarget', {
      targetId: swTarget.id, flatten: true
    });
    await cdp.send('Runtime.enable', {}, sw);

    check('service worker has no startup exception',
      await cdp.evaluate(sw, 'return typeof chrome.runtime.id === "string";'),
      `id ${extId}`);

    if (process.env.E2E_DEBUG) {
      console.log('  chrome namespaces:', await cdp.evaluate(sw, 'return Object.keys(chrome).sort().join(",");'));
      console.log('  manifest perms:', await cdp.evaluate(sw, 'return JSON.stringify(chrome.runtime.getManifest().permissions);'));
    }

    check('storage API reachable from the worker',
      await cdp.evaluate(sw, 'await chrome.storage.local.set({__probe:1}); const r = await chrome.storage.local.get("__probe"); await chrome.storage.local.remove("__probe"); return r.__probe === 1;'));

    // 2. seed the demo profile through the real storage layer ---------------
    // Note: a service worker cannot sendMessage to itself, so anything that
    // exercises the message router is driven from the side panel below.
    const seeded = await cdp.evaluate(sw, `
      const bundle = ${JSON.stringify(DEMO)};
      const store = globalThis.__applyr.store;
      await store.importAll(bundle, { merge: false });
      const p = await store.getProfile();
      const files = await store.listFiles();
      const memory = await store.allMemory();
      if (files[0]) await store.patchSettings({ defaultResumeId: files[0].id });
      return { values: Object.keys(p.values).length, files: files.length, memory: memory.length };
    `);
    check('demo profile imports (profile, resume, saved answers)',
      seeded.values > 20 && seeded.files === 1 && seeded.memory === 4,
      `${seeded.values} values, ${seeded.files} file, ${seeded.memory} answers`);

    // 3. side panel document loads -----------------------------------------
    console.log('\n--- side panel ---');
    const panelUrl = `chrome-extension://${extId}/src/sidepanel/panel.html`;
    const { targetId: panelId } = await cdp.send('Target.createTarget', { url: panelUrl });
    const { sessionId: panel } = await cdp.send('Target.attachToTarget', { targetId: panelId, flatten: true });
    await cdp.send('Runtime.enable', {}, panel);
    await sleep(1500);

    const panelState = await cdp.evaluate(panel, `
      return {
        tabs: document.querySelectorAll('#tabs button').length,
        view: document.getElementById('view').textContent.trim().slice(0, 40),
        title: document.title
      };
    `);
    check('panel renders its navigation', panelState.tabs === 6, `${panelState.tabs} tabs`);
    check('message router answers get-state from the panel',
      await cdp.evaluate(panel, 'const r = await chrome.runtime.sendMessage({type:"get-state"}); return Boolean(r && r.ok && r.profile && r.files.length === 1);'));

    check('panel renders a view without crashing',
      !/View error/.test(panelState.view) && panelState.view.length > 0,
      panelState.view.slice(0, 32));

    // 4. content script on a fixture ---------------------------------------
    console.log('\n--- content script + fill ---');
    const fixture = `${FIXTURE_ORIGIN}/fixtures/greenhouse-like.html`;
    const { targetId: pageId } = await cdp.send('Target.createTarget', { url: fixture });
    const { sessionId: page } = await cdp.send('Target.attachToTarget', { targetId: pageId, flatten: true });
    await cdp.send('Runtime.enable', {}, page);
    await sleep(2500);

    // Content scripts run in an isolated world, so a window global set by the
    // loader is invisible from the page's main world. Pinging it is the only
    // honest injection test.
    const ping = await cdp.evaluate(sw, `
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(t => t.url && t.url.includes('greenhouse-like'));
      try { return await chrome.tabs.sendMessage(tab.id, { type: 'ping' }); }
      catch (e) { return { error: e.message }; }
    `);
    check('content script injected and answering', Boolean(ping && ping.ok),
      ping && ping.ok ? `${ping.fields} fields, pack=${ping.pack}` : String(ping && ping.error));

    const scanState = await cdp.evaluate(sw, `
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(t => t.url && t.url.includes('greenhouse-like'));
      if (!tab) return { error: 'tab not found' };
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'scan' });
      return { tabId: tab.id, pack: res && res.pack, fields: res && res.fieldCount, isApp: res && res.isApplication };
    `);
    check('scan reports the form', scanState.fields > 5,
      `${scanState.fields} fields, pack=${scanState.pack || 'generic'}, isApplication=${scanState.isApp}`);

    const fill = await cdp.evaluate(sw, `
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(t => t.url && t.url.includes('greenhouse-like'));
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'fill' });
      return res;
    `);
    check('fill round-trip completes', Boolean(fill && fill.ok),
      fill && fill.counts ? `${fill.counts.filled} filled, ${fill.counts.attention} to check, ${fill.counts.unresolved} unknown` : String(fill && fill.reason));

    // 5. did the DOM actually change? --------------------------------------
    const dom = await cdp.evaluate(page, `
      const v = id => (document.getElementById(id) || {}).value || '';
      const radio = name => { const el = [...document.querySelectorAll('input[name="'+name+'"]:checked')][0]; return el ? el.parentElement.textContent.trim() : ''; };
      return {
        first: v('first_name'), last: v('last_name'), email: v('email'), phone: v('phone'),
        resume: (document.getElementById('resume').files[0] || {}).name || '',
        hear: document.getElementById('hear_control').textContent.trim(),
        auth: radio('work_authorization'),
        sponsor: radio('sponsorship'),
        gender: v('job_application_gender'),
        rings: document.querySelectorAll('.applyr-ring-ok').length,
        hud: Boolean(document.getElementById('applyr-hud-host'))
      };
    `);
    check('text fields filled from the profile',
      dom.first === 'Ada' && dom.last === 'Lovelace' && dom.email === 'ada.lovelace@example.com',
      `${dom.first} ${dom.last} <${dom.email}> ${dom.phone}`);
    const fileRow = (fill.results || []).find(r => r.kind === 'file');
    check('resume attached via DataTransfer', dom.resume.endsWith('.pdf'),
      dom.resume || `no file; engine reported ${fileRow ? `${fileRow.outcome} - ${fileRow.detail}` : 'no file field in the plan'}`);
    check('custom dropdown committed', dom.hear === 'LinkedIn', dom.hear);
    check('radio groups answered', /Yes|No/.test(dom.auth) && /Yes|No/.test(dom.sponsor),
      `work auth=${dom.auth}, sponsorship=${dom.sponsor}`);
    check('demographic select left alone by default', dom.gender === '',
      dom.gender ? `FILLED "${dom.gender}" - opt-in gate leaked` : 'empty, as configured');
    check('in-page HUD mounted', dom.hud);
    check('filled fields are ringed', dom.rings > 0, `${dom.rings} rings`);

    // 6. tracker ------------------------------------------------------------
    console.log('\n--- tracker ---');
    const apps = await cdp.evaluate(sw, `
      const apps = await globalThis.__applyr.store.listApplications();
      return apps.map(a => ({ company: a.company, role: a.role, status: a.status, fields: a.fieldsFilled }));
    `);
    check('application logged automatically', apps.length === 1,
      apps.length ? `${apps[0].role} @ ${apps[0].company} [${apps[0].status}]` : 'nothing logged');

    // 7. re-fill must not duplicate the tracker entry -----------------------
    await cdp.evaluate(sw, `
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(t => t.url && t.url.includes('greenhouse-like'));
      await chrome.tabs.sendMessage(tab.id, { type: 'fill' });
      return true;
    `);
    await sleep(600);
    const apps2 = await cdp.evaluate(sw, 'const apps = await globalThis.__applyr.store.listApplications(); return apps.map(a => a.url);');
    check('re-filling does not duplicate the tracker entry', apps2.length === 1,
      `${apps2.length} entries: ${JSON.stringify(apps2)}`);

    // 8. generic mode on a site with no pack --------------------------------
    console.log('\n--- generic mode ---');
    const generic = `${FIXTURE_ORIGIN}/fixtures/generic-unknown.html`;
    const { targetId: gid } = await cdp.send('Target.createTarget', { url: generic });
    const { sessionId: gpage } = await cdp.send('Target.attachToTarget', { targetId: gid, flatten: true });
    await cdp.send('Runtime.enable', {}, gpage);
    await sleep(2200);

    const gfill = await cdp.evaluate(sw, `
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(t => t.url && t.url.includes('generic-unknown'));
      return await chrome.tabs.sendMessage(tab.id, { type: 'fill' });
    `);
    const pct = gfill && gfill.counts
      ? Math.round((gfill.counts.filled / gfill.counts.total) * 100) : 0;
    check('generic mode fills an unknown ATS', pct >= 70,
      `${pct}% (${gfill?.counts?.filled}/${gfill?.counts?.total})`);

    // The fixture carries a real BambooHR honeypot: visible, normal-sized, and
    // named so that it matches the taxonomy's preferred_name pattern. Filling it
    // tells the employer a bot submitted the application.
    const honeypot = await cdp.evaluate(gpage, `
      const el = document.getElementById('nickname_hpcsaf');
      return { value: el ? el.value : null, seen: (window.__x = 0, true) };
    `);
    check('honeypot left empty', honeypot.value === '',
      honeypot.value === '' ? 'untouched' : `FILLED WITH "${honeypot.value}"`);
    check('honeypot never entered the fill plan',
      !(gfill.results || []).some((r) => /nickname|leave this field blank/i.test(`${r.label} ${r.key}`)),
      `${gfill?.counts?.total} fields planned, honeypot excluded`);

    // 9. Workday: the account gate, then the wizard step --------------------
    console.log('\n--- workday wizard ---');
    const wd = `${FIXTURE_ORIGIN}/fixtures/workday-like.html`;
    const { targetId: wdId } = await cdp.send('Target.createTarget', { url: wd });
    const { sessionId: wdPage } = await cdp.send('Target.attachToTarget', { targetId: wdId, flatten: true });
    await cdp.send('Runtime.enable', {}, wdPage);
    await sleep(2200);

    const gate = await cdp.evaluate(sw, `
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(t => t.url && t.url.includes('workday-like'));
      return await chrome.tabs.sendMessage(tab.id, { type: 'scan' });
    `);
    check('account gate is not treated as an application', gate && gate.isApplication === false,
      `isApplication=${gate && gate.isApplication}, pack=${gate && gate.pack}`);
    check('wizard step is reported', Boolean(gate && gate.step),
      gate && gate.step ? `step ${gate.step.current} of ${gate.step.total}` : 'no step read');

    // Filling the gate must be refused even if asked directly.
    const gateFill = await cdp.evaluate(sw, `
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(t => t.url && t.url.includes('workday-like'));
      await chrome.tabs.sendMessage(tab.id, { type: 'fill' });
      return true;
    `);
    const gateState = await cdp.evaluate(wdPage, `
      return {
        email: (document.getElementById('wd-email') || {}).value || '',
        pass: (document.getElementById('wd-pass') || {}).value || ''
      };
    `);
    check('credentials screen left untouched', gateState.email === '' && gateState.pass === '',
      gateState.email || gateState.pass ? `email="${gateState.email}" password set=${Boolean(gateState.pass)}` : 'nothing written');

    // Advance past the gate; the form step replaces it with no page load.
    await cdp.evaluate(wdPage, "document.getElementById('continue').click(); return true;");
    await sleep(1800);

    const wdFill = await cdp.evaluate(sw, `
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(t => t.url && t.url.includes('workday-like'));
      return await chrome.tabs.sendMessage(tab.id, { type: 'fill' });
    `);
    check('workday step fills', Boolean(wdFill && wdFill.ok && wdFill.counts.filled >= 6),
      wdFill && wdFill.counts ? `${wdFill.counts.filled} filled, ${wdFill.counts.attention} to check` : 'fill failed');

    const wdDom = await cdp.evaluate(wdPage, `
      const v = (aid) => { const el = document.querySelector('[data-automation-id="' + aid + '"]'); return el ? el.value : null; };
      return {
        first: v('legalNameSection_firstName'), last: v('legalNameSection_lastName'),
        city: v('addressSection_city'), postal: v('addressSection_postalCode'),
        phone: v('phone-number'),
        country: (document.getElementById('wd-country') || {}).textContent || '',
        month: v('dateSectionMonth-input'), day: v('dateSectionDay-input'), year: v('dateSectionYear-input')
      };
    `);
    check('workday data-automation-id fields fill', wdDom.first === 'Ada' && wdDom.last === 'Lovelace' && wdDom.city === 'Bengaluru',
      `${wdDom.first} ${wdDom.last}, ${wdDom.city} ${wdDom.postal}`);
    check('workday dropdown commits', /India/.test(wdDom.country), wdDom.country.trim());
    check('split date fills across all three boxes',
      wdDom.month === '11' && wdDom.day === '02' && wdDom.year === '2026',
      `${wdDom.month}/${wdDom.day}/${wdDom.year}`);

    // 10. service worker survives a restart ---------------------------------
    console.log('\n--- worker lifecycle ---');
    const persisted = await cdp.evaluate(sw, `
      const p = await globalThis.__applyr.store.getProfile();
      return p.values.email;
    `);
    check('profile persists across the session', persisted === 'ada.lovelace@example.com', persisted);

  } catch (err) {
    aborted = err;
  } finally {
    const failed = results.filter((r) => !r.ok);
    if (aborted) {
      console.log(`\nABORTED after ${results.length} checks: ${aborted.message}`);
      if (aborted.stack) console.log(aborted.stack.split('\n').slice(1, 4).join('\n'));
    }
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length) {
      console.log('\nfailures:');
      for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
    }
    cleanup();
    process.exit(failed.length || aborted ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(`\nE2E ABORTED: ${err.message}`);
  process.exit(1);
});
