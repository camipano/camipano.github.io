// Doğrulama ve birleştirme — `bugun` parametreli saf işlevler.
// Sitedeki scripts/namaz-vakitleri.mjs'den (origin/main 52f4e34) taşındı; eşdeğerliği esdeger.mjs denetler.
// Dosya yazımı ve process.exit taşınmadı.
import { SIRA } from './kapi.mjs';

const SAAT = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Brüksel takvim tarihi (YYYY-AA-GG) */
export const bugunISO = (simdi = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(simdi);
export const gunFarki = (a, b) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400000);
/** `iso` tarihinden `n` gün öncesi (n negatifse sonrası). Sitedeki adı korunur. */
export const dkOnce = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10);

/** Yayımlanmadan önce veri sağlığı: eksik/bozuk veri asla yazılmaz. */
export function dogrula(gunler, bugun) {
  if (!Array.isArray(gunler) || gunler.length < 7) throw new Error(`yetersiz gün sayısı (${gunler?.length ?? 0})`);
  for (const g of gunler) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g.tarih)) throw new Error(`geçersiz tarih: ${g.tarih}`);
    for (const v of SIRA) {
      if (!SAAT.test(g[v] ?? '')) throw new Error(`geçersiz ${v} (${g.tarih}): ${g[v]}`);
    }
    // sıra denetimi: imsak < güneş < öğle < ikindi < akşam < yatsı
    const dk = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
    const s = SIRA.map((v) => dk(g[v]));
    if (!s.every((x, i) => i === 0 || x > s[i - 1])) throw new Error(`vakit sırası bozuk: ${g.tarih}`);
  }
  if (!gunler.some((g) => g.tarih === bugun)) throw new Error(`bugün (${bugun}) veride yok — bayat kaynak`);
  // bugünden itibaren en az 7 gün kesintisiz olmalı
  for (let i = 1; i < 7; i++) {
    const t = dkOnce(bugun, -i);
    if (!gunler.some((g) => g.tarih === t)) throw new Error(`bugünden sonraki ${i}. gün (${t}) eksik`);
  }
}

/**
 * Birleştirme: eldeki Diyanet günleri taban, taze günler üstüne (taze kazanır). Dünden eskisi atılır,
 * eldeki ileri tarihli günler korunur.
 * @returns { gunler, yeni, duzeltme }
 */
export function birlestir(eldekiGunler, tazeGunler, bugun) {
  const dun = dkOnce(bugun, 1);
  const harita = new Map();
  // Eldeki dosyadaki bozuk satırlar (null, nesne dışı, tarihsiz) birleştirmeyi düşürmez:
  // kapi.mjs:47 / esdeger.mjs:46 ile aynı elek, sayısı uyarıda raporlanır.
  let atlanan = 0;
  for (const g of eldekiGunler ?? []) {
    if (!g || typeof g !== 'object' || Array.isArray(g) || typeof g.tarih !== 'string') { atlanan++; continue; }
    if (g.tarih >= dun) harita.set(g.tarih, g);
  }
  if (atlanan > 0) console.warn(`Eldeki dosyada ${atlanan} geçersiz satır atlandı.`);
  let duzeltme = 0, yeni = 0;
  for (const g of tazeGunler) {
    if (g.tarih < dun) continue;
    const eski = harita.get(g.tarih);
    if (!eski) yeni++;
    else if (SIRA.some((v) => eski[v] !== g[v])) {
      duzeltme++;
      console.warn(`Diyanet düzeltmesi ${g.tarih}: ${SIRA.map((v) => `${eski[v]}→${g[v]}`).join(' ')}`);
    }
    harita.set(g.tarih, g);
  }
  const gunler = [...harita.values()].sort((a, b) => a.tarih.localeCompare(b.tarih));
  return { gunler, yeni, duzeltme };
}

/** Bugünden başlayan kesintisiz dizinin son gününe kadar kalan gün (bugün yoksa null). */
export function kalanGun(gunler, bugun) {
  let son = null;
  for (let i = 0; ; i++) {
    const t = dkOnce(bugun, -i);
    if (!gunler.some((g) => g.tarih === t)) break;
    son = t;
  }
  return son ? gunFarki(son, bugun) : null;
}
