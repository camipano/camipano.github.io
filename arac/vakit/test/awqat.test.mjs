// awqat.mjs testleri — ağsız: sahte `getir` ve anında dönen `bekle` ile. Kimlik bilgileri uydurmadır.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AWQAT_TABAN, awqatDonustur, awqatKimligi, araligaGerekMi, saatDilimiFarki, awqatCek } from '../awqat.mjs';
import { cek } from '../diyanet.mjs';

const fikstur = (ad) => readFileSync(new URL(`./fikstur/${ad}`, import.meta.url), 'utf8');
const ARALIK = JSON.parse(fikstur('awqat-aralik-11890.json'));
const SEHIR = JSON.parse(fikstur('awqat-sehir-11890.json'));
const RESMI_HTML = fikstur('resmi-11890.html');

const KIMLIK = { kullanici: 'deneme@ornek.invalid', sifre: 'GIZLI-sifre-123' };
const TOKEN = 'eyJ.deneme.belirteci';
const CAMI = { ilce: '11890', slug: 'mfamenne', ilceAdi: 'M.FAMENNE', saatDilimi: 'Europe/Brussels' };
const SALI_SABAH = () => new Date('2026-10-27T04:41:00Z'); // salı → Monthly
const PAZARTESI_SABAH = () => new Date('2026-10-26T04:41:00Z'); // pazartesi sabahı → DateRange

const sustur = (t) => t.mock.method(console, 'warn', () => {});
const yanit = (govde, durum = 200, url) => ({
  ok: durum >= 200 && durum < 300, status: durum, url,
  text: async () => (typeof govde === 'string' ? govde : JSON.stringify(govde)),
  json: async () => (typeof govde === 'string' ? JSON.parse(govde) : govde),
});
const girisYaniti = { data: { accessToken: TOKEN, refreshToken: 'yenile' }, success: true, message: null };

/** Awqat uçlarını taklit eden getir; istekleri kaydeder. `ust` belirli yollar için yanıtı ezer. */
function sahteAwqat(ust = {}) {
  const istekler = [];
  const getir = async (url, secenek = {}) => {
    istekler.push({ url, secenek });
    const yol = new URL(url).pathname;
    if (ust[yol]) return ust[yol](secenek, istekler);
    if (yol === '/Auth/Login') return yanit(girisYaniti);
    if (yol === '/api/Place/CityDetail/11890') return yanit(SEHIR);
    if (yol === '/api/PrayerTime/Monthly/11890') return yanit(ARALIK);
    if (yol === '/api/PrayerTime/DateRange') return yanit(ARALIK);
    if (url.startsWith('https://namazvakitleri.diyanet.gov.tr/')) return yanit(RESMI_HTML);
    return yanit('bulunamadı', 404);
  };
  return { getir, istekler };
}
const anindaBekle = async () => {};

test('awqatDonustur: Awqat kaydı site biçimine çevrilir (fajr = imsak, hicri uzun yazım)', () => {
  assert.deepEqual(awqatDonustur(ARALIK.data[0]), {
    tarih: '2026-10-26', hicri: ARALIK.data[0].hijriDateLong,
    imsak: ARALIK.data[0].fajr, gunes: ARALIK.data[0].sunrise, ogle: ARALIK.data[0].dhuhr,
    ikindi: ARALIK.data[0].asr, aksam: ARALIK.data[0].maghrib, yatsi: ARALIK.data[0].isha,
  });
});

test('awqatKimligi: iki değişken de doluysa kimlik, biri eksikse null', () => {
  assert.deepEqual(awqatKimligi({ AWQAT_KULLANICI: 'a@b.invalid', AWQAT_SIFRE: 'x' }), { kullanici: 'a@b.invalid', sifre: 'x' });
  assert.equal(awqatKimligi({ AWQAT_KULLANICI: 'a@b.invalid' }), null);
  assert.equal(awqatKimligi({ AWQAT_KULLANICI: ' ', AWQAT_SIFRE: 'x' }), null);
  assert.equal(awqatKimligi({}), null);
});

test('araligaGerekMi: yalnız pazartesi UTC öğleden önce (ayda ≤ 5 DateRange isteği)', () => {
  assert.equal(araligaGerekMi(PAZARTESI_SABAH(), {}), true);
  assert.equal(araligaGerekMi(new Date('2026-10-26T13:17:00Z'), {}), false);
  assert.equal(araligaGerekMi(SALI_SABAH(), {}), false);
  assert.equal(araligaGerekMi(SALI_SABAH(), { AWQAT_ARALIK: '1' }), true, 'elle başlatılan koşu');
  assert.equal(araligaGerekMi(SALI_SABAH(), { AWQAT_ARALIK: '' }), false);
});

test('saatDilimiFarki: Brüksel kışın +1, yazın +2', () => {
  assert.equal(saatDilimiFarki('2026-11-15', 'Europe/Brussels'), 1);
  assert.equal(saatDilimiFarki('2026-07-15', 'Europe/Brussels'), 2);
});

test('awqatCek: tek giriş, ilçe doğrulaması, Monthly; belirteç Bearer başlığında, şifre yalnız giriş gövdesinde', async () => {
  const { getir, istekler } = sahteAwqat();
  const r = await awqatCek(CAMI, { getir, bekle: anindaBekle, kimlik: KIMLIK, simdi: SALI_SABAH });
  assert.equal(r.kaynakAdi, 'awqat');
  assert.equal(r.kaynakUc, `${AWQAT_TABAN}/api/PrayerTime/Monthly/11890`);
  assert.equal(r.gunler.length, 12);
  assert.equal(r.gunler[0].tarih, '2026-10-26');
  const yollar = istekler.map((i) => new URL(i.url).pathname);
  assert.deepEqual(yollar, ['/Auth/Login', '/api/Place/CityDetail/11890', '/api/PrayerTime/Monthly/11890']);
  assert.equal(istekler[0].secenek.method, 'POST');
  assert.deepEqual(JSON.parse(istekler[0].secenek.body), { email: KIMLIK.kullanici, password: KIMLIK.sifre });
  for (const i of istekler.slice(1)) {
    assert.equal(i.secenek.headers.Authorization, `Bearer ${TOKEN}`);
    assert.ok(!JSON.stringify(i).includes(KIMLIK.sifre), 'şifre veri isteklerine girmez');
  }
});

test('awqatCek: pazartesi sabahı DateRange (dün → +90 gün)', async () => {
  const { getir, istekler } = sahteAwqat();
  const r = await awqatCek(CAMI, { getir, bekle: anindaBekle, kimlik: KIMLIK, simdi: PAZARTESI_SABAH });
  const son = istekler.at(-1);
  assert.equal(new URL(son.url).pathname, '/api/PrayerTime/DateRange');
  assert.equal(son.secenek.method, 'POST');
  const govde = JSON.parse(son.secenek.body);
  assert.deepEqual(govde, { cityId: 11890, startDate: '2026-10-25T00:00:00', endDate: '2027-01-24T00:00:00' });
  assert.equal(r.kaynakUc, `${AWQAT_TABAN}/api/PrayerTime/DateRange?cityId=11890`);
});

test('awqatCek: DateRange kotası/hatası → aynı koşuda Monthly', async (t) => {
  sustur(t);
  const { getir, istekler } = sahteAwqat({ '/api/PrayerTime/DateRange': () => yanit({ success: false, message: 'kota' }, 429) });
  const r = await awqatCek(CAMI, { getir, bekle: anindaBekle, kimlik: KIMLIK, simdi: PAZARTESI_SABAH });
  assert.equal(r.kaynakUc, `${AWQAT_TABAN}/api/PrayerTime/Monthly/11890`);
  assert.equal(istekler.filter((i) => new URL(i.url).pathname === '/Auth/Login').length, 1, 'giriş tekrarlanmaz');
});

test('awqatCek: kimlik yoksa ağa çıkmadan tekrarsız hata', async () => {
  const { getir, istekler } = sahteAwqat();
  await assert.rejects(awqatCek(CAMI, { getir, bekle: anindaBekle, kimlik: null, simdi: SALI_SABAH }), (e) => e.tekrarYok && /kimlik/.test(e.message));
  assert.equal(istekler.length, 0);
});

test('awqatCek: giriş reddi tekrarsız; ileti şifreyi ve kullanıcıyı içermez', async () => {
  const { getir, istekler } = sahteAwqat({ '/Auth/Login': () => yanit({ success: false, message: 'Kullanıcı adı veya şifre hatalı' }, 400) });
  await assert.rejects(awqatCek(CAMI, { getir, bekle: anindaBekle, kimlik: KIMLIK, simdi: SALI_SABAH }), (e) => {
    assert.ok(e.tekrarYok);
    assert.ok(!e.message.includes(KIMLIK.sifre) && !e.message.includes(KIMLIK.kullanici));
    return true;
  });
  assert.equal(istekler.length, 1, 'reddedilen giriş yeniden denenmez (hesap kilidi/kota)');
});

test('awqatCek: sunucu iletisi kimliği geri yansıtsa da hata iletisine girmez', async () => {
  const yansit = { success: false, message: `geçersiz giriş: ${KIMLIK.kullanici} / ${KIMLIK.sifre}` };
  const { getir } = sahteAwqat({ '/Auth/Login': () => yanit(yansit, 401) });
  await assert.rejects(awqatCek(CAMI, { getir, bekle: anindaBekle, kimlik: KIMLIK, simdi: SALI_SABAH }), (e) => {
    assert.ok(!e.message.includes(KIMLIK.sifre), 'şifre iletide');
    assert.ok(!e.message.includes(KIMLIK.kullanici), 'kullanıcı iletide');
    assert.match(e.message, /HTTP 401/);
    return true;
  });
});

test('awqatCek: ilçe adı uyuşmazsa ilceUyusmaz hatası', async () => {
  const baska = { ...SEHIR, data: { ...SEHIR.data, name: 'LIEGE' } };
  const { getir } = sahteAwqat({ '/api/Place/CityDetail/11890': () => yanit(baska) });
  await assert.rejects(awqatCek(CAMI, { getir, bekle: anindaBekle, kimlik: KIMLIK, simdi: SALI_SABAH }), (e) => e.ilceUyusmaz && e.tekrarYok);
});

test('awqatCek: saat dilimi uymayan kayıt (GMT+3) reddedilir', async () => {
  const bozuk = { ...ARALIK, data: ARALIK.data.map((g) => ({ ...g, greenwichMeanTimeZone: 3 })) };
  const { getir } = sahteAwqat({ '/api/PrayerTime/Monthly/11890': () => yanit(bozuk) });
  await assert.rejects(awqatCek(CAMI, { getir, bekle: anindaBekle, kimlik: KIMLIK, simdi: SALI_SABAH }), /saat dilimi/);
});

test('awqatCek: 7 günden az kayıt reddedilir', async () => {
  const kisa = { ...ARALIK, data: ARALIK.data.slice(0, 5) };
  const { getir } = sahteAwqat({ '/api/PrayerTime/Monthly/11890': () => yanit(kisa) });
  await assert.rejects(awqatCek(CAMI, { getir, bekle: anindaBekle, kimlik: KIMLIK, simdi: SALI_SABAH }), /7/);
});

test('awqatCek: veri ucunda 5xx yeniden denenir, giriş yinelenmez', async (t) => {
  sustur(t);
  let kez = 0;
  const { getir, istekler } = sahteAwqat({ '/api/PrayerTime/Monthly/11890': () => (++kez < 2 ? yanit('hata', 503) : yanit(ARALIK)) });
  const beklemeler = [];
  const r = await awqatCek(CAMI, { getir, bekle: async (ms) => beklemeler.push(ms), kimlik: KIMLIK, simdi: SALI_SABAH });
  assert.equal(r.gunler.length, 12);
  assert.equal(beklemeler.length, 1);
  assert.equal(istekler.filter((i) => new URL(i.url).pathname === '/Auth/Login').length, 1);
});

test('awqatCek: yanıt başka alana yönlendirildiyse reddedilir', async () => {
  const { getir } = sahteAwqat({ '/api/PrayerTime/Monthly/11890': () => yanit(ARALIK, 200, 'https://kotu.example/api/PrayerTime/Monthly/11890') });
  await assert.rejects(awqatCek(CAMI, { getir, bekle: anindaBekle, kimlik: KIMLIK, simdi: SALI_SABAH }), /izinli alan/);
});

test('cek: kimlik varsa önce Awqat', async () => {
  const { getir } = sahteAwqat();
  const r = await cek(CAMI, { getir, bekle: anindaBekle, kimlik: KIMLIK, simdi: SALI_SABAH });
  assert.equal(r.kaynakAdi, 'awqat');
});

test('cek: Awqat başarısızsa resmî sayfaya düşülür', async (t) => {
  sustur(t);
  const { getir } = sahteAwqat({ '/Auth/Login': () => yanit('bakım', 503) });
  const r = await cek(CAMI, { getir, bekle: anindaBekle, kimlik: KIMLIK, simdi: SALI_SABAH });
  assert.equal(r.kaynakAdi, 'resmî sayfa');
});

test('cek: Awqat ilçe uyuşmazlığında öbür kaynaklara geçilmez (aynı ilçe kimliği)', async (t) => {
  sustur(t);
  const baska = { ...SEHIR, data: { ...SEHIR.data, name: 'LIEGE' } };
  const { getir, istekler } = sahteAwqat({ '/api/Place/CityDetail/11890': () => yanit(baska) });
  await assert.rejects(cek(CAMI, { getir, bekle: anindaBekle, kimlik: KIMLIK, simdi: SALI_SABAH }), /camiler\.json/);
  assert.ok(!istekler.some((i) => i.url.startsWith('https://namazvakitleri.diyanet.gov.tr/')));
});

test('cek: kimlik yoksa Awqat hiç çağrılmaz', async () => {
  const { getir, istekler } = sahteAwqat();
  const r = await cek(CAMI, { getir, bekle: anindaBekle, kimlik: null, simdi: SALI_SABAH });
  assert.equal(r.kaynakAdi, 'resmî sayfa');
  assert.ok(!istekler.some((i) => i.url.startsWith(AWQAT_TABAN)));
});
