// Exercise a new deployment in a browser that has cached incompatible old modules/data.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {resolve, extname} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const oldModules = ['app', 'engine', 'name-storage', 'story-storage', 'story-library'];
const requests = [];
let upgraded = false;
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/') upgraded = true;
  if (upgraded) requests.push(url.pathname + url.search);
  if (url.pathname === '/old-version') {
    response.setHeader('content-type', 'text/html');
    response.end(`<p id="ready"></p><script type="module">await Promise.all(${JSON.stringify(oldModules)}.map(name => import('/js/'+name+'.js')));
      await fetch('/data/plotto-mf.json').then(r=>r.json());document.getElementById('ready').textContent='Old assets cached';</script>`);
    return;
  }
  if (oldModules.some((name) => url.pathname === `/js/${name}.js`)) {
    response.setHeader('content-type', 'text/javascript');
    response.setHeader('cache-control', 'public, max-age=31536000, immutable');
    response.end('export const incompatibleOldVersion = true;');
    return;
  }
  if (url.pathname === '/data/plotto-mf.json' && !url.search) {
    response.setHeader('content-type', 'application/json');
    response.setHeader('cache-control', 'public, max-age=31536000, immutable');
    response.end('{"version":0}');
    return;
  }
  try {
    const path = resolve(root, `.${url.pathname === '/' ? '/index.html' : url.pathname}`);
    if (!path.startsWith(root)) throw new Error('Outside fixture');
    const mime = {'.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css'};
    response.setHeader('content-type', mime[extname(path)] || 'application/octet-stream');
    response.end(await readFile(path));
  } catch { response.statusCode = 404; response.end('Not found'); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({headless: true});
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${base}/old-version`, {waitUntil: 'domcontentloaded'});
  await page.getByText('Old assets cached').waitFor();
  await page.goto(base, {waitUntil: 'domcontentloaded'});
  await page.locator('#outline[aria-busy="false"] .main-stage .story-text').waitFor({timeout: 10000});
  assert.equal(await page.locator('#story-title').isEnabled(), true);
  await page.locator('summary').filter({hasText: 'Names & a starting conflict'}).click();
  await page.locator('#start-conflict').fill('813');
  await page.locator('#generate').click();
  await page.getByLabel('Name for SN (optional)', {exact: true}).fill('Alex');
  assert.match(await page.locator('.main-stage .story-text').innerText(), /son, Alex,/);
  assert.equal(requests.some((path) => /^\/js\//.test(path)), false);
  assert.ok(requests.some((path) => /^\/assets\/app\/engine\.[a-f0-9]{16}\.js$/.test(path)));
  assert.ok(requests.some((path) => /^\/data\/plotto-mf\.json\?v=[a-f0-9]{16}$/.test(path)));
  assert.deepEqual(errors, []);
  console.log('Cache-upgrade check passed: stale cached modules and data cannot hide the SN field or disable the story library.');
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
