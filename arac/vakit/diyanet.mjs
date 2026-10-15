// Diyanet vakit çekimi — ilçe parametreli.
// Sitedeki scripts/namaz-vakitleri.mjs'den (origin/main 52f4e34) taşındı; eşdeğerliği esdeger.mjs denetler.
// Saf parçalar birebir taşındı; dosya yazımı, ortam değişkeni (NAMAZ_HTML) ve process.exit taşınmadı.
//
// İKİ DİYANET KAYNAĞI, TEK VERİ:
//   1) RESMÎ SAYFA  https://namazvakitleri.diyanet.gov.tr/tr-TR/<ilçe>/<slug>-namaz-vakitleri  (birincil)
//      GitHub Actions'tan 200 döner; Belçika'daki bağlantılardan açılmaz (bağlantı sıfırlanıyor).
//   2) AYNA         https://ezanvakti.emushaf.net/vakitler/<ilçe>  (yedek)
//      Diyanet verisinin JSON aynası, 32 günlük kayan pencere. Belçika'dan çalışır; bulut IP'lerine 403 döner.
// HESAPLAMA TABANLI YEDEK KAYNAK YOKTUR: ikisi de başarısızsa hata fırlatılır, çağıran mevcut dosyayı korur.

export const AYLAR = { Ocak: 1, Şubat: 2, Mart: 3, Nisan: 4, Mayıs: 5, Haziran: 6, Temmuz: 7, Ağustos: 8, Eylül: 9, Ekim: 10, Kasım: 11, Aralık: 12 };
const UA = 'Mozilla/5.0 (X11; Linux x86_64) camipano-vakit/1.0 (+https://camipano.github.io)';

const bekleGercek = (ms) => new Promise((c) => setTimeout(c, ms));

export const resmiAdres = (ilce, slug) => `https://namazvakitleri.diyanet.gov.tr/tr-TR/${ilce}/${slug}-namaz-vakitleri`;
export const aynaAdres = (ilce) => `https://ezanvakti.emushaf.net/vakitler/${ilce}`;

/** Yalnız bu iki alandan veri alınır; yönlendirme başka yere giderse yanıt reddedilir. */
export const IZINLI_KAYNAK_ALANLARI = ['namazvakitleri.diyanet.gov.tr', 'ezanvakti.emushaf.net'];

/** Yeniden denemenin anlamsız olduğu hata (yanlış ilçe, yabancı alana yönlendirme). */
const tekrarsiz = (ileti) => Object.assign(new Error(ileti), { tekrarYok: true });

/** Yanıtın son adresi (boş değilse) https + izinli alan + istenen ilçe yolu olmalı. */
function sonAdresiDenetle(r, beklenen = {}) {
  if (!r.url) return;
  let u;
  try { u = new URL(r.url); } catch { throw tekrarsiz('yanıtın son adresi okunamadı: ' + r.url); }
  if (u.protocol !== 'https:' || !IZINLI_KAYNAK_ALANLARI.includes(u.hostname)) throw tekrarsiz('yanıt izinli alan dışına yönlendirildi: ' + r.url);
  const { ilce, slug } = beklenen;
  if (!ilce) return;
  if (u.hostname === 'ezanvakti.emushaf.net') {
    // Ayna adresi aynaAdres(ilce) ile kurulur: /vakitler/<ilce>. Sondaki eğik çizgi hoş görülür.
    const son = u.pathname.split('/').filter(Boolean).at(-1) ?? '';
    if (son !== ilce) throw tekrarsiz(`yanıt başka ilçeye yönlendirildi (beklenen: "${ilce}", bulunan: "${son}"): ` + r.url);
  } else if (u.hostname === 'namazvakitleri.diyanet.gov.tr') {
    // Resmî adres resmiAdres(ilce, slug) ile kurulur: /tr-TR/<ilce>/<slug>-namaz-vakitleri. Sondaki eğik çizgi hoş görülür.
    if (!slug) return;
    const yol = u.pathname.replace(/\/+$/, '');
    const beklenenParca = `/${ilce}/${slug}-namaz-vakitleri`;
    if (!yol.endsWith(beklenenParca)) throw tekrarsiz(`yanıt başka ilçeye yönlendirildi (beklenen: "${beklenenParca}", bulunan: "${u.pathname}"): ` + r.url);
  }
}

/** İlçe adı karşılaştırması: aksan, büyük/küçük harf ve İ/ı farkı yok sayılır ("M.famenne" ≡ "M.FAMENNE"). */
export const ilceAdiNorm = (s) => s.normalize('NFKD').replace(/\p{M}/gu, '').toUpperCase().trim();

/**
 * Resmî sayfanın tablo başlığındaki ilçe adı: "<ad> İçin Haftalık Namaz Vakitleri" (Aylık/Yıllık da olur).
 * İlk eşleşme kazanır; başlık yoksa null.
 */
export function resmiSayfaIlceAdi(html) {
  for (const [, ic] of html.matchAll(/<caption[^>]*>([\s\S]*?)<\/caption>/g)) {
    const metin = varlikCoz(ic.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const m = metin.match(/^(.+?) İçin (?:Haftalık|Aylık|Yıllık) Namaz Vak(?:it|ti)/);
    if (m) return m[1].trim();
  }
  return null;
}

/** Ortak yeniden deneme sarmalayıcısı. */
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

/** HTML varlık çözümü (sayfada yalnız birkaç tanesi geçiyor). */
const varlikCoz = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

/** Resmî sayfanın tablolarını ayrıştırır: "30 Ağustos 2026 Pazar 17 Rebiulevvel 1448 04:48 06:43 …" */
export function resmiSayfayiAyristir(html) {
  const gunler = new Map();
  for (const [, satir] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const metin = varlikCoz(satir.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const m = metin.match(/^(\d{1,2}) (\S+) (\d{4}) \S+ (.*?) ?((?:[0-2]\d:[0-5]\d ?){6})$/);
    if (!m || !(m[2] in AYLAR)) continue;
    const tarih = `${m[3]}-${String(AYLAR[m[2]]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
    const [imsak, gunes, ogle, ikindi, aksam, yatsi] = m[5].trim().split(/\s+/);
    gunler.set(tarih, { tarih, hicri: m[4].trim(), imsak, gunes, ogle, ikindi, aksam, yatsi });
  }
  return [...gunler.values()].sort((a, b) => a.tarih.localeCompare(b.tarih));
}

/** Ayna: Diyanet'in ham JSON kaydını site biçimine çevirir. */
export function aynaDonustur(g) {
  const k = g.MiladiTarihKisaIso8601 || g.MiladiTarihKisa || '';
  const m = k.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  return {
    tarih: m ? `${m[3]}-${m[2]}-${m[1]}` : k.slice(0, 10),
    hicri: g.HicriTarihUzun ?? g.HicriTarihKisa ?? '',
    imsak: g.Imsak, gunes: g.Gunes, ogle: g.Ogle, ikindi: g.Ikindi, aksam: g.Aksam, yatsi: g.Yatsi,
  };
}

async function resmiSayfadanCek(ilce, slug, ilceAdi, getir, bekle) {
  return dene('resmî sayfa', async () => {
    const r = await getir(resmiAdres(ilce, slug), {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'tr-TR,tr;q=0.9' },
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    sonAdresiDenetle(r, { ilce, slug });
    const html = await r.text();
    if (ilceAdi) {
      const bulunan = resmiSayfaIlceAdi(html);
      if (bulunan === null) throw tekrarsiz(`sayfada ilçe başlığı yok (beklenen: "${ilceAdi}") — sayfa yapısı değişmiş olabilir`);
      if (ilceAdiNorm(bulunan) !== ilceAdiNorm(ilceAdi)) {
        throw Object.assign(tekrarsiz(`sayfa başka ilçeye ait: "${bulunan}" (beklenen: "${ilceAdi}")`), { ilceUyusmaz: true });
      }
    }
    const gunler = resmiSayfayiAyristir(html);
    if (gunler.length < 7) throw new Error(`sayfa ayrıştırılamadı (${gunler.length} gün) — sayfa yapısı değişmiş olabilir`);
    // kaynakUc, istenen değil gerçekten çekilen (son) adrestir; yönlendirme yoksa istenenle aynıdır.
    return { gunler, sonAdres: r.url || resmiAdres(ilce, slug) };
  }, [10000, 30000], bekle);
}

async function aynadanCek(ilce, getir, bekle) {
  return dene('ayna', async () => {
    const r = await getir(aynaAdres(ilce), {
      headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'tr,fr;q=0.8,en;q=0.6' },
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    sonAdresiDenetle(r, { ilce });
    const ham = await r.json();
    if (!Array.isArray(ham) || ham.length < 7) throw new Error('beklenmeyen gövde');
    const gunler = ham.map(aynaDonustur).sort((a, b) => a.tarih.localeCompare(b.tarih));
    // kaynakUc, istenen değil gerçekten çekilen (son) adrestir; yönlendirme yoksa istenenle aynıdır.
    return { gunler, sonAdres: r.url || aynaAdres(ilce) };
  }, [10000, 30000, 60000], bekle);
}

/**
 * Önce resmî sayfa (en az 7 gün), olmazsa ayna. `ilceAdi` verilmişse resmî sayfanın başlığındaki ilçe adı
 * eşleşmek zorundadır (ayna başlık taşımadığı için ona uygulanmaz). Başlıkta başka ilçe çıkarsa aynaya da geçilmez:
 * ayna aynı ilçe numarasını kullanır, o da başka ilçenin vakitlerini verir. İkisi de başarısızsa hata fırlatır;
 * hesapla onarım yoktur.
 * @returns { gunler, kaynakAdi: 'resmî sayfa'|'ayna', kaynakUc }
 */
export async function cek({ ilce, slug, ilceAdi }, { getir = fetch, bekle = bekleGercek } = {}) {
  try {
    const resmi = await resmiSayfadanCek(ilce, slug, ilceAdi, getir, bekle);
    return { gunler: resmi.gunler, kaynakAdi: 'resmî sayfa', kaynakUc: resmi.sonAdres };
  } catch (e1) {
    if (e1.ilceUyusmaz) throw new Error(`ilçe ${ilce} artık kayıttaki ilçeyi göstermiyor — ${e1.message}; camiler.json denetlenmeli`);
    console.warn('Resmî sayfa alınamadı: ' + e1.message + ' → ayna deneniyor');
    try {
      const ayna = await aynadanCek(ilce, getir, bekle);
      return { gunler: ayna.gunler, kaynakAdi: 'ayna', kaynakUc: ayna.sonAdres };
    } catch (e2) {
      throw new Error('Diyanet vakitleri hiçbir kaynaktan alınamadı — resmî: ' + e1.message + ' · ayna: ' + e2.message);
    }
  }
}
