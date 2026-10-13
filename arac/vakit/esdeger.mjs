// Ulu Camii eşdeğerlik gözcüsü — YAYINI DURDURMAZ, yalnız uyarır.
// Yayımlanan c/ulucamii-marche/vakitler.json, canlı https://ulucamii.be/ekran/vakitler.json ile karşılaştırılır:
// taşınan vakit mantığı (diyanet/birlestir/kapi) siteden sürüklenirse fark burada görünür.
// Sitedeki scripts/namaz-vakitleri.mjs ve src/lib/ekran/vakit-kapisi.ts (origin/main 52f4e34) ile eşdeğerliği bu dosya denetler.
//
// Karşılaştırma: yalnız Brüksel bugününden sonraki (bugün dâhil) ORTAK tarihler; tarihlerin kesintisiz olduğu
// varsayılmaz. Üst düzeyde kaynakTuru, ilce, ilceAdi birebir; her ortak günün altı vakti birebir; hicri farkı
// yalnız uyarı. guncelleme, atlanan, kaynak ve kaynakUc karşılaştırılmaz.
// Atlanma (atlandi, çıkış 0): canlıya ulaşılamaz/geçersiz gövde, canlı guncelleme 30 saatten eski, ortak gün < 3.
//
// CLI: node arac/vakit/esdeger.mjs   (çıkış: fark → 1; esit/atlandi → 0)
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SIRA } from './kapi.mjs';
import { bugunISO } from './birlestir.mjs';

export const REFERANS_CAMI = 'ulucamii-marche';
export const CANLI_ADRES = 'https://ulucamii.be/ekran/vakitler.json';
const BAYAT_MS = 30 * 3600 * 1000;
const EN_AZ_ORTAK = 3;

const anOku = (simdi) => (typeof simdi === 'function' ? simdi() : simdi instanceof Date ? simdi : new Date());
const akisMi = (x) => !!x && typeof x === 'object' && Array.isArray(x.gunler);

/**
 * Saf karşılaştırma.
 * @param platform c/ulucamii-marche/vakitler.json içeriği
 * @param site canlı /ekran/vakitler.json içeriği
 * @param ctx { bugun: 'YYYY-AA-GG' (Brüksel), simdi: Date | () => Date }
 * @returns { durum: 'esit'|'fark'|'atlandi', ortak, farklar: string[], uyarilar: string[] }
 */
export function esdegerlik(platform, site, { bugun, simdi }) {
  const farklar = [];
  const uyarilar = [];
  const atla = (neden, ortak = 0) => ({ durum: 'atlandi', ortak, farklar, uyarilar: [...uyarilar, neden] });

  if (!akisMi(platform)) return atla('platform akışı geçersiz');
  if (!akisMi(site)) return atla('canlı akış geçersiz');

  const guncelleme = typeof site.guncelleme === 'string' ? Date.parse(site.guncelleme) : NaN;
  if (Number.isNaN(guncelleme)) return atla('canlı akışın guncelleme alanı okunamadı');
  if (anOku(simdi).getTime() - guncelleme > BAYAT_MS) return atla('canlı akış 30 saatten eski (guncelleme ' + site.guncelleme + ')');

  // nesne olmayan girdiler (null, metin, sayı) yok sayılır
  const nesneler = (liste) => liste.filter((g) => g && typeof g === 'object' && !Array.isArray(g));
  const pHarita = new Map(nesneler(platform.gunler).map((g) => [g.tarih, g]));
  const sHarita = new Map(nesneler(site.gunler).map((g) => [g.tarih, g]));
  const ortakTarihler = [...pHarita.keys()].filter((t) => typeof t === 'string' && t >= bugun && sHarita.has(t)).sort();
  if (ortakTarihler.length < EN_AZ_ORTAK) return atla(`ortak gün yetersiz (${ortakTarihler.length} < ${EN_AZ_ORTAK})`, ortakTarihler.length);

  for (const alan of ['kaynakTuru', 'ilce', 'ilceAdi']) {
    if (platform[alan] !== site[alan]) farklar.push(`${alan} platform=${platform[alan]} site=${site[alan]}`);
  }
  for (const tarih of ortakTarihler) {
    const p = pHarita.get(tarih);
    const s = sHarita.get(tarih);
    for (const v of SIRA) if (p[v] !== s[v]) farklar.push(`${tarih} ${v} platform=${p[v]} site=${s[v]}`);
    if (p.hicri !== s.hicri) uyarilar.push(`${tarih} hicri platform=${p.hicri} site=${s.hicri}`);
  }
  return { durum: farklar.length ? 'fark' : 'esit', ortak: ortakTarihler.length, farklar, uyarilar };
}

/** CLI çekirdeği: yayımlanan referans dosya ↔ canlı akış. */
export async function esdeger({ kok, getir = fetch, simdi }) {
  const atlandi = (neden) => ({ durum: 'atlandi', ortak: 0, farklar: [], uyarilar: [neden] });
  const yol = join(kok, 'c', REFERANS_CAMI, 'vakitler.json');
  if (!existsSync(yol)) return atlandi(`platform dosyası yok (${REFERANS_CAMI}/vakitler.json)`);
  let platform;
  try { platform = JSON.parse(readFileSync(yol, 'utf8')); } catch (e) { return atlandi('platform dosyası okunamadı: ' + e.message); }

  let site;
  try {
    const r = await getir(CANLI_ADRES, { headers: { 'User-Agent': 'camipano-vakit/1.0' }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) return atlandi('canlı akışa ulaşılamadı: HTTP ' + r.status);
    site = await r.json();
  } catch (e) {
    return atlandi('canlı akışa ulaşılamadı: ' + e.message);
  }
  const an = anOku(simdi);
  return esdegerlik(platform, site, { bugun: bugunISO(an), simdi: an });
}

/** Çıkış kodunu döner: fark → 1, esit/atlandi → 0. */
export async function calistir({ kok, getir, simdi, yaz = console.log, hataYaz = console.error, env = process.env }) {
  const r = await esdeger({ kok, getir, simdi });
  yaz(`durum: ${r.durum}, ortak gün: ${r.ortak}`);
  for (const f of r.farklar) hataYaz('FARK: ' + f);
  for (const u of r.uyarilar) yaz('uyarı: ' + u);
  // GitHub Actions ek açıklaması: atlanma sessiz geçmesin (iş yine yeşil kalır)
  if (r.durum === 'atlandi' && env.GITHUB_ACTIONS === 'true') yaz(`::warning::esdeger atlandi: ${r.uyarilar.join('; ')}`);
  return r.durum === 'fark' ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  // kök: VAKIT_KOK (yalnız sınama için) ya da betik konumundan iki üst dizin
  process.exitCode = await calistir({ kok: process.env.VAKIT_KOK || fileURLToPath(new URL('../../', import.meta.url)) });
}
