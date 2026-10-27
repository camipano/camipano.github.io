// yerlestir.mjs testleri — cami başına sayfa yerleştirme.
// Gerçek site derlemesinin biçimini taşıyan fikstür: fikstur/dist-ekran/ (index.html gerçek derlemenin bayt kopyasıdır).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { REFERANS_CAMILER, sayfaUret, akisUret, icerikUret, surumHesapla, swUret, yerlestir } from '../yerlestir.mjs';
import { camilerOku } from '../../vakit/camiler.mjs';

const FIKSTUR = fileURLToPath(new URL('./fikstur/dist-ekran/', import.meta.url));
const YERLESTIR_MJS = fileURLToPath(new URL('../yerlestir.mjs', import.meta.url));

const gecici = [];
const geciciDizin = (ad) => { const d = mkdtempSync(join(tmpdir(), `ekran-${ad}-`)); gecici.push(d); return d; };
after(() => { for (const d of gecici) rmSync(d, { recursive: true, force: true }); });

const okuFikstur = (ad) => readFileSync(join(FIKSTUR, ad), 'utf8');
const cami = (ek = {}) => ({
  camiId: 'deneme-a', adTr: 'Deneme A Camii', adFr: 'Mosquée Deneme A', ilce: '12345', ilceAdi: 'ORNEK', slug: 'deneme-a',
  saatDilimi: 'Europe/Brussels', konum: { enlem: 50.1, boylam: 5.2 }, cumaSaati: '', ...ek,
});
const REFERANS = cami({ camiId: 'ulucamii-marche', adTr: 'Referans Camii', adFr: 'Mosquée Référence', ilce: '11890', ilceAdi: 'M.FAMENNE', slug: 'mfamenne' });
const UC_CAMI = () => [REFERANS, cami(), cami({ camiId: 'deneme-b', adTr: 'Deneme B Camii', adFr: '', ilce: '67890', slug: 'deneme-b', cumaSaati: '13:05' })];

const VERI = /<script\b[^>]*\bid="ekran-veri"[^>]*>([\s\S]*?)<\/script>/;
const veriOku = (html) => JSON.parse(html.match(VERI)[1]);
const TITLE = /<title>[\s\S]*?<\/title>/;
const LOGO = /<img\b[^>]*\bclass="logo\b[^"]*"[^>]*>/g;

function paketKopyala() { const d = geciciDizin('paket'); cpSync(FIKSTUR, d, { recursive: true }); return d; }

/** kök: camiler.json + yerleştirmenin dokunmaması gereken dosyalar */
function kokKur(camiler = UC_CAMI()) {
  const kok = geciciDizin('kok');
  const yaz = (y, icerik) => { mkdirSync(dirname(join(kok, y)), { recursive: true }); writeFileSync(join(kok, y), icerik); };
  yaz('camiler.json', JSON.stringify({ surum: 1, camiler }, null, 2));
  yaz('index.html', '<!doctype html><title>kök</title>');
  yaz('camipano/releases/x.apk', Buffer.from([0x50, 0x4b, 3, 4, 0, 255, 128, 7]));
  yaz('c/deneme-a/vakitler.json', '{"ilce":"12345","kaynakTuru":"diyanet"}');
  return kok;
}

/** Ağaçtaki her dosyanın özeti (ve dizin kayıtları): "hiçbir şey yazılmadı" kanıtı için. */
function agac(kok) {
  const s = {};
  const gez = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const y = join(d, e.name);
      const r = relative(kok, y).split(sep).join('/');
      if (e.isDirectory()) { s[r + '/'] = ''; gez(y); } else s[r] = createHash('sha256').update(readFileSync(y)).digest('hex');
    }
  };
  gez(kok);
  return s;
}
const sirali = (d) => [...d].sort();
const dortDosya = (id) => ['index.html', 'sw.js', 'icerik.json', 'akis.json'].map((a) => `c/${id}/${a}`);
const MOTOR = ['ekran/ekran.js', 'ekran/ekran.css', 'ekran/butce.json', 'ekran/fonts/a.woff2'];

test('REFERANS_CAMILER yalnız ulucamii-marche', () => {
  assert.deepEqual(REFERANS_CAMILER, ['ulucamii-marche']);
});

// ---------------------------------------------------------------- sayfaUret

test('sayfaUret: başlık kaçışlı, ekran-veri beklenen değerde, logolar yok, noindex ve bağlantılar duruyor', () => {
  const sablon = okuFikstur('index.html');
  const html = sayfaUret(sablon, cami({ adTr: 'Deneme & <Camii>', adFr: 'Mosquée "Deneme"', cumaSaati: '13:05' }));
  assert.match(html, /<title>Deneme &amp; &lt;Camii&gt; · Ekran<\/title>/);
  assert.deepEqual(veriOku(html), {
    cami: { tr: 'Deneme & <Camii>', fr: 'Mosquée "Deneme"' },
    vakit: veriOku(sablon).vakit,
    gps: { enlem: 50.1, boylam: 5.2 },
    cumaSaati: '13:05',
    ilce: '12345',
  });
  assert.doesNotMatch(html, /<img\b/);
  assert.doesNotMatch(html, /class="logo/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.ok(html.includes('href="/ekran/ekran.css"'));
  assert.ok(html.includes('<script src="/ekran/ekran.js"></script>'));
  // başlık, ekran-veri ve logolar dışında sayfa bayt bayt şablondur
  const norm = (h) => h.replace(TITLE, '<title>T</title>').replace(/(<script\b[^>]*\bid="ekran-veri"[^>]*>)[\s\S]*?(<\/script>)/, '$1V$2');
  assert.equal(norm(html), norm(sablon.replace(LOGO, '')));
});

test('sayfaUret: ilçe ve konum caminin kendisinden gelir; sitenin Ulu Camii değerleri sızmaz', () => {
  const sablon = okuFikstur('index.html');
  const html = sayfaUret(sablon, cami({ ilce: '555', konum: { enlem: 1.5, boylam: 2.5 }, adTr: 'X Camii', adFr: '' }));
  const v = veriOku(html);
  assert.equal(v.ilce, '555');
  assert.deepEqual(v.gps, { enlem: 1.5, boylam: 2.5 });
  assert.equal(v.cumaSaati, '');
  assert.ok(!html.includes('Ulu Camii'));
  assert.ok(!html.includes('50.231495'));
  assert.ok(!html.includes('11890'));
});

test('sayfaUret: adFr boşsa adTr kullanılır', () => {
  const v = veriOku(sayfaUret(okuFikstur('index.html'), cami({ adTr: 'Yalnız Türkçe', adFr: '' })));
  assert.deepEqual(v.cami, { tr: 'Yalnız Türkçe', fr: 'Yalnız Türkçe' });
});

test('sayfaUret: düşmanca ad sayfadan taşamaz (</script>, etiket, tırnak)', () => {
  const sablon = okuFikstur('index.html');
  const dusman = '</script><img src=x onerror=1>';
  const html = sayfaUret(sablon, cami({ adTr: dusman, adFr: '' }));
  assert.equal((html.match(/<\/script>/g) || []).length, (sablon.match(/<\/script>/g) || []).length, 'ham </script> eklenmemeli');
  assert.ok(!html.includes('<img'), 'ham <img etiketi oluşmamalı');
  assert.ok(!html.includes(dusman));
  assert.match(html, /<title>&lt;\/script&gt;&lt;img src=x onerror=1&gt; · Ekran<\/title>/);
  assert.equal(veriOku(html).cami.tr, dusman);
  assert.equal(veriOku(html).cami.fr, dusman);
  // başlık dışında etiket sayısı değişmez
  const etiket = (h) => (h.match(/<[a-z]/gi) || []).length;
  assert.equal(etiket(html), etiket(sablon.replace(LOGO, '')));
});

test('sayfaUret: $ desenleri (replace tuzağı) addan olduğu gibi geçer', () => {
  const ad = "A $& $1 $' $` $$ B";
  const html = sayfaUret(okuFikstur('index.html'), cami({ adTr: ad, adFr: '' }));
  assert.equal(veriOku(html).cami.tr, ad);
  assert.match(html, /<title>A \$&amp; \$1 \$&#39; \$` \$\$ B · Ekran<\/title>/);
});

test('sayfaUret: eksik ya da çift işaretçi Error verir, hangi işaretçi olduğu yazılı', () => {
  const s = okuFikstur('index.html');
  const veri = s.match(/<script\b[^>]*\bid="ekran-veri"[\s\S]*?<\/script>/)[0];
  assert.throws(() => sayfaUret(s.replace(TITLE, () => ''), cami()), /<title>/);
  assert.throws(() => sayfaUret(s.replace(TITLE, (m) => m + m), cami()), /<title>/);
  assert.throws(() => sayfaUret(s.replace(veri, () => ''), cami()), /ekran-veri/);
  assert.throws(() => sayfaUret(s.replace(veri, () => veri + veri), cami()), /ekran-veri/);
  assert.throws(() => sayfaUret(s.replace(veri, () => '<script id="ekran-veri" type="application/json">{bozuk</script>'), cami()), /ekran-veri/);
  assert.throws(() => sayfaUret(s.replace(/<img\b[^>]*logo-koyu[^>]*>/, () => ''), cami()), /logo/);
  assert.throws(() => sayfaUret(s.replace('noindex, nofollow', 'index, follow'), cami()), /noindex/);
  assert.throws(() => sayfaUret(s.replace('/ekran/ekran.css', '/x/y.css'), cami()), /ekran\.css/);
  assert.throws(() => sayfaUret(s.replace('/ekran/ekran.js', '/x/y.js'), cami()), /ekran\.js/);
  assert.throws(() => sayfaUret('', cami()), /<title>/);
});

test('sayfaUret: eksik cami alanları Error verir', () => {
  const s = okuFikstur('index.html');
  assert.throws(() => sayfaUret(s, cami({ adTr: '' })), /adTr/);
  assert.throws(() => sayfaUret(s, cami({ ilce: undefined })), /ilce/);
  assert.throws(() => sayfaUret(s, cami({ konum: undefined })), /konum/);
});

/** #ekran-veri JSON'unu `f` ile dönüştürüp sayfaya geri yazar (test yardımcısı). */
const veriDegistir = (html, f) =>
  html.replace(/(<script\b[^>]*\bid="ekran-veri"[^>]*>)([\s\S]*?)(<\/script>)/, (_t, ac, g, kapa) => ac + JSON.stringify(f(JSON.parse(g))) + kapa);

test('sayfaUret: şablonun #ekran-veri\'sinde bilinmeyen anahtar Error verir (yeni site alanı sessizce düşmez); bilinen anahtarlar geçer', () => {
  const s = okuFikstur('index.html');
  assert.throws(() => sayfaUret(veriDegistir(s, (v) => ({ ...v, yeniAlan: 1 })), cami()), /yeniAlan/);
  assert.throws(() => sayfaUret(veriDegistir(s, (v) => ({ ...v, ilce: '11890', ekstra: [] })), cami()), /ekstra/);
  // ilce şablonda varsa da yoksa da geçer; değer her zaman caminin kendisinden gelir
  const ilceli = sayfaUret(veriDegistir(s, (v) => ({ ...v, ilce: '11890' })), cami());
  assert.equal(veriOku(ilceli).ilce, '12345');
  assert.ok(!('ilce' in veriOku(s)), 'gerçek fikstürde ilce yok (eski iskelet)');
  assert.equal(veriOku(sayfaUret(s, cami())).ilce, '12345');
});

// ---------------------------------------------------------------- akisUret

test('akisUret: sitenin duyuruları dolu olsa da çıktı boş (Ulu Camii duyurusu sızmaz); ayar siteden', () => {
  const site = okuFikstur('akis.json');
  const siteJson = JSON.parse(site);
  assert.ok(siteJson.duyurular.length > 0, 'fikstürde dolu duyuru olmalı');
  const cikti = akisUret(site, null);
  const j = JSON.parse(cikti);
  assert.deepEqual(j.duyurular, []);
  assert.deepEqual(j.ayar, siteJson.ayar);
  assert.ok(!cikti.includes('SIZINTI-ISARETI'));
});

test('akisUret: ayar eskisiyle aynıysa eski metin bayt bayt döner (derleme anı değişse de)', () => {
  const site = okuFikstur('akis.json');
  const eski = JSON.stringify({ derleme: '2026-01-01T00:00:00.000Z', ayar: JSON.parse(site).ayar, duyurular: [] }, null, 1);
  assert.equal(akisUret(site, eski), eski);
});

test('akisUret: ayar değişmişse, eski yoksa/bozuksa ya da eskide duyuru varsa yeni metin (boş duyurulu)', () => {
  const site = okuFikstur('akis.json');
  const ayar = JSON.parse(site).ayar;
  const degisik = JSON.stringify({ derleme: 'x', ayar: { ...ayar, turHedefSn: 999 }, duyurular: [] });
  for (const eski of [degisik, null, '{bozuk', JSON.stringify({ derleme: 'x', ayar, duyurular: [{ id: 'sizdi' }] })]) {
    const cikti = akisUret(site, eski);
    assert.notEqual(cikti, eski);
    const j = JSON.parse(cikti);
    assert.deepEqual(j.ayar, ayar);
    assert.deepEqual(j.duyurular, []);
  }
});

test('akisUret: bozuk ya da eksik site akışı Error verir', () => {
  const ayar = JSON.parse(okuFikstur('akis.json')).ayar;
  assert.throws(() => akisUret('{bozuk', null), /akis\.json/);
  assert.throws(() => akisUret(JSON.stringify({ ayar: {}, duyurular: [] }), null), /ayar\.slayt/);
  assert.throws(() => akisUret(JSON.stringify({ duyurular: [] }), null), /ayar\.slayt/);
  assert.throws(() => akisUret(JSON.stringify({ ayar }), null), /duyurular/);
  assert.throws(() => akisUret('[]', null), /akis\.json/);
});

// ---------------------------------------------------------------- icerikUret

test('icerikUret: derleme dışında aynıysa eski metin aynen; içerik değişmişse ya da eski yoksa site metni', () => {
  const site = okuFikstur('icerik.json');
  const eski = site.replace('2026-10-27T10:40:24.325Z', '2026-01-01T00:00:00.000Z');
  assert.notEqual(eski, site);
  assert.equal(icerikUret(site, eski), eski);
  const degisik = JSON.stringify({ ...JSON.parse(site), hadisler: [] });
  assert.equal(icerikUret(site, degisik), site);
  assert.equal(icerikUret(site, null), site);
  assert.equal(icerikUret(site, '{bozuk'), site);
});

test('icerikUret: ayetler ya da hadisler dizi değilse, bozuk JSON ise Error', () => {
  assert.throws(() => icerikUret(JSON.stringify({ derleme: 'x', ayetler: {}, hadisler: [] }), null), /ayetler/);
  assert.throws(() => icerikUret(JSON.stringify({ derleme: 'x', ayetler: [], hadisler: 'a' }), null), /hadisler/);
  assert.throws(() => icerikUret(JSON.stringify({ derleme: 'x', ayetler: [], hadisler: [], dualar: 1 }), null), /dualar/);
  assert.throws(() => icerikUret('{bozuk', null), /icerik\.json/);
});

// ---------------------------------------------------------------- swUret, surumHesapla

test('swUret: yer tutucu tam bir kez değiştirilir; 0 ya da 2 kez ise ya da sürüm biçimsizse Error', () => {
  const sw = okuFikstur('sw.js');
  const cikti = swUret(sw, '0123456789abcdef');
  assert.ok(!cikti.includes('@@EKRAN_SURUM@@'));
  assert.ok(cikti.includes('var S="0123456789abcdef";'));
  assert.throws(() => swUret('"use strict";', '0123456789abcdef'), /EKRAN_SURUM/);
  assert.throws(() => swUret(sw + sw, '0123456789abcdef'), /EKRAN_SURUM/);
  for (const kotu of ['', 'xyz', '0123456789ABCDEF', '0123456789abcde', '0123456789abcdef0', '$&$&$&$&$&$&$&$&']) {
    assert.throws(() => swUret(sw, kotu), /sürüm/, kotu);
  }
});

test('surumHesapla: 16 hex, siteninkiyle aynı kural (bilinen vektör), sıradan bağımsız, her bayta duyarlı', () => {
  const a = [['/ekran/b.js', 'xyz'], ['/ekran/a.css', 'merhaba']];
  const b = [['/ekran/a.css', 'merhaba'], ['/ekran/b.js', 'xyz']];
  assert.match(surumHesapla(a), /^[0-9a-f]{16}$/);
  assert.equal(surumHesapla(a), 'f6b2fc23f05d3e8d', 'site damga kuralıyla aynı çıktı');
  assert.equal(surumHesapla(a), surumHesapla(b));
  assert.equal(surumHesapla(a), surumHesapla(a));
  // bayt, ad ve sınır değişince değişir
  assert.notEqual(surumHesapla(a), surumHesapla([['/ekran/b.js', 'xyZ'], ['/ekran/a.css', 'merhaba']]));
  assert.notEqual(surumHesapla(a), surumHesapla([['/ekran/b.jx', 'xyz'], ['/ekran/a.css', 'merhaba']]));
  assert.notEqual(surumHesapla([['a', 'bc'], ['d', 'e']]), surumHesapla([['a', 'b'], ['cd', 'e']]));
  // metin ve bayt aynı sonucu verir
  assert.equal(surumHesapla([['/x', Buffer.from('çay', 'utf8')]]), surumHesapla([['/x', 'çay']]));
  assert.equal(surumHesapla([['/x', new Uint8Array([1, 2, 3])]]), surumHesapla([['/x', Buffer.from([1, 2, 3])]]));
  assert.notEqual(surumHesapla([['/x', Buffer.from([1, 2, 3])]]), surumHesapla([['/x', Buffer.from([1, 2, 4])]]));
});

// ---------------------------------------------------------------- yerlestir

test('yerlestir: referans cami yazılmaz, platform camileri dört dosya alır, kök dosyalar bayt bayt aynı; ikinci koşuda yazılan boş', async () => {
  const paket = paketKopyala();
  // paketle gelen Ulu Camii vakitleri hiçbir yere kopyalanmamalı
  writeFileSync(join(paket, 'vakitler.json'), JSON.stringify({ ilce: '11890', kaynakTuru: 'diyanet', gunler: [{ tarih: '2026-10-27' }] }));
  const kok = kokKur();
  const once = agac(kok);
  const camiler = camilerOku(readFileSync(join(kok, 'camiler.json'), 'utf8'));

  const s1 = await yerlestir({ paket, kok, camiler });
  const sonra = agac(kok);

  // dokunulmayanlar bayt bayt aynı
  for (const y of ['camiler.json', 'index.html', 'camipano/releases/x.apk', 'c/deneme-a/vakitler.json']) assert.equal(sonra[y], once[y], y);
  // yeni dosyalar tam olarak beklenen küme
  const yeni = Object.keys(sonra).filter((y) => !(y in once) && !y.endsWith('/'));
  const beklenen = [...MOTOR, ...dortDosya('deneme-a'), ...dortDosya('deneme-b')];
  assert.deepEqual(sirali(yeni), sirali([...beklenen, 'c/.ekran-yazilan']));
  assert.deepEqual(sirali(s1.yazilan), sirali(beklenen));
  assert.deepEqual(s1.silinen, []);
  assert.deepEqual(s1.atlanan, ['ulucamii-marche']);
  assert.ok(!existsSync(join(kok, 'c', 'ulucamii-marche')));
  assert.ok(!existsSync(join(kok, 'ekran', 'vakitler.json')));
  assert.ok(!existsSync(join(kok, 'c', 'deneme-b', 'vakitler.json')));
  // motor dosyaları pakettekiyle bayt bayt aynı
  for (const d of ['ekran.js', 'ekran.css', 'butce.json', 'fonts/a.woff2']) {
    assert.ok(readFileSync(join(kok, 'ekran', d)).equals(readFileSync(join(paket, d))), d);
  }
  // iki caminin sw.js ve sürümleri farklı; yer tutucu kalmadı
  const swA = readFileSync(join(kok, 'c/deneme-a/sw.js'), 'utf8');
  const swB = readFileSync(join(kok, 'c/deneme-b/sw.js'), 'utf8');
  assert.match(swA, /var S="[0-9a-f]{16}";/);
  assert.match(swB, /var S="[0-9a-f]{16}";/);
  assert.notEqual(swA, swB);
  assert.ok(!swA.includes('@@EKRAN_SURUM@@') && !swB.includes('@@EKRAN_SURUM@@'));
  // sayfalar kendi cami kimliğini taşır
  const vA = veriOku(readFileSync(join(kok, 'c/deneme-a/index.html'), 'utf8'));
  const vB = veriOku(readFileSync(join(kok, 'c/deneme-b/index.html'), 'utf8'));
  assert.equal(vA.cami.tr, 'Deneme A Camii'); assert.equal(vA.ilce, '12345'); assert.equal(vA.cumaSaati, '');
  assert.equal(vB.cami.tr, 'Deneme B Camii'); assert.equal(vB.cami.fr, 'Deneme B Camii'); assert.equal(vB.ilce, '67890'); assert.equal(vB.cumaSaati, '13:05');
  // Ulu Camii verisi hiçbir cami dosyasına girmedi
  for (const y of beklenen.filter((x) => x.startsWith('c/'))) {
    const m = readFileSync(join(kok, y), 'utf8');
    assert.ok(!m.includes('SIZINTI-ISARETI'), y);
    assert.ok(!m.includes('11890'), y);
    if (y.endsWith('/akis.json')) assert.deepEqual(JSON.parse(m).duyurular, [], y);
  }
  // değişen yolların listesi
  const liste = readFileSync(join(kok, 'c', '.ekran-yazilan'), 'utf8');
  assert.deepEqual(sirali(liste.split('\n').filter(Boolean)), sirali(beklenen));

  // ikinci koşu: yazılan boş, ağaç aynı (liste dosyası boşalır)
  const s2 = await yerlestir({ paket, kok, camiler });
  assert.deepEqual(s2.yazilan, []);
  assert.deepEqual(s2.silinen, []);
  const ikinci = agac(kok);
  const listesiz = (a) => Object.fromEntries(Object.entries(a).filter(([y]) => y !== 'c/.ekran-yazilan'));
  assert.deepEqual(listesiz(ikinci), listesiz(sonra));
  assert.equal(readFileSync(join(kok, 'c', '.ekran-yazilan'), 'utf8'), '');
});

test('yerlestir: sitenin yalnız derleme anı değişince (akış, içerik) hiçbir şey yazılmaz; gerçek değişiklikte yalnız ilgili dosyalar', async () => {
  const paket = paketKopyala();
  const kok = kokKur();
  const camiler = camilerOku(readFileSync(join(kok, 'camiler.json'), 'utf8'));
  await yerlestir({ paket, kok, camiler });

  // yalnız derleme anı
  const akis = JSON.parse(readFileSync(join(paket, 'akis.json'), 'utf8'));
  akis.derleme = '2027-01-01T00:00:00.000Z';
  writeFileSync(join(paket, 'akis.json'), JSON.stringify(akis));
  const icerik = JSON.parse(readFileSync(join(paket, 'icerik.json'), 'utf8'));
  icerik.derleme = '2027-01-01T00:00:00.000Z';
  writeFileSync(join(paket, 'icerik.json'), JSON.stringify(icerik));
  assert.deepEqual((await yerlestir({ paket, kok, camiler })).yazilan, []);

  // akış ayarı değişir: yalnız iki akis.json
  akis.ayar.turHedefSn = 999;
  writeFileSync(join(paket, 'akis.json'), JSON.stringify(akis));
  assert.deepEqual(sirali((await yerlestir({ paket, kok, camiler })).yazilan), sirali(['c/deneme-a/akis.json', 'c/deneme-b/akis.json']));

  // içerik değişir: yalnız iki icerik.json
  icerik.hadisler = [];
  writeFileSync(join(paket, 'icerik.json'), JSON.stringify(icerik));
  assert.deepEqual(sirali((await yerlestir({ paket, kok, camiler })).yazilan), sirali(['c/deneme-a/icerik.json', 'c/deneme-b/icerik.json']));

  // motor değişir: ekran.js ve her caminin sw.js'i (sürüm yenilenir), sayfalar ve veri akışları değil
  writeFileSync(join(paket, 'ekran.js'), '"use strict";/* yeni motor */');
  assert.deepEqual(sirali((await yerlestir({ paket, kok, camiler })).yazilan), sirali(['ekran/ekran.js', 'c/deneme-a/sw.js', 'c/deneme-b/sw.js']));

  // caminin kendi bilgisi (Cuma saati) değişir: yalnız o caminin index.html'i ve sw.js'i
  const camiler2 = camiler.map((c) => (c.camiId === 'deneme-a' ? { ...c, cumaSaati: '12:45' } : c));
  assert.deepEqual(sirali((await yerlestir({ paket, kok, camiler: camiler2 })).yazilan), sirali(['c/deneme-a/index.html', 'c/deneme-a/sw.js']));
});

test('yerlestir: aynı sayfayı alan iki cami bile farklı SW sürümü alır (sürüme kapsam yolu girer)', async () => {
  const paket = paketKopyala();
  const camiler = [cami({ camiId: 'ayni-a', slug: 'ayni-a' }), cami({ camiId: 'ayni-b', slug: 'ayni-b' })];
  const kok = kokKur(camiler);
  await yerlestir({ paket, kok, camiler: camilerOku(readFileSync(join(kok, 'camiler.json'), 'utf8')) });
  assert.equal(readFileSync(join(kok, 'c/ayni-a/index.html'), 'utf8'), readFileSync(join(kok, 'c/ayni-b/index.html'), 'utf8'));
  assert.notEqual(readFileSync(join(kok, 'c/ayni-a/sw.js'), 'utf8'), readFileSync(join(kok, 'c/ayni-b/sw.js'), 'utf8'));
});

test('yerlestir: pakette olmayan eski yazı tipleri silinir ve silinen listesine girer', async () => {
  const paket = paketKopyala();
  const kok = kokKur();
  mkdirSync(join(kok, 'ekran', 'fonts'), { recursive: true });
  writeFileSync(join(kok, 'ekran', 'fonts', 'eski.woff2'), 'eski');
  writeFileSync(join(kok, 'ekran', 'fonts', 'a.woff2'), 'eski-a');
  const camiler = camilerOku(readFileSync(join(kok, 'camiler.json'), 'utf8'));
  const s = await yerlestir({ paket, kok, camiler });
  assert.deepEqual(s.silinen, ['ekran/fonts/eski.woff2']);
  assert.ok(!existsSync(join(kok, 'ekran', 'fonts', 'eski.woff2')));
  assert.ok(s.yazilan.includes('ekran/fonts/a.woff2'));
  assert.ok(readFileSync(join(kok, 'ekran/fonts/a.woff2')).equals(readFileSync(join(paket, 'fonts/a.woff2'))));
  const liste = readFileSync(join(kok, 'c', '.ekran-yazilan'), 'utf8').split('\n').filter(Boolean);
  assert.ok(liste.includes('ekran/fonts/eski.woff2') && liste.includes('ekran/fonts/a.woff2'));
});

test('yerlestir: referans caminin kendi klasörü varsa ona dokunulmaz, hiçbir dosya eklenmez', async () => {
  const paket = paketKopyala();
  const kok = kokKur();
  mkdirSync(join(kok, 'c', 'ulucamii-marche'), { recursive: true });
  writeFileSync(join(kok, 'c', 'ulucamii-marche', 'vakitler.json'), '{"ilce":"11890"}');
  const camiler = camilerOku(readFileSync(join(kok, 'camiler.json'), 'utf8'));
  await yerlestir({ paket, kok, camiler });
  assert.deepEqual(readdirSync(join(kok, 'c', 'ulucamii-marche')), ['vakitler.json']);
  assert.equal(readFileSync(join(kok, 'c', 'ulucamii-marche', 'vakitler.json'), 'utf8'), '{"ilce":"11890"}');
});

test('yerlestir: düşmanca cami adı yerleştirilen sayfayı bozmaz', async () => {
  const paket = paketKopyala();
  const dusman = '</script><script>alert(1)</script>';
  const camiler = [cami({ camiId: 'deneme-x', slug: 'deneme-x', adTr: dusman, adFr: '' })];
  const kok = kokKur(camiler);
  await yerlestir({ paket, kok, camiler: camilerOku(readFileSync(join(kok, 'camiler.json'), 'utf8')) });
  const html = readFileSync(join(kok, 'c/deneme-x/index.html'), 'utf8');
  assert.ok(!html.includes('alert(1)</script>'));
  assert.equal((html.match(/<script\b/g) || []).length, 2);
  assert.equal(veriOku(html).cami.tr, dusman);
});

const BOZUK_PAKETLER = [
  ['icerik.json yok', (p) => rmSync(join(p, 'icerik.json'))],
  ['akis.json yok', (p) => rmSync(join(p, 'akis.json'))],
  ['ekran.js yok', (p) => rmSync(join(p, 'ekran.js'))],
  ['ekran.css yok', (p) => rmSync(join(p, 'ekran.css'))],
  ['butce.json yok', (p) => rmSync(join(p, 'butce.json'))],
  ['sw.js yok', (p) => rmSync(join(p, 'sw.js'))],
  ['index.html yok', (p) => rmSync(join(p, 'index.html'))],
  ['akis.json ayar.slayt yok', (p) => writeFileSync(join(p, 'akis.json'), JSON.stringify({ derleme: 'x', ayar: {}, duyurular: [] }))],
  ['akis.json bozuk', (p) => writeFileSync(join(p, 'akis.json'), '{bozuk')],
  ['ayetler dizi değil', (p) => writeFileSync(join(p, 'icerik.json'), JSON.stringify({ derleme: 'x', ayetler: {}, hadisler: [] }))],
  ['butce.json bozuk', (p) => writeFileSync(join(p, 'butce.json'), '{bozuk')],
  ['fonts boş', (p) => { rmSync(join(p, 'fonts'), { recursive: true }); mkdirSync(join(p, 'fonts')); }],
  ['fonts yok', (p) => rmSync(join(p, 'fonts'), { recursive: true })],
  ['fonts içinde alt dizin', (p) => mkdirSync(join(p, 'fonts', 'alt'))],
  ['yazı tipi adı güvensiz', (p) => writeFileSync(join(p, 'fonts', 'a..b.woff2'), 'x')],
  ['sw.js yer tutucusu yok', (p) => writeFileSync(join(p, 'sw.js'), '"use strict";')],
  ['sw.js yer tutucusu iki kez', (p) => writeFileSync(join(p, 'sw.js'), '"@@EKRAN_SURUM@@";"@@EKRAN_SURUM@@";')],
  ['index.html başlığı yok', (p) => writeFileSync(join(p, 'index.html'), readFileSync(join(p, 'index.html'), 'utf8').replace(TITLE, () => ''))],
  ['index.html ekran-veri çift', (p) => {
    const s = readFileSync(join(p, 'index.html'), 'utf8');
    const v = s.match(/<script\b[^>]*\bid="ekran-veri"[\s\S]*?<\/script>/)[0];
    writeFileSync(join(p, 'index.html'), s.replace(v, () => v + v));
  }],
];
for (const [ad, boz] of BOZUK_PAKETLER) {
  test(`yerlestir: bozuk/eksik paket (${ad}) Error verir ve kök hiç değişmez`, async () => {
    const paket = paketKopyala();
    boz(paket);
    const kok = kokKur();
    const camiler = camilerOku(readFileSync(join(kok, 'camiler.json'), 'utf8'));
    const once = agac(kok);
    await assert.rejects(yerlestir({ paket, kok, camiler }), Error);
    assert.deepEqual(agac(kok), once);
  });
}

test('yerlestir: bozuk cami listesi (geçersiz kimlik, yinelenen kimlik) Error verir ve kök hiç değişmez', async () => {
  const paket = paketKopyala();
  const kok = kokKur();
  const once = agac(kok);
  await assert.rejects(yerlestir({ paket, kok, camiler: [cami({ camiId: '../kacis' })] }), /camiId/);
  await assert.rejects(yerlestir({ paket, kok, camiler: [cami(), cami()] }), /yinelenen/);
  await assert.rejects(yerlestir({ paket, kok, camiler: [cami(), cami({ camiId: 'deneme-b', ilce: 'abc' })] }), /ilce/);
  await assert.rejects(yerlestir({ paket, kok, camiler: 'liste-degil' }), Error);
  assert.deepEqual(agac(kok), once);
});

test('yerlestir: paket dizini yoksa Error verir', async () => {
  const kok = kokKur();
  const once = agac(kok);
  await assert.rejects(yerlestir({ paket: join(kok, 'yok-boyle-dizin'), kok, camiler: [cami()] }), Error);
  assert.deepEqual(agac(kok), once);
});

// ---------------------------------------------------------------- şablon doğrulaması cami listesinden bağımsız

const BOZUK_SABLONLAR = [
  ['index.html başlığı yok', (p) => writeFileSync(join(p, 'index.html'), readFileSync(join(p, 'index.html'), 'utf8').replace(TITLE, () => ''))],
  ['index.html noindex yok', (p) => writeFileSync(join(p, 'index.html'), readFileSync(join(p, 'index.html'), 'utf8').replace('noindex, nofollow', 'index, follow'))],
  ['index.html ekran-veri bilinmeyen anahtar', (p) => writeFileSync(join(p, 'index.html'), veriDegistir(readFileSync(join(p, 'index.html'), 'utf8'), (v) => ({ ...v, yeniAlan: 1 })))],
  ['akis.json ayar.slayt yok', (p) => writeFileSync(join(p, 'akis.json'), JSON.stringify({ derleme: 'x', ayar: {}, duyurular: [] }))],
  ['akis.json duyurular dizi değil', (p) => writeFileSync(join(p, 'akis.json'), JSON.stringify({ derleme: 'x', ayar: { slayt: {} }, duyurular: 1 }))],
  ['icerik.json ayetler dizi değil', (p) => writeFileSync(join(p, 'icerik.json'), JSON.stringify({ derleme: 'x', ayetler: {}, hadisler: [] }))],
];
const LISTELER = [['yalnız referans cami', () => [REFERANS]], ['boş cami listesi', () => []]];
for (const [ad, boz] of BOZUK_SABLONLAR) {
  for (const [listeAdi, liste] of LISTELER) {
    test(`yerlestir: bozuk şablon (${ad}) + ${listeAdi} Error verir ve kök hiç değişmez (ortak ekran/ dosyaları da yazılmaz)`, async () => {
      const paket = paketKopyala();
      boz(paket);
      const kok = kokKur(liste());
      const once = agac(kok);
      await assert.rejects(yerlestir({ paket, kok, camiler: camilerOku(readFileSync(join(kok, 'camiler.json'), 'utf8')) }), Error);
      assert.deepEqual(agac(kok), once);
      assert.ok(!existsSync(join(kok, 'ekran')));
    });
  }
}

test('yerlestir: geçerli şablon + yalnız referans cami → ortak ekran/ dosyaları yazılır, cami sayfası yazılmaz', async () => {
  const paket = paketKopyala();
  const kok = kokKur([REFERANS]);
  const s = await yerlestir({ paket, kok, camiler: camilerOku(readFileSync(join(kok, 'camiler.json'), 'utf8')) });
  assert.deepEqual(sirali(s.yazilan), sirali(MOTOR));
  assert.deepEqual(s.atlanan, ['ulucamii-marche']);
  assert.ok(!existsSync(join(kok, 'c', 'ulucamii-marche')));
});

// ---------------------------------------------------------------- hedef yol çatışmaları: ilk yazımdan önce dur

const YOL_CATISMALARI = [
  ['c/deneme-a/akis.json bir dizin', (k) => mkdirSync(join(k, 'c/deneme-a/akis.json'), { recursive: true }), /hedef yol bir dizin: c\/deneme-a\/akis\.json/],
  ['c/deneme-b/index.html bir dizin', (k) => mkdirSync(join(k, 'c/deneme-b/index.html'), { recursive: true }), /hedef yol bir dizin: c\/deneme-b\/index\.html/],
  ['ekran/ekran.js bir dizin', (k) => mkdirSync(join(k, 'ekran/ekran.js'), { recursive: true }), /hedef yol bir dizin: ekran\/ekran\.js/],
  ['ekran/fonts/a.woff2 bir dizin', (k) => mkdirSync(join(k, 'ekran/fonts/a.woff2'), { recursive: true }), /hedef yol bir dizin: ekran\/fonts\/a\.woff2/],
  ['c/.ekran-yazilan bir dizin', (k) => mkdirSync(join(k, 'c/.ekran-yazilan'), { recursive: true }), /hedef yol bir dizin: c\/\.ekran-yazilan/],
  ['ekran bir dosya', (k) => writeFileSync(join(k, 'ekran'), 'x'), /üst dizini dosya: ekran\b/],
  ['ekran/fonts bir dosya', (k) => { mkdirSync(join(k, 'ekran'), { recursive: true }); writeFileSync(join(k, 'ekran/fonts'), 'x'); }, /üst dizini dosya: ekran\/fonts/],
  ['c/deneme-b bir dosya', (k) => writeFileSync(join(k, 'c/deneme-b'), 'x'), /üst dizini dosya: c\/deneme-b/],
  ['c bir dosya', (k) => { rmSync(join(k, 'c'), { recursive: true }); writeFileSync(join(k, 'c'), 'x'); }, /üst dizini dosya: c\b/],
];
for (const [ad, hazirla, beklenen] of YOL_CATISMALARI) {
  test(`yerlestir: ${ad} → Error verir, ilk yazımdan önce durur (kök hiç değişmez)`, async () => {
    const paket = paketKopyala();
    const kok = kokKur();
    hazirla(kok);
    const once = agac(kok);
    await assert.rejects(yerlestir({ paket, kok, camiler: camilerOku(readFileSync(join(kok, 'camiler.json'), 'utf8')) }), beklenen);
    assert.deepEqual(agac(kok), once);
  });
}

// ---------------------------------------------------------------- CLI

const calistir = (...args) => spawnSync(process.execPath, [YERLESTIR_MJS, ...args], { encoding: 'utf8' });

test('CLI: başarıda 0 çıkar ve yerleştirir', () => {
  const paket = paketKopyala();
  const kok = kokKur();
  const r = calistir('--paket', paket, '--kok', kok);
  assert.equal(r.status, 0, r.stderr);
  for (const y of [...MOTOR, ...dortDosya('deneme-a'), ...dortDosya('deneme-b')]) assert.ok(existsSync(join(kok, y)), y);
  assert.ok(!existsSync(join(kok, 'c', 'ulucamii-marche')));
  const r2 = calistir('--paket', paket, '--kok', kok);
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(readFileSync(join(kok, 'c', '.ekran-yazilan'), 'utf8'), '');
});

test('CLI: bozuk camiler.json, eksik paket ve bilinmeyen argüman 1 ile çıkar; hiçbir şey yazılmaz', () => {
  const paket = paketKopyala();
  const kok = kokKur();
  writeFileSync(join(kok, 'camiler.json'), '{bozuk');
  const once = agac(kok);
  const r = calistir('--paket', paket, '--kok', kok);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /camiler\.json/);
  assert.deepEqual(agac(kok), once);

  const kok2 = kokKur();
  const once2 = agac(kok2);
  rmSync(join(paket, 'icerik.json'));
  assert.equal(calistir('--paket', paket, '--kok', kok2).status, 1);
  assert.equal(calistir('--kok', kok2).status, 1);
  assert.equal(calistir('--paket', paket, '--kok', kok2, '--bilinmeyen', 'x').status, 1);
  assert.deepEqual(agac(kok2), once2);
});
