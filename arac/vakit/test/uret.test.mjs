// uret.mjs testleri — geçici dizin, sahte `getir` (ayna fikstürü), sabit `simdi`. Ağ yok.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { uret, calistir, IZINLI_KAYNAK_ALANLARI, BASARILI_DOSYA } from '../uret.mjs';

const AYNA = readFileSync(new URL('./fikstur/ayna-11890.json', import.meta.url), 'utf8');
const SIMDI = () => new Date('2026-10-13T10:00:00Z');
const bekle = async () => {};

const cami = (ek = {}) => ({
  camiId: 'ornek-cami', adTr: 'Örnek Cami', adFr: 'Mosquée Exemple', ilce: '11890', ilceAdi: 'M.FAMENNE', slug: 'mfamenne',
  saatDilimi: 'Europe/Brussels', konum: { enlem: 50.1, boylam: 5.2 }, cumaSaati: '', ...ek,
});
const yanit = (govde, durum = 200) => ({ ok: durum < 400, status: durum, text: async () => govde, json: async () => JSON.parse(govde) });
// resmî sayfa Belçika'dan açılmaz → 403; ayna fikstürü döner. `kotu` ilçeler için her istek ağ hatası verir.
const sahteGetir = (kotuIlceler = []) => async (url) => {
  if (kotuIlceler.some((i) => url.includes('/' + i))) throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
  if (url.includes('namazvakitleri.diyanet.gov.tr')) return yanit('', 403);
  return yanit(AYNA);
};

/** Geçici kök: camiler.json yazılmış; `iptal()` ile temizlenir. */
function kokKur(camiler, ham) {
  const kok = mkdtempSync(join(tmpdir(), 'uret-test-'));
  writeFileSync(join(kok, 'camiler.json'), ham ?? JSON.stringify({ surum: 1, camiler }));
  return kok;
}
const dosyaYolu = (kok, id) => join(kok, 'c', id, 'vakitler.json');
const oku = (kok, id) => JSON.parse(readFileSync(dosyaYolu(kok, id), 'utf8'));
const sustur = (t) => { t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'log', () => {}); t.mock.method(console, 'error', () => {}); };

test('izinli kaynak alanları yalnız iki Diyanet alanıdır', () => {
  assert.deepEqual(IZINLI_KAYNAK_ALANLARI, ['namazvakitleri.diyanet.gov.tr', 'ezanvakti.emushaf.net']);
});

test('iki cami iki dosya yazar; çıktı Diyanet damgalı ve dünden başlar', async (t) => {
  sustur(t);
  const kok = kokKur([cami({ camiId: 'cami-bir' }), cami({ camiId: 'cami-iki' })]);
  try {
    const { sonuc, hataVar } = await uret({ kok, getir: sahteGetir(), bekle, simdi: SIMDI });
    assert.equal(hataVar, false);
    assert.deepEqual(sonuc.map((s) => [s.camiId, s.durum]), [['cami-bir', 'yazildi'], ['cami-iki', 'yazildi']]);
    for (const id of ['cami-bir', 'cami-iki']) {
      const d = oku(kok, id);
      assert.equal(d.kaynakTuru, 'diyanet');
      assert.equal(d.ilce, '11890');
      assert.equal(d.ilceAdi, 'M.FAMENNE');
      assert.equal(d.kaynak, 'Diyanet İşleri Başkanlığı — Örnek Cami (ilçe 11890)');
      assert.equal(d.kaynakUc, 'https://ezanvakti.emushaf.net/vakitler/11890');
      assert.equal(d.guncelleme, '2026-10-13T10:00:00.000Z');
      assert.equal(d.gunler[0].tarih, '2026-10-12');
      assert.equal(d.gunler.at(-1).tarih, '2026-11-08');
      assert.deepEqual(d.atlanan, []);
    }
    // tek satır
    assert.ok(!readFileSync(dosyaYolu(kok, 'cami-bir'), 'utf8').includes('\n'));
  } finally { rmSync(kok, { recursive: true, force: true }); }
});

test('aynı girdiyle ikinci koşu degismedi der ve dosyaya dokunmaz', async (t) => {
  sustur(t);
  const kok = kokKur([cami()]);
  try {
    await uret({ kok, getir: sahteGetir(), bekle, simdi: SIMDI });
    const yol = dosyaYolu(kok, 'ornek-cami');
    const once = readFileSync(yol, 'utf8');
    const eski = new Date('2026-10-13T09:00:00Z');
    utimesSync(yol, eski, eski);
    const mtime = statSync(yol).mtimeMs;
    const { sonuc, hataVar } = await uret({ kok, getir: sahteGetir(), bekle, simdi: () => new Date('2026-10-13T16:00:00Z') });
    assert.equal(hataVar, false);
    assert.equal(sonuc[0].durum, 'degismedi');
    assert.equal(statSync(yol).mtimeMs, mtime);
    assert.equal(readFileSync(yol, 'utf8'), once); // guncelleme de eski kalır
  } finally { rmSync(kok, { recursive: true, force: true }); }
});

test('bir caminin çekimi başarısız: o cami hata, eski dosyası aynen durur, diğeri yazılır, hataVar true', async (t) => {
  sustur(t);
  const kok = kokKur([
    cami({ camiId: 'bozuk-cami', ilce: '22222', ilceAdi: 'BOZUK', slug: 'bozuk' }),
    cami({ camiId: 'saglam-cami' }),
  ]);
  try {
    const eskiMetin = JSON.stringify({ kaynak: 'eski', kaynakTuru: 'diyanet', ilce: '22222', ilceAdi: 'BOZUK', guncelleme: '2026-10-01T00:00:00Z', gunler: [], atlanan: [] });
    mkdirSync(join(kok, 'c', 'bozuk-cami'), { recursive: true });
    writeFileSync(dosyaYolu(kok, 'bozuk-cami'), eskiMetin);
    const { sonuc, hataVar } = await uret({ kok, getir: sahteGetir(['22222']), bekle, simdi: SIMDI });
    assert.equal(hataVar, true);
    assert.equal(sonuc[0].durum, 'hata');
    assert.match(sonuc[0].ileti, /hiçbir kaynaktan alınamadı/);
    assert.equal(sonuc[1].durum, 'yazildi');
    assert.equal(readFileSync(dosyaYolu(kok, 'bozuk-cami'), 'utf8'), eskiMetin);
    assert.equal(oku(kok, 'saglam-cami').gunler[0].tarih, '2026-10-12');
  } finally { rmSync(kok, { recursive: true, force: true }); }
});

test('çekimi başarısız caminin dosyası hiç yoksa yeni dosya da oluşmaz', async (t) => {
  sustur(t);
  const kok = kokKur([cami({ ilce: '22222', slug: 'bozuk' })]);
  try {
    const { sonuc, hataVar } = await uret({ kok, getir: sahteGetir(['22222']), bekle, simdi: SIMDI });
    assert.equal(hataVar, true);
    assert.equal(sonuc[0].durum, 'hata');
    assert.ok(!existsSync(join(kok, 'c')));
  } finally { rmSync(kok, { recursive: true, force: true }); }
});

test('yinelenen camiId: uret reddeder ve hiçbir dosya yazılmaz', async (t) => {
  sustur(t);
  const kok = kokKur([cami(), cami()]);
  try {
    await assert.rejects(uret({ kok, getir: sahteGetir(), bekle, simdi: SIMDI }), /yinelenen camiId/);
    assert.ok(!existsSync(join(kok, 'c')));
  } finally { rmSync(kok, { recursive: true, force: true }); }
});

test('calistir: bozuk ya da yinelenen camiler.json → çıkış 1, hiçbir şey yazılmaz; sağlam → 0', async (t) => {
  sustur(t);
  for (const [ham, beklenen] of [['{bozuk', 1], [JSON.stringify({ surum: 1, camiler: [cami(), cami()] }), 1], [JSON.stringify({ surum: 1, camiler: [cami()] }), 0]]) {
    const kok = kokKur(null, ham);
    try {
      const kod = await calistir({ kok, getir: sahteGetir(), bekle, simdi: SIMDI });
      assert.equal(kod, beklenen);
      assert.equal(existsSync(join(kok, 'c')), beklenen === 0);
    } finally { rmSync(kok, { recursive: true, force: true }); }
  }
});

test('calistir: bir cami hata verirse çıkış 1, diğer cami yine yazılır; camiler.json yoksa 1', async (t) => {
  sustur(t);
  const kok = kokKur([cami({ camiId: 'bozuk-cami', ilce: '22222', slug: 'bozuk' }), cami({ camiId: 'saglam-cami' })]);
  try {
    assert.equal(await calistir({ kok, getir: sahteGetir(['22222']), bekle, simdi: SIMDI }), 1);
    assert.ok(existsSync(dosyaYolu(kok, 'saglam-cami')));
    assert.ok(!existsSync(dosyaYolu(kok, 'bozuk-cami')));
  } finally { rmSync(kok, { recursive: true, force: true }); }
  const bos = mkdtempSync(join(tmpdir(), 'uret-test-'));
  try { assert.equal(await calistir({ kok: bos, getir: sahteGetir(), bekle, simdi: SIMDI }), 1); } finally { rmSync(bos, { recursive: true, force: true }); }
});

test('eldeki dosya başka ilçeye aitse ya da Diyanet değilse taban sayılmaz; aynı ilçeninki taban olur', async (t) => {
  sustur(t);
  const ileri = { tarih: '2027-03-01', hicri: '1 Şaban 1448', imsak: '05:00', gunes: '06:40', ogle: '13:30', ikindi: '16:30', aksam: '19:00', yatsi: '20:30' };
  const eldeki = (ek) => JSON.stringify({ kaynak: 'x', kaynakTuru: 'diyanet', ilce: '11890', ilceAdi: 'M.FAMENNE', guncelleme: '2026-10-01T00:00:00Z', gunler: [ileri], atlanan: [], ...ek });
  const durumlar = [
    ['baska-ilce', eldeki({ ilce: '9999' }), false],
    ['hesap-kaynak', eldeki({ kaynakTuru: 'hesap' }), false],
    ['bozuk-json', '{bozuk', false],
    ['ayni-ilce', eldeki({}), true],
  ];
  const kok = kokKur(durumlar.map(([id]) => cami({ camiId: id })));
  try {
    for (const [id, metin] of durumlar) {
      mkdirSync(join(kok, 'c', id), { recursive: true });
      writeFileSync(dosyaYolu(kok, id), metin);
    }
    const { sonuc } = await uret({ kok, getir: sahteGetir(), bekle, simdi: SIMDI });
    assert.deepEqual(sonuc.map((s) => s.durum), ['yazildi', 'yazildi', 'yazildi', 'yazildi']);
    for (const [id, , tabanMi] of durumlar) {
      const d = oku(kok, id);
      assert.equal(d.ilce, '11890');
      assert.equal(d.gunler.some((g) => g.tarih === '2027-03-01'), tabanMi, id);
    }
  } finally { rmSync(kok, { recursive: true, force: true }); }
});

test('kaynakUc izinli alan dışındaysa o cami hata olur, dosya yazılmaz', async (t) => {
  sustur(t);
  const kok = kokKur([cami()]);
  try {
    const sahteCek = async () => ({ gunler: JSON.parse(AYNA).map((g) => ({ tarih: g.MiladiTarihKisa.split('.').reverse().join('-'), hicri: 'x', imsak: g.Imsak, gunes: g.Gunes, ogle: g.Ogle, ikindi: g.Ikindi, aksam: g.Aksam, yatsi: g.Yatsi })), kaynakAdi: 'ayna', kaynakUc: 'https://ornek.invalid/x' });
    const { sonuc, hataVar } = await uret({ kok, getir: sahteGetir(), bekle, simdi: SIMDI, cek: sahteCek });
    assert.equal(hataVar, true);
    assert.equal(sonuc[0].durum, 'hata');
    assert.match(sonuc[0].ileti, /ornek\.invalid/);
    assert.ok(!existsSync(join(kok, 'c')));
  } finally { rmSync(kok, { recursive: true, force: true }); }
});

test('izinli alanın alt alanı ya da benzeri kabul edilmez', async (t) => {
  sustur(t);
  const kok = kokKur([cami()]);
  try {
    for (const uc of ['https://ezanvakti.emushaf.net.evil.test/x', 'https://evil.test/ezanvakti.emushaf.net', 'ezanvakti.emushaf.net', 'http://ezanvakti.emushaf.net/x']) {
      const sahteCek = async () => ({ gunler: [], kaynakAdi: 'ayna', kaynakUc: uc });
      const { sonuc } = await uret({ kok, getir: sahteGetir(), bekle, simdi: SIMDI, cek: sahteCek });
      assert.equal(sonuc[0].durum, 'hata', uc);
    }
  } finally { rmSync(kok, { recursive: true, force: true }); }
});

test('kaynak türü Diyanet değilse kapı reddeder: o cami hata, dosya yazılmaz', async (t) => {
  sustur(t);
  const kok = kokKur([cami()]);
  try {
    const gunler = JSON.parse(AYNA).map((g) => ({ tarih: g.MiladiTarihKisa.split('.').reverse().join('-'), hicri: 'x', imsak: g.Imsak, gunes: g.Gunes, ogle: g.Ogle, ikindi: g.Ikindi, aksam: g.Aksam, yatsi: g.Yatsi }));
    const sahteCek = async () => ({ gunler, kaynakAdi: 'ayna', kaynakUc: 'https://ezanvakti.emushaf.net/vakitler/11890', kaynakTuru: 'aladhan' });
    const { sonuc, hataVar } = await uret({ kok, getir: sahteGetir(), bekle, simdi: SIMDI, cek: sahteCek });
    assert.equal(hataVar, true);
    assert.equal(sonuc[0].durum, 'hata');
    assert.match(sonuc[0].ileti, /REDDEDİLDİ.*aladhan/);
    assert.ok(!existsSync(join(kok, 'c')));
  } finally { rmSync(kok, { recursive: true, force: true }); }
});

test('pencere tamamen geçmişte kaldıysa yetersiz gün sayısıyla reddedilir, dosya yazılmaz', async (t) => {
  sustur(t);
  const kok = kokKur([cami()]);
  try {
    // fikstür 8 Eki–8 Kas; "bugün" 20 Kas → bayat
    const { sonuc, hataVar } = await uret({ kok, getir: sahteGetir(), bekle, simdi: () => new Date('2026-11-20T10:00:00Z') });
    assert.equal(hataVar, true);
    assert.equal(sonuc[0].durum, 'hata');
    assert.equal(sonuc[0].ileti, 'yetersiz gün sayısı (0)'); // pencere tamamen geçmişte kaldı: dünden eski günler atılır
    assert.ok(!existsSync(join(kok, 'c')));
  } finally { rmSync(kok, { recursive: true, force: true }); }
});

// ---- yardımcılar: sahte `cek` için sentetik günler
const gunSentetik = (tarih, ek = {}) => ({ tarih, hicri: '2 Cemaziyelevvel 1448', imsak: '06:09', gunes: '07:50', ogle: '13:30', ikindi: '16:22', aksam: '19:00', yatsi: '20:28', ...ek });
const gunDizisi = (bas, n) => Array.from({ length: n }, (_, i) => gunSentetik(new Date(Date.parse(bas + 'T12:00:00Z') + i * 864e5).toISOString().slice(0, 10)));
const sahteCekOlustur = (gunler) => async () => ({ gunler, kaynakAdi: 'ayna', kaynakUc: 'https://ezanvakti.emushaf.net/vakitler/11890' });

test('bugünü içermeyen ama yedi günü aşan veri bayat kaynak iletisiyle reddedilir', async (t) => {
  sustur(t);
  const kok = kokKur([cami()]);
  try {
    // dün + yarından sonraki 7 gün; bugün (13 Eki) yok
    const gunler = [gunSentetik('2026-10-12'), ...gunDizisi('2026-10-14', 8)];
    const { sonuc } = await uret({ kok, getir: sahteGetir(), bekle, simdi: SIMDI, cek: sahteCekOlustur(gunler) });
    assert.equal(sonuc[0].durum, 'hata');
    assert.equal(sonuc[0].ileti, 'bugün (2026-10-13) veride yok — bayat kaynak');
  } finally { rmSync(kok, { recursive: true, force: true }); }
});

test('kapı çıktısı da doğrulanır: bugünden sonraki günlerden biri kapıda düşerse cami hata olur, eski dosya korunur', async (t) => {
  sustur(t);
  const kok = kokKur([cami()]);
  try {
    mkdirSync(join(kok, 'c', 'ornek-cami'), { recursive: true });
    writeFileSync(dosyaYolu(kok, 'ornek-cami'), '{"eski":true}');
    // hicri alanı yok: dogrula geçer, kapı (gunGecerliMi) düşürür → bugünden sonraki 2. gün eksik kalır
    const gunler = gunDizisi('2026-10-12', 60);
    gunler[3] = gunSentetik(gunler[3].tarih, { hicri: undefined });
    const { sonuc, hataVar } = await uret({ kok, getir: sahteGetir(), bekle, simdi: SIMDI, cek: sahteCekOlustur(gunler) });
    assert.equal(hataVar, true);
    assert.equal(sonuc[0].durum, 'hata');
    assert.equal(sonuc[0].ileti, 'bugünden sonraki 2. gün (2026-10-15) eksik');
    assert.equal(readFileSync(dosyaYolu(kok, 'ornek-cami'), 'utf8'), '{"eski":true}');
  } finally { rmSync(kok, { recursive: true, force: true }); }
});

test('yalnız ileri bir gün kapıda düşerse yayın sürer, ileti yayımlanmayan günü uyarı olarak yazar', async (t) => {
  sustur(t);
  const kok = kokKur([cami()]);
  try {
    const gunler = gunDizisi('2026-10-12', 80);
    gunler[40] = gunSentetik(gunler[40].tarih, { hicri: undefined }); // 2026-11-21
    const { sonuc, hataVar } = await uret({ kok, getir: sahteGetir(), bekle, simdi: SIMDI, cek: sahteCekOlustur(gunler) });
    assert.equal(hataVar, false);
    assert.equal(sonuc[0].durum, 'yazildi');
    assert.match(sonuc[0].ileti, /UYARI: yayımlanmayan gün: 2026-11-21/);
    assert.ok(!oku(kok, 'ornek-cami').gunler.some((g) => g.tarih === '2026-11-21'));
  } finally { rmSync(kok, { recursive: true, force: true }); }
});

test('kesintisiz pencere 45 günden kısaysa uyarı yazılır; 45 ve üstünde yazılmaz', async (t) => {
  sustur(t);
  const kok = kokKur([cami({ camiId: 'kisa-cami' }), cami({ camiId: 'uzun-cami' })]);
  try {
    const kisa = await uret({ kok, getir: sahteGetir(), bekle, simdi: SIMDI }); // ayna fikstürü 8 Kas'a kadar: 26 gün
    assert.match(kisa.sonuc[0].ileti, /UYARI: kesintisiz pencere yalnız 26 gün \(hedef 45\)/);
    const kok2 = kokKur([cami({ camiId: 'uzun-cami' })]);
    try {
      const uzun = await uret({ kok: kok2, getir: sahteGetir(), bekle, simdi: SIMDI, cek: sahteCekOlustur(gunDizisi('2026-10-12', 60)) });
      assert.equal(uzun.sonuc[0].durum, 'yazildi');
      assert.doesNotMatch(uzun.sonuc[0].ileti, /UYARI/);
    } finally { rmSync(kok2, { recursive: true, force: true }); }
  } finally { rmSync(kok, { recursive: true, force: true }); }
});

// ---- ilçe adı kapısı uret üzerinden
test('uret ilçe adını çekime iletir: başlık eşleşirse resmî sayfa yazılır, başka ilçe çıkarsa o cami hata verir ve dosyası yazılmaz', async (t) => {
  sustur(t);
  const GERCEK = readFileSync(new URL('./fikstur/resmi-11890-gercek.html', import.meta.url), 'utf8');
  const getir = async (url) => (url.includes('namazvakitleri.diyanet.gov.tr') ? yanit(GERCEK) : yanit(AYNA));
  const kok = kokKur([cami({ camiId: 'dogru-ilce' }), cami({ camiId: 'yanlis-ilce', ilceAdi: 'LIEGE' })]);
  try {
    const { sonuc, hataVar } = await uret({ kok, getir, bekle, simdi: SIMDI });
    assert.equal(hataVar, true);
    assert.equal(oku(kok, 'dogru-ilce').kaynakUc, 'https://namazvakitleri.diyanet.gov.tr/tr-TR/11890/mfamenne-namaz-vakitleri');
    assert.equal(sonuc[1].durum, 'hata');
    assert.match(sonuc[1].ileti, /başka ilçeye ait/);
    assert.ok(!existsSync(join(kok, 'c', 'yanlis-ilce')));
  } finally { rmSync(kok, { recursive: true, force: true }); }
});

// ---- F6: atomik yazım + başarı listesi
test('başarısız cami geçici dosya bırakmaz ve başarı listesinde olmaz; başarılı cami listede olur', async (t) => {
  sustur(t);
  const kok = kokKur([
    cami({ camiId: 'bozuk-cami', ilce: '22222', ilceAdi: 'BOZUK', slug: 'bozuk' }),
    cami({ camiId: 'saglam-cami' }),
  ]);
  try {
    const { sonuc, hataVar } = await uret({ kok, getir: sahteGetir(['22222']), bekle, simdi: SIMDI });
    assert.equal(hataVar, true);
    assert.equal(sonuc.find((s) => s.camiId === 'bozuk-cami').durum, 'hata');
    assert.equal(sonuc.find((s) => s.camiId === 'saglam-cami').durum, 'yazildi');
    // geçici dosya kalmaz
    assert.ok(!existsSync(dosyaYolu(kok, 'bozuk-cami') + '.yeni'));
    assert.ok(!existsSync(dosyaYolu(kok, 'saglam-cami') + '.yeni'));
    assert.ok(!existsSync(join(kok, 'c', BASARILI_DOSYA + '.yeni')));
    // başarı listesi yalnız sağlam camiyi taşır
    const liste = readFileSync(join(kok, 'c', BASARILI_DOSYA), 'utf8').split('\n').filter(Boolean);
    assert.deepEqual(liste, ['saglam-cami']);
    assert.ok(!existsSync(dosyaYolu(kok, 'bozuk-cami')));
  } finally { rmSync(kok, { recursive: true, force: true }); }
});

test('başarılı koşuda geçici dosya kalmaz ve başarı listesi bütün camileri taşır', async (t) => {
  sustur(t);
  const kok = kokKur([cami({ camiId: 'cami-bir' }), cami({ camiId: 'cami-iki' })]);
  try {
    const { hataVar } = await uret({ kok, getir: sahteGetir(), bekle, simdi: SIMDI });
    assert.equal(hataVar, false);
    for (const id of ['cami-bir', 'cami-iki']) assert.ok(!existsSync(dosyaYolu(kok, id) + '.yeni'));
    const liste = readFileSync(join(kok, 'c', BASARILI_DOSYA), 'utf8').split('\n').filter(Boolean).sort();
    assert.deepEqual(liste, ['cami-bir', 'cami-iki']);
  } finally { rmSync(kok, { recursive: true, force: true }); }
});

test('atomik yazım: geçici dosya yazılamazsa cami hata olur, eski dosya aynen korunur', async (t) => {
  sustur(t);
  const kok = kokKur([cami({ camiId: 'ornek-cami' })]);
  try {
    const ilk = await uret({ kok, getir: sahteGetir(), bekle, simdi: SIMDI });
    assert.equal(ilk.sonuc[0].durum, 'yazildi');
    const once = readFileSync(dosyaYolu(kok, 'ornek-cami'), 'utf8');
    // Geçici yazımı patlat: `.yeni` yolu dizin olsun, dosya yazımı hata versin.
    mkdirSync(dosyaYolu(kok, 'ornek-cami') + '.yeni', { recursive: true });
    const { sonuc, hataVar } = await uret({ kok, getir: sahteGetir(), bekle, simdi: () => new Date('2026-10-13T16:00:00Z'), cek: sahteCekOlustur(gunDizisi('2026-10-12', 60)) });
    assert.equal(hataVar, true);
    assert.equal(sonuc[0].durum, 'hata');
    assert.equal(readFileSync(dosyaYolu(kok, 'ornek-cami'), 'utf8'), once);
    assert.ok(!statSync(dosyaYolu(kok, 'ornek-cami') + '.yeni').isFile());
    assert.ok(!existsSync(join(kok, 'c', BASARILI_DOSYA)));
  } finally { rmSync(kok, { recursive: true, force: true }); }
});

test('tam başarısız koşu eski başarı listesini siler', async (t) => {
  sustur(t);
  const kok = kokKur([cami({ ilce: '22222', slug: 'bozuk' })]);
  try {
    mkdirSync(join(kok, 'c'), { recursive: true });
    writeFileSync(join(kok, 'c', BASARILI_DOSYA), 'eski-cami\n');
    const { sonuc, hataVar } = await uret({ kok, getir: sahteGetir(['22222']), bekle, simdi: SIMDI });
    assert.equal(hataVar, true);
    assert.equal(sonuc[0].durum, 'hata');
    assert.ok(!existsSync(join(kok, 'c', BASARILI_DOSYA)));
  } finally { rmSync(kok, { recursive: true, force: true }); }
});

// ---- CLI kapısı: betik gerçekten başlatılınca çalışır (VAKIT_KOK ile geçici kök)
test('CLI: uret.mjs ve esdeger.mjs doğrudan çalıştırılınca koşar (bozuk camiler.json → 1 ve HATA; platform dosyası yok → atlandi, 0)', () => {
  const kok = kokKur(null, '{bozuk');
  try {
    const env = { ...process.env, VAKIT_KOK: kok };
    const u = spawnSync(process.execPath, [fileURLToPath(new URL('../uret.mjs', import.meta.url))], { env, encoding: 'utf8', timeout: 20000 });
    assert.equal(u.status, 1, u.stderr);
    assert.match(u.stderr, /HATA/);
    assert.ok(!existsSync(join(kok, 'c')));
    const e = spawnSync(process.execPath, [fileURLToPath(new URL('../esdeger.mjs', import.meta.url))], { env, encoding: 'utf8', timeout: 20000 });
    assert.equal(e.status, 0, e.stderr);
    assert.match(e.stdout, /durum: atlandi/);
  } finally { rmSync(kok, { recursive: true, force: true }); }
});
