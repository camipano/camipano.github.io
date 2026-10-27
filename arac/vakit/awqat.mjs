// Diyanet Awqat Salah REST API (Din İşleri Yüksek Kurulu, awqatsalah.diyanet.gov.tr) — vakit hattının birincil kaynağı.
// Resmî Diyanet servisidir; resmî sayfa ve ayna yedek olarak kalır (diyanet.mjs → cek). HESAPLAMA TABANLI KAYNAK YOKTUR.
//
// Kimlik: ortam değişkenleri AWQAT_KULLANICI + AWQAT_SIFRE (GitHub Actions sırrı). Şifre yalnız giriş isteğinin gövdesine
// girer; belirteç ve şifre hiçbir iletiye, günlüğe ya da çıktıya yazılmaz.
//
// Kota (servis kuralı): her uç ve her parametre için günde 10 istek; DateRange konum başına ayda 10 istek. Bu yüzden
// koşu başına tek giriş, ilçe başına bir CityDetail ve bir vakit isteği yapılır; DateRange yalnız pazartesi sabahı koşusunda
// (ayda ≤ 5) istenir, diğer koşular Monthly kullanır.
import { bugunISO, dkOnce } from './birlestir.mjs';
import { ilceAdiNorm } from './ilce-adi.mjs';

export const AWQAT_TABAN = 'https://awqatsalah.diyanet.gov.tr';
export const AWQAT_ALANI = 'awqatsalah.diyanet.gov.tr';
const UA = 'camipano-vakit/1.0 (+https://camipano.github.io)';
const ARALIK_GUN = 90;
const SAAT = /^([01]\d|2[0-3]):[0-5]\d$/;

const bekleGercek = (ms) => new Promise((c) => setTimeout(c, ms));
const tekrarsiz = (ileti, ek = {}) => Object.assign(new Error(ileti), { tekrarYok: true }, ek);

/** Ortamdan kimlik; iki değer de dolu değilse null (Awqat atlanır, resmî sayfaya geçilir). */
export function awqatKimligi(env = process.env) {
  const kullanici = (env.AWQAT_KULLANICI ?? '').trim();
  const sifre = env.AWQAT_SIFRE ?? '';
  return kullanici && sifre ? { kullanici, sifre } : null;
}

/**
 * DateRange yalnız pazartesi UTC öğleden önceki koşuda (iş akışı 04:41 UTC) ya da elle başlatılan koşuda
 * (`AWQAT_ARALIK=1`, iş akışı yalnız workflow_dispatch'te verir).
 */
export const araligaGerekMi = (an, env = process.env) => env.AWQAT_ARALIK === '1' || (an.getUTCDay() === 1 && an.getUTCHours() < 12);

/** Saat diliminin o tarihteki GMT farkı (saat), ör. Europe/Brussels kışın 1, yazın 2. */
export function saatDilimiFarki(tarih, saatDilimi) {
  const ad = new Intl.DateTimeFormat('en-US', { timeZone: saatDilimi, timeZoneName: 'shortOffset' })
    .formatToParts(new Date(tarih + 'T12:00:00Z')).find((p) => p.type === 'timeZoneName')?.value ?? '';
  if (ad === 'GMT') return 0;
  const m = ad.match(/^GMT([+-]\d{1,2})(?::(\d{2}))?$/);
  return m ? Number(m[1]) + (m[2] ? Math.sign(Number(m[1])) * Number(m[2]) / 60 : 0) : null;
}

/** Awqat kaydı → site biçimi. Tarih `gregorianDateShort` (GG.AA.YYYY), hicrî uzun yazım. */
export function awqatDonustur(g) {
  const m = String(g.gregorianDateShort ?? '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return {
    tarih: m ? `${m[3]}-${m[2]}-${m[1]}` : '',
    hicri: g.hijriDateLong ?? '',
    imsak: g.fajr, gunes: g.sunrise, ogle: g.dhuhr, ikindi: g.asr, aksam: g.maghrib, yatsi: g.isha,
  };
}

/** Sunucu iletisini kısaltır; kimlik bilgisinin geri yansıtılması ihtimaline karşı ikisini de siler. */
function temizIleti(ileti, kimlik) {
  let s = String(ileti ?? '').slice(0, 200);
  for (const gizli of [kimlik?.sifre, kimlik?.kullanici]) if (gizli) s = s.split(gizli).join('***');
  return s;
}

function alanDenetle(r) {
  if (!r.url) return;
  let u;
  try { u = new URL(r.url); } catch { throw tekrarsiz('Awqat yanıtının son adresi okunamadı'); }
  if (u.protocol !== 'https:' || u.hostname !== AWQAT_ALANI) throw tekrarsiz('Awqat yanıtı izinli alan dışına yönlendirildi: ' + u.hostname);
}

/** Tek istek: 2xx + `success: true` → `data`. 4xx tekrarsız (kota/yetki), 5xx ve ağ hatası yeniden denenebilir. */
async function istek(getir, yol, { yontem = 'GET', govde, token, kimlik } = {}) {
  const headers = { 'User-Agent': UA, Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (govde !== undefined) headers['Content-Type'] = 'application/json';
  const r = await getir(AWQAT_TABAN + yol, {
    method: yontem, headers, body: govde === undefined ? undefined : JSON.stringify(govde), signal: AbortSignal.timeout(30000),
  });
  alanDenetle(r);
  let j = null;
  try { j = await r.json(); } catch { /* gövde JSON değil */ }
  const ileti = temizIleti(j?.message, kimlik);
  if (r.status >= 400 && r.status < 500) throw tekrarsiz(`Awqat ${yol.split('?')[0]}: HTTP ${r.status}${ileti ? ' — ' + ileti : ''}`, { http: r.status });
  if (!r.ok) throw new Error(`Awqat ${yol.split('?')[0]}: HTTP ${r.status}`);
  if (!j || j.success !== true) throw tekrarsiz(`Awqat ${yol.split('?')[0]}: başarısız yanıt${ileti ? ' — ' + ileti : ''}`);
  return j.data;
}

async function dene(ad, islev, araliklar, bekle) {
  let sonHata;
  for (let i = 0; i <= araliklar.length; i++) {
    try {
      return await islev();
    } catch (e) {
      sonHata = e;
      console.warn(`${ad}: deneme ${i + 1}/${araliklar.length + 1} başarısız — ${e.message}`);
      if (e.tekrarYok) break;
      if (i < araliklar.length) await bekle(araliklar[i]);
    }
  }
  throw sonHata;
}

/** Vakit listesini denetleyip dönüştürür: ≥ 7 gün, HH:MM, saat dilimi caminin diliyle aynı. */
function gunleriHazirla(data, saatDilimi) {
  if (!Array.isArray(data) || data.length < 7) throw new Error(`Awqat beklenmeyen gövde (${Array.isArray(data) ? data.length : 0} gün; en az 7)`);
  const gunler = [];
  for (const g of data) {
    const d = awqatDonustur(g);
    if (!d.tarih) throw tekrarsiz('Awqat kaydında tarih okunamadı');
    for (const k of ['imsak', 'gunes', 'ogle', 'ikindi', 'aksam', 'yatsi']) {
      if (typeof d[k] !== 'string' || !SAAT.test(d[k])) throw tekrarsiz(`Awqat ${d.tarih} ${k} biçimi bozuk`);
    }
    if (saatDilimi) {
      const beklenen = saatDilimiFarki(d.tarih, saatDilimi);
      if (Number(g.greenwichMeanTimeZone) !== beklenen) {
        throw tekrarsiz(`Awqat ${d.tarih} saat dilimi uyuşmuyor (GMT${g.greenwichMeanTimeZone}, beklenen GMT${beklenen} ${saatDilimi})`);
      }
    }
    gunler.push(d);
  }
  return gunler.sort((a, b) => a.tarih.localeCompare(b.tarih));
}

/**
 * Awqat'tan bir ilçenin vakitleri.
 * @returns { gunler, kaynakAdi: 'awqat', kaynakUc }
 * Hatalar: kimlik yok / giriş reddi / ilçe uyuşmazlığı (`ilceUyusmaz`) / kota → tekrarsız; ağ ve 5xx yeniden denenir.
 */
export async function awqatCek({ ilce, ilceAdi, saatDilimi }, { getir = fetch, bekle = bekleGercek, kimlik = awqatKimligi(), simdi = () => new Date() } = {}) {
  if (!kimlik) throw tekrarsiz('Awqat kimlik bilgisi yok (AWQAT_KULLANICI / AWQAT_SIFRE)');
  const an = simdi();
  const giris = await dene('awqat giriş',
    () => istek(getir, '/Auth/Login', { yontem: 'POST', govde: { email: kimlik.kullanici, password: kimlik.sifre }, kimlik }),
    [10000], bekle);
  const token = giris?.accessToken;
  if (typeof token !== 'string' || !token) throw tekrarsiz('Awqat girişi belirteç döndürmedi');

  if (ilceAdi) {
    const sehir = await dene('awqat ilçe', () => istek(getir, `/api/Place/CityDetail/${encodeURIComponent(ilce)}`, { token, kimlik }), [10000], bekle);
    const bulunan = String(sehir?.name ?? '');
    if (ilceAdiNorm(bulunan) !== ilceAdiNorm(ilceAdi)) {
      throw tekrarsiz(`Awqat ilçe ${ilce} başka ilçeye ait: "${bulunan}" (beklenen: "${ilceAdi}")`, { ilceUyusmaz: true });
    }
  }

  const aylik = async () => ({
    gunler: gunleriHazirla(await dene('awqat aylık', () => istek(getir, `/api/PrayerTime/Monthly/${encodeURIComponent(ilce)}`, { token, kimlik }), [10000, 30000], bekle), saatDilimi),
    kaynakUc: `${AWQAT_TABAN}/api/PrayerTime/Monthly/${ilce}`,
  });

  let sonuc;
  if (araligaGerekMi(an)) {
    const bugun = bugunISO(an);
    const govde = { cityId: Number(ilce), startDate: `${dkOnce(bugun, 1)}T00:00:00`, endDate: `${dkOnce(bugun, -ARALIK_GUN)}T00:00:00` };
    try {
      sonuc = {
        gunler: gunleriHazirla(await istek(getir, '/api/PrayerTime/DateRange', { yontem: 'POST', govde, token, kimlik }), saatDilimi),
        kaynakUc: `${AWQAT_TABAN}/api/PrayerTime/DateRange?cityId=${ilce}`,
      };
    } catch (e) {
      console.warn(`awqat aralık alınamadı (${e.message}) → aylık`);
    }
  }
  sonuc ??= await aylik();
  return { gunler: sonuc.gunler, kaynakAdi: 'awqat', kaynakUc: sonuc.kaynakUc };
}
