// ekran.yml tetikleyici ve yetki kalkanı — bağımlılıksız metin ayrıştırma (YAML kütüphanesi yok).
// Amaç: dal push'u, çekme isteği ve başka iş akışı hiçbir şey çalıştırmasın; npm ci / site betikleri yalnız
// SALT OKUMA işinde (derle) koşsun; yazma yetkili iş (yayinla) yalnız indirilmiş paketi yerleştirip c/ ve ekran/ yollarını eklesin.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { REFERANS_CAMILER, yerlestir } from '../yerlestir.mjs';
import { camilerOku } from '../../vakit/camiler.mjs';

const YOL = new URL('../../../.github/workflows/ekran.yml', import.meta.url);
const KAYNAK_MJS = fileURLToPath(new URL('../kaynak.mjs', import.meta.url));
const FIKSTUR = fileURLToPath(new URL('./fikstur/dist-ekran/', import.meta.url));
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
  // `\bwrite\b`: yazma izni sözcüğü (write, write-all …); upload-artifact'ın `overwrite: true` girdisi bir izin değildir
  assert.doesNotMatch(isBlok('derle').join('\n'), /\bwrite\b/);
  assert.deepEqual(izinler('yayinla'), ['contents: write', 'pages: write']);
  // write yalnız yayinla işinde geçer
  const disinda = [...ustBlok('on'), ...isBlok('derle')].join('\n');
  assert.doesNotMatch(disinda, /\bwrite\b/);
});

test('eşzamanlılık: grup dal başına (başka daldan gelen dispatch main koşusunu iptal/kuyruktan atamaz), çalışan koşu iptal edilmez', () => {
  assert.deepEqual(yorumsuz(ustBlok('concurrency')).map((s) => s.trim()).filter(Boolean), ['group: ekran-${{ github.ref }}', 'cancel-in-progress: false']);
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
  // derlenen sabit sha çıktı olarak taşınır (yayinla kayma denetimi için)
  assert.ok(ust.includes('sha: ${{ steps.kaynak.outputs.sha }}'), ust.join(' | '));
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
  // aynı ada yeniden yükleme (yeniden koşu) çakışmaz; paket bir günden uzun saklanmaz
  assert.match(yukle, /^\s*overwrite: true$/m);
  assert.match(yukle, /^\s*retention-days: 1$/m);
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
  // yol süzgeci: ekran/{ekran.js,ekran.css,butce.json,fonts/<güvenli ad>} ya da c/<id>/ altındaki dört dosya (<id> referans cami değil);
  // `.`/`..` bölümleri, `.git` ve başka her şey reddedilir
  assert.ok(yayin.includes(String.raw`izinli='^(ekran/(ekran\.js|ekran\.css|butce\.json|fonts/[A-Za-z0-9][A-Za-z0-9._-]*)|c/[a-z0-9][a-z0-9-]{2,39}/(index\.html|sw\.js|icerik\.json|akis\.json))$'`), 'izinli yol deseni');
  assert.ok(yayin.includes(String.raw`yasakli='^c/ulucamii-marche/'`), 'referans cami yasağı');
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

// ------------------------------------------------------------------ bash ile çalışan denetimler
// Yayın yol süzgeci ve kayma denetimi, iş akışındaki GERÇEK satırlarla bash'te sınanır (metin eşleştirmesi tek başına yetmez).

const gecici = [];
const geciciDizin = (ad) => { const d = mkdtempSync(join(tmpdir(), `ekran-${ad}-`)); gecici.push(d); return d; };
after(() => { for (const d of gecici) rmSync(d, { recursive: true, force: true }); });
const ileri = (y) => y.replace(/\\/g, '/');

/** Adımın `run: |` bloğu: ilk satırın girintisi atılmış satırlar. */
function runSatirlari(adim) {
  const ls = adim.split('\n');
  const bas = ls.findIndex((s) => /^\s*run: \|$/.test(s));
  assert.notEqual(bas, -1, 'run: | bloğu yok');
  const g = ls.slice(bas + 1);
  const girinti = g[0].match(/^ */)[0].length;
  return g.map((s) => s.slice(girinti));
}

/** Betiği dosyaya yazıp `bash` ile çalıştırır (komut satırı tırnak sorunlarından kaçınmak için). bash yoksa null. */
function bashCalistir(betik, { girdi = '', cwd, env, bayrak = [] } = {}) {
  const d = geciciDizin('bash');
  const dosya = join(d, 'betik.sh');
  writeFileSync(dosya, betik, 'utf8');
  const r = spawnSync('bash', [...bayrak, ileri(dosya)], { encoding: 'utf8', input: girdi, cwd, env: { ...process.env, ...env }, timeout: 60000 });
  return r.error ? null : r;
}
const BASH_VAR = (() => {
  try {
    const r = bashCalistir('echo tamam\n');
    return r !== null && r.status === 0 && r.stdout.trim() === 'tamam';
  } catch { return false; }
})();
const BASH_YOK = BASH_VAR ? false : 'bash kullanılamıyor';

/** İş akışının yol süzgeci satırlarıyla her yolu sınar; kabul edilen yolların kümesi döner. */
function suzgecKabul(yollar) {
  const run = runSatirlari(adimBul('yayinla', (a) => a.includes('id: yayin'))).map((s) => s.trim());
  const izinli = run.find((s) => s.startsWith('izinli='));
  const yasakli = run.find((s) => s.startsWith('yasakli='));
  const kontrol = run.find((s) => s.startsWith('if [[ ! "$yol" =~ $izinli ]]'));
  assert.ok(izinli && yasakli && kontrol, 'süzgeç satırları bulunmalı');
  // her yol kendi alt kabuğunda: red `exit 1` ile alt kabuğu bitirir, kabul KABUL: satırı basar
  const betik = [izinli, yasakli, 'while IFS= read -r yol; do', `( ${kontrol}`, '  echo "KABUL:$yol" )', 'done', 'exit 0', ''].join('\n');
  const r = bashCalistir(betik, { girdi: yollar.join('\n') + '\n' });
  assert.ok(r && r.status === 0, r?.stderr);
  return new Set(r.stdout.split('\n').filter((s) => s.startsWith('KABUL:')).map((s) => s.slice(6)));
}

test('yayın yol süzgeci (bash, gerçek satırlar): yalnız izinli yollar geçer; . / .. / .git bölümleri, referans cami ve ekran/ altındaki başka dosyalar reddedilir', { skip: BASH_YOK }, () => {
  const IYI = [
    'ekran/ekran.js', 'ekran/ekran.css', 'ekran/butce.json', 'ekran/fonts/a.woff2', 'ekran/fonts/Inter-Bold.woff2', 'ekran/fonts/a.b_c-1.woff2',
    'c/deneme-a/index.html', 'c/deneme-a/sw.js', 'c/deneme-a/icerik.json', 'c/deneme-a/akis.json', 'c/x-yz/akis.json', 'c/ulucamii-marche2/index.html',
  ];
  const KOTU = [
    'ekran/.', 'ekran/./x', 'ekran/.git/config', 'ekran/../x', 'ekran/', 'ekran', 'ekran/x', 'ekran/index.html', 'ekran/vakitler.json',
    'ekran/ekranxjs', 'ekran/ekran.jsx', 'ekran/ekran.js/x', 'ekran/fonts', 'ekran/fonts/', 'ekran/fonts/.', 'ekran/fonts/..', 'ekran/fonts/.git', 'ekran/fonts/.x',
    'ekran/fonts/a..b', 'ekran/fonts/a/b', 'ekran/fonts/a/../b', 'ekran/fonts/a b', 'ekran/.git/fonts/a.woff2',
    'c/ulucamii-marche/index.html', 'c/ulucamii-marche/sw.js', 'c/ulucamii-marche/icerik.json', 'c/ulucamii-marche/akis.json', 'c/ulucamii-marche/vakitler.json',
    'c/x/../y', 'c/x/index.html', 'c/deneme-a/../ulucamii-marche/index.html', 'c/deneme-a/./index.html', 'c/.git/index.html', 'c/.ekran-yazilan', 'c/../index.html',
    'c/deneme-a/vakitler.json', 'c/deneme-a/sub/index.html', 'c/deneme-a/index.htmlx', 'c/Deneme/index.html', 'c//index.html', 'c/deneme-a', 'c/deneme-a/',
    'camipano/releases/x.apk', 'index.html', 'camiler.json', '.git/config', '.github/workflows/ekran.yml', 'arac/ekran/yerlestir.mjs', '/ekran/ekran.js', '../ekran/ekran.js',
  ];
  // yerlestir.mjs'in referans listesindeki her cami (sayfası ulucamii.be/ekran/'da kalır) süzgeçte de yasaklı olmalı
  for (const id of REFERANS_CAMILER) for (const a of ['index.html', 'sw.js', 'icerik.json', 'akis.json']) KOTU.push(`c/${id}/${a}`);
  const kabul = suzgecKabul([...IYI, ...KOTU]);
  for (const y of IYI) assert.ok(kabul.has(y), `kabul edilmeliydi: ${y}`);
  for (const y of KOTU) assert.ok(!kabul.has(y), `reddedilmeliydi: ${y}`);
});

test('yayın yol süzgeci (bash): yerlestir.mjs\'in gerçekte yazdığı/sildiği her yol süzgeçten geçer', { skip: BASH_YOK }, async () => {
  const paket = geciciDizin('paket');
  cpSync(FIKSTUR, paket, { recursive: true });
  const cami = (camiId) => ({ camiId, adTr: `${camiId} Camii`, adFr: '', ilce: '12345', ilceAdi: 'ORNEK', slug: camiId, saatDilimi: 'Europe/Brussels', konum: { enlem: 50.1, boylam: 5.2 }, cumaSaati: '' });
  const camiler = camilerOku(JSON.stringify({ surum: 1, camiler: [cami('ulucamii-marche'), cami('deneme-a'), cami('deneme-b-2')] }));
  const kok = geciciDizin('kok');
  mkdirSync(join(kok, 'ekran', 'fonts'), { recursive: true });
  writeFileSync(join(kok, 'ekran', 'fonts', 'eski.woff2'), 'eski'); // silinecek yazı tipi de listeye girer
  await yerlestir({ paket, kok, camiler });
  const liste = readFileSync(join(kok, 'c', '.ekran-yazilan'), 'utf8').split('\n').filter(Boolean);
  assert.ok(liste.length >= 12, String(liste.length));
  assert.ok(liste.includes('ekran/fonts/eski.woff2'));
  const kabul = suzgecKabul(liste);
  for (const y of liste) assert.ok(kabul.has(y), `yerlestir'in yazdığı yol süzgeçten geçmeli: ${y}`);
});

test('kayma denetimi: derle çıktısı sha, yayinla yeni checkout\'ta ekran-kaynak.json\'u yeniden okur; fark varsa yayın atlanır (yeşil), sonraki adımlar guncel çıktısına bağlıdır', () => {
  const adimlarY = adimlar('yayinla');
  const guncelIx = adimlarY.findIndex((a) => /^\s*- id: guncel$/m.test(a));
  assert.notEqual(guncelIx, -1, 'guncel adımı yok');
  const guncel = adimlarY[guncelIx];
  // girdi ortam değişkeniyle taşınır (ifade doğrudan betiğe gömülmez); kaynak aynı betikle okunur
  assert.match(guncel, /^\s*DERLENEN_SHA: \$\{\{ needs\.derle\.outputs\.sha \}\}$/m);
  assert.match(guncel, /node arac\/ekran\/kaynak\.mjs/);
  assert.match(guncel, /evet=1/);
  assert.match(guncel, /evet=0/);
  assert.match(guncel, /yayın atlandı/);
  assert.doesNotMatch(guncel, /exit 1/, 'fark hata değil: iş yeşil biter, yeni koşu arkadan gelir');
  // checkout ve setup-node'dan SONRA, testler/indirme/yerleştirme/yayından ÖNCE
  const ix = (parca) => adimlarY.findIndex((x) => x.includes(parca));
  assert.ok(ix('actions/checkout@') < guncelIx && ix('actions/setup-node@') < guncelIx);
  const sonrakiler = ['node --test', 'actions/download-artifact@', 'arac/ekran/yerlestir.mjs', 'id: yayin'].map(ix);
  for (const s of sonrakiler) assert.ok(s > guncelIx, 'guncel adımından sonra olmalı');
  for (const a of adimlarY.slice(guncelIx + 1)) {
    if (a.includes('pages/builds')) continue; // yalnız itildi == 1 ise koşar; yayın atlanınca itildi hiç yazılmaz
    assert.match(a, /^\s*(- )?if: steps\.guncel\.outputs\.evet == '1'$/m, a);
  }
});

function kaymaCalistir({ derlenen, kaynak }) {
  const d = geciciDizin('kayma');
  mkdirSync(join(d, 'arac', 'ekran'), { recursive: true });
  copyFileSync(KAYNAK_MJS, join(d, 'arac', 'ekran', 'kaynak.mjs'));
  writeFileSync(join(d, 'ekran-kaynak.json'), kaynak);
  const adim = adimBul('yayinla', (a) => /^\s*- id: guncel$/m.test(a));
  const cikti = join(d, 'GITHUB_OUTPUT.txt');
  writeFileSync(cikti, '');
  // GitHub'ın varsayılan kabuğu gibi: bash -e
  const r = bashCalistir(runSatirlari(adim).join('\n') + '\n', { cwd: d, env: { DERLENEN_SHA: derlenen, GITHUB_OUTPUT: ileri(cikti) }, bayrak: ['-e'] });
  return { status: r.status, stderr: r.stderr, mesaj: r.stdout, cikti: readFileSync(cikti, 'utf8') };
}
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const kaynakJson = (sha) => JSON.stringify({ surum: 1, repo: 'ulucamii2026/ulucamii2026.github.io', sha });

test('kayma denetimi (bash, gerçek adım): aynı sha → evet=1; farklı ya da boşaltılmış sha → evet=0, mesajlı ve başarıyla biter; bozuk dosya kırmızı', { skip: BASH_YOK }, () => {
  const ayni = kaymaCalistir({ derlenen: SHA_A, kaynak: kaynakJson(SHA_A) });
  assert.equal(ayni.status, 0, ayni.stderr);
  assert.match(ayni.cikti, /^evet=1$/m);
  assert.doesNotMatch(ayni.cikti, /^evet=0$/m);

  for (const kaynak of [kaynakJson(SHA_B), kaynakJson('')]) {
    const fark = kaymaCalistir({ derlenen: SHA_A, kaynak });
    assert.equal(fark.status, 0, fark.stderr);
    assert.match(fark.cikti, /^evet=0$/m);
    assert.doesNotMatch(fark.cikti, /^evet=1$/m);
    assert.match(fark.mesaj, /yayın atlandı/);
  }

  // dosya bozuksa sessizce atlanmaz: adım kırmızı biter
  const bozuk = kaymaCalistir({ derlenen: SHA_A, kaynak: '{bozuk' });
  assert.notEqual(bozuk.status, 0);
  assert.doesNotMatch(bozuk.cikti, /^evet=/m);
});

test('.gitignore: yalnız yerleştirme yardımcı dosyaları (c/.ekran-yazilan, c/.basarili)', () => {
  const yol = new URL('../../../.gitignore', import.meta.url);
  assert.ok(existsSync(yol), '.gitignore yok');
  const satirlarGi = readFileSync(yol, 'utf8').replace(/\r\n/g, '\n').split('\n').filter((s) => s.trim() !== '');
  assert.deepEqual(satirlarGi, ['c/.ekran-yazilan', 'c/.basarili']);
});
