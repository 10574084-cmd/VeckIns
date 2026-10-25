// Abre veck.io en un Chromium sin pantalla, con veck_steve.user.js inyectado, y guarda todo lo que ve:
// los archivos JS/HTML/JSON que baja el juego, capturas, y el diagnostico del script.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const OUT = 'out', FILES = path.join(OUT, 'files');
fs.mkdirSync(FILES, { recursive: true });
const log = (...a) => { const s = a.join(' '); console.log(s); fs.appendFileSync(path.join(OUT, 'log.txt'), s + '\n'); };
const script = fs.readFileSync('veck_steve.user.js', 'utf8');

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(script);
const page = await ctx.newPage();
page.on('console', (m) => log('[consola]', m.type(), m.text().slice(0, 300)));
page.on('pageerror', (e) => log('[error de pagina]', String(e).slice(0, 300)));

const reqs = [];
page.on('response', async (r) => {
  try {
    const u = r.url(); reqs.push(r.status() + ' ' + u);
    const ct = (r.headers()['content-type'] || '');
    if (!/javascript|html|json|wasm|text\/plain|octet-stream/.test(ct) && !/\.(js|json|wasm|data|html)(\?|$)/.test(u)) return;
    const buf = await r.body(); if (buf.length > 40e6) return;
    const name = u.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 150);
    fs.writeFileSync(path.join(FILES, name), buf);
  } catch (e) {}
});

const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') }).catch(() => {});
await page.goto('https://veck.io/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => log('goto', e.message));
await page.waitForTimeout(10000); await shot('01_inicio');

// intenta pasar menus y entrar a una partida
const labels = /^(play|play now|jugar|start|guest|play as guest|continue|ok|accept|agree|got it|skip|quick play|solo|free for all)$/i;
for (let i = 0; i < 12; i++) {
  const btn = page.locator('button, [role=button], a, div').filter({ hasText: labels }).first();
  if (await btn.count() === 0) break;
  const t = (await btn.innerText().catch(() => '')).trim().slice(0, 40);
  log('clic en', t);
  await btn.click({ timeout: 3000, force: true }).catch((e) => log('clic fallo', e.message.slice(0, 100)));
  await page.waitForTimeout(4000); await shot('02_paso' + String(i).padStart(2, '0'));
}
await page.waitForTimeout(20000);
await page.keyboard.press('KeyB').catch(() => {});
for (let i = 0; i < 40; i++) { await page.mouse.move(640 + i * 3, 360 + (i % 5), { steps: 2 }).catch(() => {}); await page.keyboard.down('KeyW').catch(() => {}); await page.waitForTimeout(150); }
await page.keyboard.up('KeyW').catch(() => {});
await shot('03_en_juego');

const info = await page.evaluate(() => {
  const o = { canvases: [...document.querySelectorAll('canvas')].map((c) => ({ w: c.width, h: c.height, id: c.id, cls: c.className })), globals: [], dump: null };
  const re = /three|babylon|pc$|playcanvas|unity|pixi|phaser|cesium|regl|twgl|webgl|engine|game|app|cocos|godot|wasm|module/i;
  for (const k of Object.getOwnPropertyNames(window)) { if (re.test(k)) { let t = ''; try { t = typeof window[k]; } catch (e) {} o.globals.push(k + ':' + t); } }
  try { o.dump = JSON.parse(window.__vsteve.dump()); } catch (e) { o.dumpError = String(e); }
  return o;
}).catch((e) => ({ error: String(e) }));
fs.writeFileSync(path.join(OUT, 'diagnostico.json'), JSON.stringify(info, null, 1));
fs.writeFileSync(path.join(OUT, 'requests.txt'), reqs.join('\n'));

// busca pistas del motor y de la camara dentro de los archivos bajados
const pistas = {};
const words = ['THREE', 'REVISION', 'BABYLON', 'PlayCanvas', 'createUnityInstance', 'UnityLoader', 'PIXI', 'viewMatrix', 'projectionMatrix', 'modelViewMatrix', 'uniformMatrix4fv', 'uniform4fv', 'getUniformBlockIndex', 'unity_Matrix', 'cameraPosition', 'matrixWorldInverse', 'WebGL2RenderingContext', 'OffscreenCanvas', 'getContext("webgl2"'];
for (const f of fs.readdirSync(FILES)) {
  let txt = ''; try { txt = fs.readFileSync(path.join(FILES, f), 'latin1'); } catch (e) { continue; }
  const hit = {}; for (const w of words) { const n = txt.split(w).length - 1; if (n) hit[w] = n; }
  if (Object.keys(hit).length) pistas[f] = { bytes: txt.length, hit };
}
fs.writeFileSync(path.join(OUT, 'pistas_motor.json'), JSON.stringify(pistas, null, 1));
log('listo. archivos bajados:', fs.readdirSync(FILES).length);
await browser.close();
