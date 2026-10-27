// ekran.yml tetikleyici ve yetki kalkanı — bağımlılıksız metin ayrıştırma (YAML kütüphanesi yok).
// Amaç: dal push'u, çekme isteği ve başka iş akışı hiçbir şey çalıştırmasın; npm ci / site betikleri yalnız
// SALT OKUMA işinde (derle) koşsun; yazma yetkili iş (yayinla) yalnız indirilmiş paketi yerleştirip c/ ve ekran/ yollarını eklesin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const YOL = new URL('../../../.github/workflows/ekran.yml', import.meta.url);
const metin = readFileSync(YOL, 'utf8').replace(/\r\n/g, '\n');
const satirlar = metin.split('\n');
const yorumsuz = (ls) => ls.filter((s) => !s.trim().startsWith('#'));

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
  yorumsuz(govde).filter((s) => s.startsWith(' '.repeat(girinti)) && !s.startsWith(' '.repeat(girinti + 1)) && /^\s*[\w-]+:/.test(s))
    .map((s) => s.trim().match(/^([\w-]+):/)[1]);

/** jobs.<ad> bloğunun satırları (yorum satırları atılır) */
function isBlok(ad) {
  const is = ustBlok('jobs');
  const bas = is.findIndex((s) => s === `  ${ad}:`);
  assert.notEqual(bas, -1, `${ad} işi yok`);
  const govde = [];
  for (let i = bas + 1; i < is.length; i++) {
    if (/^ {2}[\w-]+:/.test(is[i])) break;
    govde.push(is[i]);
  }
  return yorumsuz(govde);
}
/** İşin adımları: 6 boşluk girintili `- ` ile başlayan adım metinleri */
function adimlar(ad) {
  const govde = isBlok(ad);
  const bas = govde.findIndex((s) => s === '    steps:');
  assert.notEqual(bas, -1, `${ad}: steps: bloğu yok`);
  const sonuc = [];
  for (let i = bas + 1; i < govde.length; i++) {
    if (govde[i].startsWith('      - ')) sonuc.push([govde[i]]);
    else if (sonuc.length) sonuc.at(-1).push(govde[i]);
  }
  return sonuc.map((l) => l.join('\n').trimEnd());
}
/** İşin adımlardan önceki satırları (runs-on, if, permissions …) */
const isUst = (ad) => {
  const govde = isBlok(ad);
  return govde.slice(0, govde.findIndex((s) => s === '    steps:'));
};
const izinler = (ad) => {
  const ust = isUst(ad);
  const bas = ust.findIndex((s) => s === '    permissions:');
  assert.notEqual(bas, -1, `${ad}: permissions yok`);
  const izin = [];
  for (let i = bas + 1; i < ust.length && ust[i].startsWith('      '); i++) izin.push(ust[i].trim());
  return izin;
};
const adimBul = (ad, ol) => {
  const a = adimlar(ad).filter(ol);
  assert.equal(a.length, 1, 'adım tam bir kez bulunmalı');
  return a[0];
};

test('on: yalnız workflow_dispatch ve push; push yalnız main ve yalnız ilgili yollar', () => {
  assert.deepEqual(anahtarlar(ustBlok('on'), 2), ['workflow_dispatch', 'push']);
  const on = ustBlok('on');
  const bas = on.findIndex((s) => s === '  push:');
  const push = [];
  for (let i = bas + 1; i < on.length && on[i].startsWith('    '); i++) push.push(on[i].trim());
  assert.deepEqual(push, ['branches: [main]', 'paths: [ekran-kaynak.json, camiler.json, "arac/ekran/**"]']);
});

test('schedule, pull_request, pull_request_target ve workflow_run hiçbir yerde tetikleyici değildir', () => {
  assert.doesNotMatch(metin, /^\s*(schedule|pull_request|pull_request_target|workflow_run)\s*:/m);
});

test('üst düzey permissions boş (her iş kendi iznini bildirir)', () => {
  assert.ok(satirlar.includes('permissions: {}'));
  assert.equal(satirlar.filter((s) => s.startsWith('permissions:')).length, 1);
});

test('derle yalnız contents: read; write hiçbir yerinde yok. yayinla contents: write ve pages: write', () => {
  assert.deepEqual(izinler('derle'), ['contents: read']);
  assert.doesNotMatch(isBlok('derle').join('\n'), /write/);
  assert.deepEqual(izinler('yayinla'), ['contents: write', 'pages: write']);
  // write yalnız yayinla işinde geçer
  const disinda = [...ustBlok('on'), ...isBlok('derle')].join('\n');
  assert.doesNotMatch(disinda, /write/);
});

test('eşzamanlılık: ekran grubu, çalışan koşu iptal edilmez', () => {
  assert.deepEqual(yorumsuz(ustBlok('concurrency')).map((s) => s.trim()).filter(Boolean), ['group: ekran', 'cancel-in-progress: false']);
});

test('iki iş vardır: derle ve yayinla; yayinla derle\'ye bağlıdır ve yalnız hazirsa koşar', () => {
  assert.deepEqual(anahtarlar(ustBlok('jobs'), 2), ['derle', 'yayinla']);
  const ust = isUst('yayinla').map((s) => s.trim());
  assert.ok(ust.includes('needs: derle'), ust.join(' | '));
  assert.ok(ust.includes("if: needs.derle.outputs.hazir == '1'"), ust.join(' | '));
  assert.ok(ust.includes('timeout-minutes: 15'), ust.join(' | '));
});

test('derle yalnız main dalında koşar (başka daldaki workflow_dispatch yayınlamaz); 25 dk; hazir çıktısı kaynak adımından', () => {
  const ust = isUst('derle').map((s) => s.trim());
  assert.ok(ust.includes("if: github.ref == 'refs/heads/main'"), ust.join(' | '));
  assert.ok(ust.includes('timeout-minutes: 25'), ust.join(' | '));
  assert.ok(ust.includes('hazir: ${{ steps.kaynak.outputs.hazir }}'), ust.join(' | '));
});

test('her uses: tam 40 haneli SHA ile sabitli (sürüm yorumuyla); checkout ve setup-node bilinen SHA\'larla', () => {
  const kullanimlar = metin.split('\n').filter((s) => /^\s*(- )?uses:/.test(s));
  assert.ok(kullanimlar.length >= 7, String(kullanimlar.length));
  for (const u of kullanimlar) assert.match(u, /uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40}( # .+)?$/, u);
  assert.match(metin, /uses: actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\.0\.1/);
  assert.match(metin, /uses: actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7\.0\.0/);
  assert.doesNotMatch(metin, /uses: [\w./-]+@v\d/);
});

test('upload-artifact ve download-artifact için gerçek SHA çözüldü (yer tutucu kalmadı)', () => {
  assert.doesNotMatch(metin, /@0{40}\b/);
});

test('hiçbir yerde secrets. yok (site derlemesi ve yerleştirme sır görmez)', () => {
  assert.doesNotMatch(metin, /secrets\./);
});

test('derle: iki checkout da kimlik bilgisini kalıcılaştırmaz; site depo ve sha kaynak adımından, _site yoluna', () => {
  const cikislar = adimlar('derle').filter((a) => a.includes('actions/checkout@'));
  assert.equal(cikislar.length, 2);
  for (const c of cikislar) assert.match(c, /^\s*persist-credentials: false$/m);
  const anaDal = cikislar[0];
  assert.match(anaDal, /^\s*ref: main$/m);
  const site = cikislar[1];
  assert.match(site, /^\s*repository: \$\{\{ steps\.kaynak\.outputs\.repo \}\}$/m);
  assert.match(site, /^\s*ref: \$\{\{ steps\.kaynak\.outputs\.sha \}\}$/m);
  assert.match(site, /^\s*path: _site$/m);
});

test('derle: kaynak adımı çıktıyı GITHUB_OUTPUT\'a yazar; sonraki adımların hepsi hazir == 1 koşuluna bağlı', () => {
  const kaynak = adimBul('derle', (a) => a.includes('id: kaynak'));
  assert.match(kaynak, /run: node arac\/ekran\/kaynak\.mjs >> "\$GITHUB_OUTPUT"$/m);
  const tum = adimlar('derle');
  const kaynakIx = tum.findIndex((a) => a.includes('id: kaynak'));
  const sonrakiler = tum.slice(kaynakIx + 1);
  assert.equal(sonrakiler.length, 4, 'site checkout, setup-node, derleme, paket yükleme');
  for (const a of sonrakiler) assert.match(a, /^\s*(- )?if: steps\.kaynak\.outputs\.hazir == '1'$/m, a);
});

test('derle: Node 24, npm ci && npm run build _site içinde ve 15 dk zaman aşımıyla', () => {
  assert.match(adimBul('derle', (a) => a.includes('actions/setup-node@')), /node-version: 24\b/);
  const derleme = adimBul('derle', (a) => a.includes('npm ci'));
  assert.match(derleme, /^\s*working-directory: _site$/m);
  assert.match(derleme, /^\s*timeout-minutes: 15$/m);
  assert.match(derleme, /run: npm ci && npm run build$/m);
});

test('derle: ekran-paket yüklenir; yalnız ekran dosyaları, eksik dosyada hata, vakitler.json yok', () => {
  const yukle = adimBul('derle', (a) => a.includes('actions/upload-artifact@'));
  assert.match(yukle, /^\s*name: ekran-paket$/m);
  assert.match(yukle, /^\s*if-no-files-found: error$/m);
  for (const d of ['index.html', 'ekran.js', 'ekran.css', 'sw.js', 'akis.json', 'icerik.json', 'butce.json', 'fonts']) {
    assert.match(yukle, new RegExp(`^\\s*_site/dist/ekran/${d}$`, 'm'), d);
  }
  assert.doesNotMatch(yukle, /vakitler\.json/);
});

test('yayinla: npm hiç yok (bağımlılık betiği yazma yetkili işte koşmaz); testler doğrudan node ile', () => {
  const govde = isBlok('yayinla').join('\n');
  assert.doesNotMatch(govde, /\bnpm\b/);
  assert.doesNotMatch(govde, /npx|yarn|pnpm/);
  assert.match(govde, /run: node --test arac\/vakit\/test\/\*\.test\.mjs arac\/ekran\/test\/\*\.test\.mjs$/m);
});

test('yayinla: ana dal tam geçmişle (blob:none) alınır; kimlik bilgisi korunur (itmek için); Node 24', () => {
  const adimlarY = adimlar('yayinla');
  const cikis = adimlarY.find((a) => a.includes('actions/checkout@'));
  assert.match(cikis, /^\s*ref: main$/m);
  assert.match(cikis, /^\s*fetch-depth: 0$/m);
  assert.match(cikis, /^\s*filter: blob:none$/m);
  assert.doesNotMatch(cikis, /persist-credentials/);
  assert.match(adimBul('yayinla', (a) => a.includes('actions/setup-node@')), /node-version: 24\b/);
});

test('yayinla: paket indirilir ve yerlestir doğru bağımsız değişkenlerle koşar', () => {
  const indir = adimBul('yayinla', (a) => a.includes('actions/download-artifact@'));
  assert.match(indir, /^\s*name: ekran-paket$/m);
  assert.match(indir, /^\s*path: _paket$/m);
  const yer = adimBul('yayinla', (a) => a.includes('arac/ekran/yerlestir.mjs'));
  assert.match(yer, /run: node arac\/ekran\/yerlestir\.mjs --paket _paket --kok \.$/m);
});

test('yayın adımı: yalnız doğrulanmış yolları tek tek ekler; rebase + 3 deneme; zorlama yok; camipano/ yok', () => {
  const yayin = adimBul('yayinla', (a) => a.includes('id: yayin'));
  assert.match(yayin, /c\/\.ekran-yazilan/);
  assert.match(yayin, /if \[ ! -s c\/\.ekran-yazilan \].*itildi=0/s);
  // yol süzgeci: ekran/ altı ya da c/<id>/ altındaki dört dosya; `..` ve başka her şey reddedilir
  assert.ok(yayin.includes(String.raw`izinli='^(ekran/[A-Za-z0-9._/-]+|c/[a-z0-9][a-z0-9-]{2,39}/(index\.html|sw\.js|icerik\.json|akis\.json))$'`), 'izinli yol deseni');
  assert.match(yayin, /\[\[ ! "\$yol" =~ \$izinli \]\] \|\| \[\[ "\$yol" == \*\.\.\* \]\]/);
  assert.match(yayin, /git add -A -- "\$yol"/);
  // toplu ekleme yok
  assert.doesNotMatch(yayin, /git add (?!-A -- "\$yol")/);
  assert.doesNotMatch(yayin, /git add -A\s*($|\n)/);
  assert.doesNotMatch(yayin, /git commit .*-a\b/);
  assert.doesNotMatch(yayin, /camipano\//);
  assert.match(yayin, /git commit -m "Ekran: platform sayfaları"/);
  assert.match(yayin, /git pull --rebase origin main/);
  assert.match(yayin, /git push origin HEAD:main/);
  assert.match(yayin, /for i in 1 2 3; do/);
  const pull = yayin.indexOf('git pull --rebase');
  const iptal = yayin.indexOf('git rebase --abort 2>/dev/null || true');
  const uyku = yayin.indexOf('sleep $((i * 10))');
  assert.ok(pull !== -1 && iptal > pull && uyku > iptal, 'pull < rebase --abort < sleep');
  assert.doesNotMatch(yayin, /--force|-f\b/);
  assert.doesNotMatch(metin, /git add [^\n]*camipano/);
  assert.doesNotMatch(metin, /camipano\//);
});

test('adım sırası: testler < indirme < yerlestir < yayın < pages/builds', () => {
  const a = adimlar('yayinla');
  const ix = (parca) => a.findIndex((x) => x.includes(parca));
  const sira = [ix('node --test'), ix('actions/download-artifact@'), ix('arac/ekran/yerlestir.mjs'), ix('id: yayin'), ix('pages/builds')];
  assert.ok(sira.every((x) => x !== -1), 'adımlar bulunmalı: ' + sira.join(','));
  assert.deepEqual(sira, [...sira].sort((x, y) => x - y));
  assert.equal(new Set(sira).size, 5);
});

test('Pages derlemesi yalnız itildiyse ve GITHUB_TOKEN ile istenir', () => {
  const p = adimBul('yayinla', (a) => a.includes('pages/builds'));
  assert.match(p, /if: steps\.yayin\.outputs\.itildi == '1'/);
  assert.match(p, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(p, /secrets\./);
});
