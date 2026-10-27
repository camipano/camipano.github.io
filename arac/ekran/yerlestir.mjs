// Platform ekran sayfası yerleştirme: sitenin derlediği ekran paketi → cami başına sayfa.
// Akış: paket, şablonlar (cami listesinden bağımsız) ve cami listesi doğrulanır, her şey bellekte üretilir, yol çatışmaları
// denetlenir, SONRA yazılır (bozuk girdide kök hiç değişmez).
// Yazdığı yerler yalnız: ekran/{ekran.js,ekran.css,butce.json,fonts/*} ve her (referans olmayan) cami için
// c/<camiId>/{index.html,sw.js,icerik.json,akis.json}. Paketin vakitler.json'u KOPYALANMAZ (Ulu Camii'nindir).
// Ulu Camii verisi cami sayfalarına sızmaz: duyurular boşaltılır, sayfa kimliği caminin kendisinden gelir.
//
// CLI: node arac/ekran/yerlestir.mjs --paket <dizin> [--kok <dizin = .>]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { camilerOku } from '../vakit/camiler.mjs';

/** Sayfası dernek sitesinde (ulucamii.be/ekran/) kalan cami: bu depoya yerleştirilmez. */
export const REFERANS_CAMILER = ['ulucamii-marche'];

/** Değişen yolların listesi: yayın adımı yalnız bu satırları ekler (c/ altında, git'e girmez). */
const YAZILAN_DOSYA = '.ekran-yazilan';
const YER_TUTUCU = '@@EKRAN_SURUM@@';
const SURUM = /^[0-9a-f]{16}$/;
/** Yayın adımındaki yol süzgeciyle uyumlu: harf/rakam başlar, `..` içermez. */
const FONT_ADI = /^[A-Za-z0-9](?!.*\.\.)[A-Za-z0-9._-]*$/;
/** Şablonun #ekran-veri anahtarları: sayfa verisi bunlardan yeniden kurulur (ilce şablonda olmayabilir: eski iskelet). */
const VERI_ANAHTARLARI = ['cami', 'vakit', 'gps', 'cumaSaati', 'ilce'];
/** Şablon sınaması için uydurma geçerli cami: cami listesi boş ya da yalnız referans olsa da şablonlar doğrulanır. */
const SINAMA_CAMISI = {
  camiId: 'sinama-cami', adTr: 'Sınama Camii', adFr: 'Mosquée de sinama', ilce: '1', ilceAdi: 'SINAMA', slug: 'sinama',
  saatDilimi: 'Europe/Brussels', konum: { enlem: 0, boylam: 0 }, cumaSaati: '',
};

const nesne = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);

function jsonOku(govde, ad) {
  try { return JSON.parse(govde); } catch (e) { throw new Error(`${ad} bozuk: ${e.message}`); }
}

// ------------------------------------------------------------------ sayfa

const KACIS = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const htmlKacis = (s) => s.replace(/[&<>"']/g, (c) => KACIS[c]);

const TITLE = /<title>[\s\S]*?<\/title>/g;
const VERI = /(<script\b[^>]*\bid="ekran-veri"[^>]*>)([\s\S]*?)(<\/script>)/g;
const LOGO = /<img\b[^>]*\bclass="logo\b[^"]*"[^>]*>/g;
const NOINDEX = /<meta\b[^>]*\bname="robots"[^>]*noindex[^>]*>/g;
const CSS_BAGI = /\bhref="\/ekran\/ekran\.css"/g;
const JS_BAGI = /\bsrc="\/ekran\/ekran\.js"/g;

/** İşaretçi tam `beklenen` kez bulunmalı; yoksa hangisi olduğu yazılı Error. */
function isaretciDene(html, desen, ad, beklenen = 1) {
  const n = [...html.matchAll(desen)].length;
  if (n !== beklenen) throw new Error(`sayfa işaretçisi ${beklenen} kez bulunmalı, ${n} kez bulundu: ${ad}`);
}

/** Tek cami kaydını camiler.json şemasıyla doğrular (aynı kurallar, tek kaynak). */
function camiDogrula(cami) {
  return camilerOku(JSON.stringify({ surum: 1, camiler: [cami] }))[0];
}

/** Sitenin ekran iskeletinden bir caminin sayfasını üretir: başlık, #ekran-veri, logolar. */
export function sayfaUret(indexHtml, cami) {
  if (typeof indexHtml !== 'string') throw new Error('index.html metin olmalı');
  const c = camiDogrula(cami);
  isaretciDene(indexHtml, TITLE, '<title>');
  isaretciDene(indexHtml, VERI, '#ekran-veri');
  isaretciDene(indexHtml, LOGO, 'logo <img class="logo …">', 2);
  isaretciDene(indexHtml, NOINDEX, 'noindex (robots)');
  isaretciDene(indexHtml, CSS_BAGI, '/ekran/ekran.css bağlantısı');
  isaretciDene(indexHtml, JS_BAGI, '/ekran/ekran.js bağlantısı');
  const sablon = jsonOku([...indexHtml.matchAll(VERI)][0][2], '#ekran-veri');
  if (!nesne(sablon) || !nesne(sablon.vakit)) throw new Error('#ekran-veri: vakit sözlüğü yok');
  // Veri sıfırdan kurulur: tanınmayan şablon anahtarı sessizce düşmesin (sitenin yeni alanı fark edilsin).
  for (const k of Object.keys(sablon)) {
    if (!VERI_ANAHTARLARI.includes(k)) throw new Error(`#ekran-veri: tanınmayan anahtar "${k}" (sayfaya taşınmaz; önce yerlestir.mjs güncellenmeli)`);
  }

  const veri = {
    cami: { tr: c.adTr, fr: c.adFr.trim() === '' ? c.adTr : c.adFr },
    vakit: sablon.vakit,
    gps: { enlem: c.konum.enlem, boylam: c.konum.boylam },
    cumaSaati: c.cumaSaati,
    ilce: c.ilce,
  };
  // Değiştirme işlevleri: addaki `$&`, `$1` gibi desenler yorumlanmasın. Başlık EN SON yazılır (kaçışlıdır, yine de).
  const json = JSON.stringify(veri).replace(/</g, '\\u003c');
  return indexHtml
    .replace(LOGO, () => '')
    .replace(VERI, (_t, ac, _g, kapa) => ac + json + kapa)
    .replace(TITLE, () => `<title>${htmlKacis(c.adTr)} · Ekran</title>`);
}

// ------------------------------------------------------------------ veri akışları

/** Sitenin akis.json'undan caminin akışı: `ayar` siteden, `duyurular` HER ZAMAN boş (Ulu Camii duyurusu sızmaz).
 *  Eski dosyanın ayarı aynı ve duyurusu boşsa eski metin aynen döner (derleme anı yüzünden depo şişmesin). */
export function akisUret(siteAkis, eski) {
  const site = jsonOku(siteAkis, 'akis.json');
  if (!nesne(site)) throw new Error('akis.json: nesne bekleniyor');
  if (!nesne(site.ayar) || !nesne(site.ayar.slayt)) throw new Error('akis.json: ayar.slayt yok');
  if (!Array.isArray(site.duyurular)) throw new Error('akis.json: duyurular dizi olmalı');
  if (typeof eski === 'string') {
    try {
      const e = JSON.parse(eski);
      if (nesne(e) && Array.isArray(e.duyurular) && e.duyurular.length === 0 && isDeepStrictEqual(e.ayar, site.ayar)) return eski;
    } catch { /* bozuk eski dosya: yeniden üretilir */ }
  }
  return JSON.stringify({ ...(typeof site.derleme === 'string' ? { derleme: site.derleme } : {}), ayar: site.ayar, duyurular: [] });
}

/** Sitenin icerik.json'u: `derleme` dışında eskisiyle aynıysa eski metin aynen (150 KB × cami şişmesin), yoksa site metni. */
export function icerikUret(siteIcerik, eski) {
  const site = jsonOku(siteIcerik, 'icerik.json');
  if (!nesne(site)) throw new Error('icerik.json: nesne bekleniyor');
  for (const alan of ['ayetler', 'hadisler']) if (!Array.isArray(site[alan])) throw new Error(`icerik.json: ${alan} dizi olmalı`);
  for (const alan of ['dualar', 'kartlar']) if (site[alan] !== undefined && !Array.isArray(site[alan])) throw new Error(`icerik.json: ${alan} dizi olmalı`);
  if (typeof eski === 'string') {
    try {
      const e = JSON.parse(eski);
      const { derleme: _a, ...eskiGovde } = nesne(e) ? e : {};
      const { derleme: _b, ...siteGovde } = site;
      if (nesne(e) && isDeepStrictEqual(eskiGovde, siteGovde)) return eski;
    } catch { /* bozuk eski dosya: site metni yazılır */ }
  }
  return siteIcerik;
}

// ------------------------------------------------------------------ sürüm ve service worker

/** [ad, bayt] çiftlerinden 16 haneli onaltılık SHA-256 özeti. Sitenin ekran damgasıyla aynı kural
 *  (scripts/ekran-damga.mjs → ekranDamgasi): ada göre sıralanır; ad ve bayt uzunluğu da özete girer. */
export function surumHesapla(dosyalar) {
  const ozet = createHash('sha256');
  for (const [ad, icerik] of [...dosyalar].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    const bayt = Buffer.from(icerik);
    ozet.update(`${ad}\0${bayt.length}\0`);
    ozet.update(bayt);
  }
  return ozet.digest('hex').slice(0, 16);
}

/** SW şablonundaki yer tutucuyu (tam bir kez) caminin sürümüyle değiştirir. */
export function swUret(swJs, surum) {
  if (typeof surum !== 'string' || !SURUM.test(surum)) throw new Error(`sw.js sürümü 16 küçük onaltılık hane olmalı (${String(surum)})`);
  const n = String(swJs).split(YER_TUTUCU).length - 1;
  if (n !== 1) throw new Error(`sw.js: ${YER_TUTUCU} tam bir kez bulunmalı, ${n} kez bulundu`);
  return swJs.replace(YER_TUTUCU, () => surum);
}

// ------------------------------------------------------------------ paket

function paketOku(paket) {
  if (typeof paket !== 'string' || !existsSync(paket) || !statSync(paket).isDirectory()) throw new Error('paket dizini yok');
  const dosya = (ad) => {
    const y = join(paket, ad);
    if (!existsSync(y) || !statSync(y).isFile()) throw new Error(`paket eksik: ${ad}`);
    const b = readFileSync(y);
    if (b.length === 0) throw new Error(`paket dosyası boş: ${ad}`);
    return b;
  };
  const butce = dosya('butce.json');
  if (!nesne(jsonOku(butce.toString('utf8'), 'butce.json'))) throw new Error('butce.json: nesne bekleniyor');
  const fontDizin = join(paket, 'fonts');
  if (!existsSync(fontDizin) || !statSync(fontDizin).isDirectory()) throw new Error('paket eksik: fonts/');
  const fontlar = readdirSync(fontDizin, { withFileTypes: true }).map((e) => {
    if (!e.isFile()) throw new Error(`fonts/ içinde dosya olmayan girdi: ${e.name}`);
    if (!FONT_ADI.test(e.name)) throw new Error(`fonts/ içinde güvensiz dosya adı: ${e.name}`);
    return [e.name, readFileSync(join(fontDizin, e.name))];
  }).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (fontlar.length === 0) throw new Error('fonts/ boş');
  return {
    index: dosya('index.html').toString('utf8'),
    ekranJs: dosya('ekran.js'),
    ekranCss: dosya('ekran.css'),
    sw: dosya('sw.js').toString('utf8'),
    akis: dosya('akis.json').toString('utf8'),
    icerik: dosya('icerik.json').toString('utf8'),
    butce,
    fontlar,
  };
}

// ------------------------------------------------------------------ yerleştirme

const yolu = (kok, goreli) => join(kok, ...goreli.split('/'));
const sirali = (d) => [...d].sort();

/** Yazımdan önce yol çatışması denetimi: hedef var olan bir dizin olmamalı, üst yollarından hiçbiri dosya olmamalı
 *  (yoksa yazım yarıda kalır). `yol`: kök'e göre `/` ayraçlı yol. */
function yolCatismasiDene(kok, yol) {
  const parcalar = yol.split('/');
  let ust = '';
  for (const parca of parcalar.slice(0, -1)) {
    ust = ust === '' ? parca : `${ust}/${parca}`;
    const y = yolu(kok, ust);
    if (!existsSync(y)) break; // üstü olmayanın altı da yoktur
    if (!statSync(y).isDirectory()) throw new Error(`hedef yolun üst dizini dosya: ${ust} (${yol})`);
  }
  const y = yolu(kok, yol);
  if (existsSync(y) && statSync(y).isDirectory()) throw new Error(`hedef yol bir dizin: ${yol}`);
}

/** Paketi `kok` altına yerleştirir. Önce her şey doğrulanıp bellekte üretilir; hata olursa hiçbir şey yazılmaz.
 *  Dönüş: `yazilan` (değişen yollar), `silinen` (paketle gelmeyen eski yazı tipleri), `atlanan` (referans cami kimlikleri). */
export async function yerlestir({ paket, kok, camiler }) {
  const liste = camilerOku(JSON.stringify({ surum: 1, camiler }));
  if (typeof kok !== 'string' || !existsSync(kok) || !statSync(kok).isDirectory()) throw new Error('kök dizini yok');
  const p = paketOku(paket);
  swUret(p.sw, '0'.repeat(16)); // şablonu baştan sına: yer tutucu tam bir kez
  // Şablonlar cami listesinden bağımsız sınanır: liste boş ya da yalnız referans cami olsa da ortak ekran/ dosyaları
  // yazılacağı için bozuk paket yazıma varmamalı.
  sayfaUret(p.index, SINAMA_CAMISI);
  akisUret(p.akis, null);
  icerikUret(p.icerik, null);

  /** hedef yol → bayt (yalnız izin verilen yerler) */
  const hedefler = new Map([
    ['ekran/ekran.js', p.ekranJs],
    ['ekran/ekran.css', p.ekranCss],
    ['ekran/butce.json', p.butce],
  ]);
  const fontlar = p.fontlar.map(([ad, bayt]) => [`ekran/fonts/${ad}`, bayt]);
  for (const [yol, bayt] of fontlar) hedefler.set(yol, bayt);

  const atlanan = [];
  for (const c of liste) {
    if (REFERANS_CAMILER.includes(c.camiId)) { atlanan.push(c.camiId); continue; }
    const dizin = `c/${c.camiId}`;
    const index = sayfaUret(p.index, c);
    // Cami sürümü: motor + yazı tipleri + SW şablonu + o caminin sayfası + kapsam yolu. Veri akışları girmez.
    const surum = surumHesapla([
      ['ekran/ekran.js', p.ekranJs], ['ekran/ekran.css', p.ekranCss], ...fontlar,
      ['sw.js', p.sw], ['index.html', index], ['kapsam', `/${dizin}/`],
    ]);
    const eskiOku = (ad) => {
      const y = yolu(kok, `${dizin}/${ad}`);
      return existsSync(y) && statSync(y).isFile() ? readFileSync(y, 'utf8') : null;
    };
    hedefler.set(`${dizin}/index.html`, Buffer.from(index, 'utf8'));
    hedefler.set(`${dizin}/sw.js`, Buffer.from(swUret(p.sw, surum), 'utf8'));
    hedefler.set(`${dizin}/icerik.json`, Buffer.from(icerikUret(p.icerik, eskiOku('icerik.json')), 'utf8'));
    hedefler.set(`${dizin}/akis.json`, Buffer.from(akisUret(p.akis, eskiOku('akis.json')), 'utf8'));
  }

  // Değişenler (bayt farkı); eski yazı tiplerinden paketle gelmeyenler silinecek.
  const yazilacak = [];
  for (const [yol, bayt] of hedefler) {
    const y = yolu(kok, yol);
    if (existsSync(y) && statSync(y).isFile() && readFileSync(y).equals(bayt)) continue;
    yazilacak.push([yol, y, bayt]);
  }
  const silinecek = [];
  const fontKok = yolu(kok, 'ekran/fonts');
  if (existsSync(fontKok) && statSync(fontKok).isDirectory()) {
    for (const e of readdirSync(fontKok, { withFileTypes: true })) {
      const yol = `ekran/fonts/${e.name}`;
      if (e.isFile() && FONT_ADI.test(e.name) && !hedefler.has(yol)) silinecek.push(yol);
    }
  }

  // Yol çatışmaları (dizin üstüne dosya, dosya altına dizin) ilk yazımdan ÖNCE yakalanır; yarım yazım kalmaz.
  for (const [yol] of yazilacak) yolCatismasiDene(kok, yol);
  yolCatismasiDene(kok, `c/${YAZILAN_DOSYA}`);

  // Doğrulama bitti: yazım.
  for (const [, y, bayt] of yazilacak) {
    mkdirSync(dirname(y), { recursive: true });
    writeFileSync(y, bayt);
  }
  for (const yol of silinecek) unlinkSync(yolu(kok, yol));

  const yazilan = sirali(yazilacak.map(([yol]) => yol));
  const silinen = sirali(silinecek);
  mkdirSync(yolu(kok, 'c'), { recursive: true });
  writeFileSync(yolu(kok, `c/${YAZILAN_DOSYA}`), [...yazilan, ...silinen].map((s) => s + '\n').join(''));
  return { yazilan, silinen, atlanan };
}

// ------------------------------------------------------------------ CLI

function argumanlar(argv) {
  const s = { paket: null, kok: '.' };
  for (let i = 0; i < argv.length; i += 2) {
    const ad = argv[i];
    const deger = argv[i + 1];
    if ((ad !== '--paket' && ad !== '--kok') || deger === undefined || deger.startsWith('--')) throw new Error(`geçersiz argüman: ${String(ad)}`);
    s[ad.slice(2)] = deger;
  }
  if (!s.paket) throw new Error('kullanım: node arac/ekran/yerlestir.mjs --paket <dizin> [--kok <dizin>]');
  return s;
}

async function cli(argv) {
  try {
    const { paket, kok } = argumanlar(argv);
    let camilerMetni;
    try { camilerMetni = readFileSync(join(kok, 'camiler.json'), 'utf8'); } catch { throw new Error('camiler.json okunamadı'); }
    const sonuc = await yerlestir({ paket, kok, camiler: camilerOku(camilerMetni) });
    for (const y of sonuc.yazilan) console.log(`+ ${y}`);
    for (const y of sonuc.silinen) console.log(`- ${y}`);
    console.log(`yerleştirme tamam: ${sonuc.yazilan.length} yazıldı, ${sonuc.silinen.length} silindi, referans atlanan: ${sonuc.atlanan.join(', ') || '-'}`);
    return 0;
  } catch (e) {
    console.error(`yerlestir: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  process.exitCode = await cli(process.argv.slice(2));
}
