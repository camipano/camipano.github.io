// Ekran vakit kapısı — ilçe parametreli.
// Sitedeki src/lib/ekran/vakit-kapisi.ts'den (origin/main 52f4e34) düz JS'e taşındı; eşdeğerliği esdeger.mjs denetler.
// Tek fark: sabit DIYANET_ILCE yerine `beklenenIlce` parametresi.
//
// KALICI KURAL: vakitler yalnız Diyanet İşleri Başkanlığı verisidir. Kaynağı Diyanet olmayan ya da beklenen
// ilçeden başka bir ilçenin dosyası yayımlanmaz. Biçimi/sırası bozuk ya da mükerrer gün yayımlanmaz ve hesapla
// onarılmaz. Ekran internetsiz haftalarca çalışabilsin diye dünden itibaren eldeki bütün günler verilir.

/** sitedeki src/lib/namaz.ts SIRA'sı */
export const SIRA = ['imsak', 'gunes', 'ogle', 'ikindi', 'aksam', 'yatsi'];

const SAAT = /^([01]\d|2[0-3]):[0-5]\d$/;
const TARIH = /^\d{4}-\d{2}-\d{2}$/;

/** Altı vakit HH:MM biçiminde ve imsak < güneş < öğle < ikindi < akşam < yatsı sırasında mı */
export function gunGecerliMi(g) {
  if (!TARIH.test(g.tarih) || typeof g.hicri !== 'string') return false;
  for (let i = 0; i < SIRA.length; i++) {
    const saat = g[SIRA[i]];
    if (typeof saat !== 'string' || !SAAT.test(saat)) return false;
    if (i > 0 && !(g[SIRA[i - 1]] < saat)) return false;
  }
  return true;
}

const oncekiGun = (tarih) => new Date(Date.parse(tarih + 'T12:00:00Z') - 86_400_000).toISOString().slice(0, 10);

/**
 * @param veri ham akış: { kaynak, kaynakTuru, ilce, ilceAdi, guncelleme, gunler }
 * @param bugun Brüksel tarihi (YYYY-AA-GG)
 * @param beklenenIlce caminin Diyanet ilçe kimliği
 * @returns { kaynak, kaynakTuru:'diyanet', ilce, ilceAdi, guncelleme, gunler, atlanan }
 */
export function ekranVakitleri(veri, bugun, beklenenIlce) {
  if (veri.kaynakTuru !== 'diyanet') {
    throw new Error(`EKRAN VAKİTLERİ REDDEDİLDİ: kaynakTuru="${veri.kaynakTuru ?? 'yok'}" (beklenen: "diyanet")`);
  }
  if (veri.ilce !== beklenenIlce) {
    throw new Error(`EKRAN VAKİTLERİ REDDEDİLDİ: ilçe "${veri.ilce}" (beklenen: "${beklenenIlce}")`);
  }
  const dun = oncekiGun(bugun);
  const atlanan = new Set();
  const aday = [];
  for (const kayit of veri.gunler) {
    // Tarihi metin olmayan (ya da hiç nesne olmayan) kayıt sessizce düşmez: günü bilinemez, raporlanır.
    const tarih = kayit && typeof kayit === 'object' ? kayit.tarih : kayit;
    if (!kayit || typeof kayit !== 'object' || typeof tarih !== 'string') atlanan.add('geçersiz tarih: ' + String(tarih));
    else if (tarih >= dun) aday.push(kayit);
  }
  const sayi = new Map();
  for (const g of aday) sayi.set(g.tarih, (sayi.get(g.tarih) ?? 0) + 1);
  const gunler = [];
  for (const g of [...aday].sort((a, b) => a.tarih.localeCompare(b.tarih))) {
    if ((sayi.get(g.tarih) ?? 0) > 1 || !gunGecerliMi(g)) { atlanan.add(g.tarih); continue; }
    gunler.push({ tarih: g.tarih, hicri: g.hicri, imsak: g.imsak, gunes: g.gunes, ogle: g.ogle, ikindi: g.ikindi, aksam: g.aksam, yatsi: g.yatsi });
  }
  // Veri EKSİKLİĞİ (yanlış veri değil) yayını durdurmaz: ekran son sağlam veriyle döner, veri bitince
  // "Namaz vakitleri güncellenemedi" der.
  if (gunler.length < 7) {
    console.warn(`[ekran] UYARI: vakit akışında dünden itibaren yalnız ${gunler.length} geçerli Diyanet günü var; ekran veri bitince "Namaz vakitleri güncellenemedi" der.`);
  }
  return { kaynak: veri.kaynak, kaynakTuru: 'diyanet', ilce: veri.ilce, ilceAdi: veri.ilceAdi, guncelleme: veri.guncelleme, gunler, atlanan: [...atlanan].sort() };
}
