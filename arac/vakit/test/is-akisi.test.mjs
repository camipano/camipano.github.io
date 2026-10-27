// İş akışı tetikleyici kalkanı — bağımlılıksız metin ayrıştırma (YAML kütüphanesi yok).
// Amaç: dal push'u, çekme isteği ve başka iş akışı tetikleyicileri hiçbir şey çalıştırmasın; yayın adımı yalnız c/'yi eklesin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const YOL = new URL('../../../.github/workflows/vakitler.yml', import.meta.url);
const metin = readFileSync(YOL, 'utf8').replace(/\r\n/g, '\n');
const satirlar = metin.split('\n');

/** Üst düzey anahtarın (girintisiz `ad:`) gövdesi: sonraki girintisiz satıra kadarki satırlar. */
function ustBlok(ad) {
  const bas = satirlar.findIndex((s) => s === `${ad}:` || s.startsWith(`${ad}: `));
  assert.notEqual(bas, -1, `${ad}: bloğu yok`);
  const govde = [];
  for (let i = bas + 1; i < satirlar.length; i++) {
    if (satirlar[i] !== '' && !/^\s/.test(satirlar[i])) break;
    govde.push(satirlar[i]);
  }
  return govde;
}
/** Bir bloktaki belli girintili (kardeş) anahtarlar */
const anahtarlar = (govde, girinti) =>
  govde.filter((s) => s.startsWith(' '.repeat(girinti)) && !s.startsWith(' '.repeat(girinti + 1)) && /^\s*[\w-]+:/.test(s))
    .map((s) => s.trim().match(/^([\w-]+):/)[1]);

/** jobs.vakitler.steps: 6 boşluk girintili `- ` ile başlayan adım metinleri */
function adimlar() {
  const bas = satirlar.findIndex((s) => s === '    steps:');
  assert.notEqual(bas, -1, 'steps: bloğu yok');
  const sonuc = [];
  for (let i = bas + 1; i < satirlar.length; i++) {
    const s = satirlar[i];
    if (s.startsWith('      - ')) sonuc.push([s]);
    else if (sonuc.length) sonuc.at(-1).push(s);
  }
  return sonuc.map((l) => l.join('\n').trimEnd());
}
const adimBul = (ol) => {
  const a = adimlar().filter(ol);
  assert.equal(a.length, 1, 'adım tam bir kez bulunmalı');
  return a[0];
};

test('on: yalnız schedule, workflow_dispatch ve push içerir', () => {
  assert.deepEqual(anahtarlar(ustBlok('on'), 2), ['schedule', 'workflow_dispatch', 'push']);
});

test('push yalnız main dalı ve yalnız camiler.json değişimiyle çalışır', () => {
  const on = ustBlok('on');
  const bas = on.findIndex((s) => s === '  push:');
  assert.notEqual(bas, -1);
  const push = [];
  for (let i = bas + 1; i < on.length && on[i].startsWith('    '); i++) push.push(on[i]);
  assert.deepEqual(push.map((s) => s.trim()), ['branches: [main]', 'paths: [camiler.json]']);
});

test('pull_request ve workflow_run (ve pull_request_target) hiçbir yerde tetikleyici değildir', () => {
  assert.doesNotMatch(metin, /^\s*(pull_request|pull_request_target|workflow_run)\s*:/m);
  assert.doesNotMatch(ustBlok('on').join('\n'), /pull_request|workflow_run/);
});

test('schedule iki cron içerir', () => {
  const on = ustBlok('on').join('\n');
  assert.match(on, /- cron: "41 4 \* \* \*"/);
  assert.match(on, /- cron: "17 13 \* \* \*"/);
});

test('permissions tam olarak contents: write ve pages: write', () => {
  const izin = ustBlok('permissions').map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(izin, ['contents: write', 'pages: write']);
});

test('eşzamanlılık: vakitler grubu, çalışan koşu iptal edilmez', () => {
  const c = ustBlok('concurrency').map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(c, ['group: vakitler', 'cancel-in-progress: false']);
});

test('Node 24 kurulur ve testler üret adımından önce koşar', () => {
  assert.match(metin, /node-version: 24\b/);
  assert.doesNotMatch(metin, /node-version: 22\b/);
  const sirasi = adimlar();
  const testIx = sirasi.findIndex((a) => a.includes('node --test arac/vakit/test/*.test.mjs'));
  const uretIx = sirasi.findIndex((a) => a.includes('id: uret'));
  assert.ok(testIx !== -1 && uretIx !== -1 && testIx < uretIx);
});

test('adım sırası: uret < yayın < pages/builds < esdeger', () => {
  const a = adimlar();
  const ix = (parca) => a.findIndex((x) => x.includes(parca));
  const sira = [ix('id: uret'), ix('id: yayin'), ix('pages/builds'), ix('node arac/vakit/esdeger.mjs')];
  assert.ok(sira.every((x) => x !== -1), 'adımlar bulunmalı: ' + sira.join(','));
  assert.deepEqual(sira, [...sira].sort((x, y) => x - y));
  assert.equal(new Set(sira).size, 4);
});

test('uret adımı continue-on-error: true ile koşar', () => {
  const uret = adimBul((a) => a.includes('id: uret'));
  assert.match(uret, /^\s*continue-on-error: true$/m);
  assert.match(uret, /run: node arac\/vakit\/uret\.mjs$/m);
});

test('son adım uret başarısızsa işi kırmızı bitirir', () => {
  const son = adimlar().at(-1);
  assert.match(son, /if: steps\.uret\.outcome == 'failure'/);
  assert.match(son, /run: exit 1$/m);
});

test('yayın adımı yalnız başarılı camileri ekler (c/.basarili); liste boşsa yayımlamaz; rebase + 3 deneme', () => {
  const yayin = adimBul((a) => a.includes('id: yayin'));
  // başarı listesi okunur; yoksa/boşsa yayımlanacak bir şey yoktur
  assert.match(yayin, /c\/\.basarili/);
  assert.match(yayin, /if \[ ! -s c\/\.basarili \].*itildi=0/s);
  // yalnız listedeki kimliklerin dosyası eklenir; toplu `git add -A -- c/` yoktur
  assert.match(yayin, /git add -- "c\/\$id\/vakitler\.json"/);
  assert.doesNotMatch(yayin, /git add -A -- c\//);
  assert.doesNotMatch(yayin, /camipano\//);
  assert.doesNotMatch(yayin, /git add (?! -- "c\/\$id\/vakitler\.json")(\.|-A|--all|-u)(\s|$)/);
  assert.doesNotMatch(yayin, /git commit .*-a\b/);
  assert.match(yayin, /git pull --rebase origin main/);
  assert.match(yayin, /git push origin HEAD:main/);
  assert.match(yayin, /for i in 1 2 3; do/);
  // başarısız deneme yarım kalmış rebase bırakmasın: döngü içinde, yeniden denemeden önce iptal edilir
  const pull = yayin.indexOf('git pull --rebase');
  const iptal = yayin.indexOf('git rebase --abort 2>/dev/null || true');
  const uyku = yayin.indexOf('sleep $((i * 10))');
  assert.ok(pull !== -1 && iptal > pull && uyku > iptal, 'pull < rebase --abort < sleep');
  assert.doesNotMatch(yayin, /--force|-f\b/);
  // workflow genelinde de camipano/ klasörüne yazan komut yok
  assert.doesNotMatch(metin, /git add [^\n]*camipano/);
});

test('Pages derlemesi yalnız itildiyse istenir ve GITHUB_TOKEN ile', () => {
  const p = adimBul((a) => a.includes('pages/builds'));
  assert.match(p, /if: steps\.yayin\.outputs\.itildi == '1'/);
  assert.match(p, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(p, /secrets\./);
});

test('sırlar yalnız uret adımında ve yalnız Awqat kimliği (test, yayın, esdeger adımları sır görmez)', () => {
  const sirliAdimlar = adimlar().filter((a) => /secrets\./.test(a));
  assert.equal(sirliAdimlar.length, 1);
  assert.match(sirliAdimlar[0], /run: node arac\/vakit\/uret\.mjs$/m);
  const adlar = [...metin.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(adlar, ['AWQAT_KULLANICI', 'AWQAT_SIFRE']);
  assert.match(sirliAdimlar[0], /AWQAT_ARALIK: \$\{\{ github\.event_name == 'workflow_dispatch' && '1' \|\| '' \}\}/);
  assert.doesNotMatch(metin, /^\s{2,4}env:/m, 'iş ya da iş akışı düzeyinde env yok');
});

// jobs.vakitler'in adımlardan önceki satırları (runs-on, if, timeout-minutes …)
function isUstSatirlari() {
  const is = ustBlok('jobs');
  const bas = is.findIndex((x) => x === '  vakitler:');
  const steps = is.findIndex((x) => x === '    steps:');
  assert.ok(bas !== -1 && steps > bas);
  return is.slice(bas + 1, steps).map((x) => x.trim());
}

test('iş yalnız varsayılan dalda koşar (başka daldaki workflow_dispatch main\'e itmez)', () => {
  const ust = isUstSatirlari();
  assert.ok(ust.includes("if: github.ref == 'refs/heads/main'"), ust.join(' | '));
});

test('zaman aşımı: iş 25 dk, uret adımı 15 dk (continue-on-error korunur)', () => {
  const ust = isUstSatirlari();
  assert.ok(ust.includes('timeout-minutes: 25'), ust.join(' | '));
  assert.ok(!ust.includes('timeout-minutes: 20'));
  const uret = adimBul((a) => a.includes('id: uret'));
  assert.match(uret, /^\s*timeout-minutes: 15$/m);
  assert.match(uret, /^\s*continue-on-error: true$/m);
});

test('checkout ve setup-node tam SHA ile sabitlidir (sürüm yorumuyla), Node 24', () => {
  assert.match(metin, /uses: actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\.0\.1/);
  assert.match(metin, /uses: actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7\.0\.0/);
  assert.doesNotMatch(metin, /uses: actions\/checkout@v\d/);
  assert.doesNotMatch(metin, /uses: actions\/setup-node@v\d/);
});

test('checkout dala sabitlenir (ayrık HEAD yerine main: commit adımı itebilir)', () => {
  const adim = adimBul((a) => a.includes('actions/checkout@'));
  assert.match(adim, /^\s*ref: main$/m);
});
