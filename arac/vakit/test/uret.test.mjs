// uret.mjs testleri — geçici dizin, sahte `getir` (ayna fikstürü), sabit `simdi`. Ağ yok.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uret, calistir, IZINLI_KAYNAK_ALANLARI } from '../uret.mjs';

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

test('bugünü içermeyen (bayat) veri doğrulamada reddedilir, eski dosya korunur', async (t) => {
  sustur(t);
  const kok = kokKur([cami()]);
  try {
    // fikstür 8 Eki–8 Kas; "bugün" 20 Kas → bayat
    const { sonuc, hataVar } = await uret({ kok, getir: sahteGetir(), bekle, simdi: () => new Date('2026-11-20T10:00:00Z') });
    assert.equal(hataVar, true);
    assert.equal(sonuc[0].durum, 'hata');
    assert.match(sonuc[0].ileti, /yetersiz gün sayısı|bayat kaynak/); // pencere tamamen geçmişte kaldı
    assert.ok(!existsSync(join(kok, 'c')));
  } finally { rmSync(kok, { recursive: true, force: true }); }
});
