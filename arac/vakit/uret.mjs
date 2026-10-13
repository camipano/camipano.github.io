// Cami başına vakitler.json üretimi: camiler.json → c/<camiId>/vakitler.json.
// Akış (her cami için): eldeki dosya (taban) → çek → birleştir → doğrula → kapı → yaz.
// Bir cami başarısız olursa diğerleri sürer, o caminin mevcut dosyası korunur, çıkış kodu ≠ 0 olur.
// HESAPLAMA TABANLI YEDEK KAYNAK YOKTUR: yalnız Diyanet'in resmî sayfası ve aynası.
//
// CLI: node arac/vakit/uret.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { camilerOku } from './camiler.mjs';
import { cek as cekVarsayilan } from './diyanet.mjs';
import { birlestir, dogrula, bugunISO } from './birlestir.mjs';
import { ekranVakitleri } from './kapi.mjs';

export const IZINLI_KAYNAK_ALANLARI = ['namazvakitleri.diyanet.gov.tr', 'ezanvakti.emushaf.net'];

/** Eldeki dosya: okunabiliyorsa ve Diyanet + aynı ilçe ise döner, değilse null (taban boş sayılır). */
function eldekiOku(yol, ilce) {
  if (!existsSync(yol)) return null;
  try {
    const d = JSON.parse(readFileSync(yol, 'utf8'));
    return d && d.kaynakTuru === 'diyanet' && d.ilce === ilce && Array.isArray(d.gunler) ? d : null;
  } catch { return null; }
}

function kaynakIzinliMi(uc) {
  let url;
  try { url = new URL(uc); } catch { return false; }
  return url.protocol === 'https:' && IZINLI_KAYNAK_ALANLARI.includes(url.hostname);
}

/**
 * @param {object} p
 * @param p.kok depo kökü (camiler.json burada; çıktı <kok>/c/<camiId>/vakitler.json)
 * @param p.getir fetch benzeri (test için)
 * @param p.bekle yeniden deneme beklemesi (test için anında döner)
 * @param p.simdi () => Date
 * @param p.cek diyanet.cek yerine geçen işlev (yalnız test için)
 * @returns { sonuc: [{camiId, durum:'yazildi'|'degismedi'|'hata', ileti}], hataVar }
 * camiler.json bozuksa ya da camiId yineleniyorsa hiçbir şey yazılmadan Error fırlatır.
 */
export async function uret({ kok, getir, bekle, simdi = () => new Date(), cek = cekVarsayilan }) {
  const camiler = camilerOku(readFileSync(join(kok, 'camiler.json'), 'utf8'));
  const sonuc = [];
  for (const cami of camiler) {
    try {
      const yol = join(kok, 'c', cami.camiId, 'vakitler.json');
      const eldeki = eldekiOku(yol, cami.ilce);
      const an = simdi();
      const bugun = bugunISO(an);

      const taze = await cek({ ilce: cami.ilce, slug: cami.slug }, { getir, bekle });
      if (!kaynakIzinliMi(taze.kaynakUc)) throw new Error(`kaynak adresi izinli alanlarda değil: ${taze.kaynakUc}`);

      const { gunler, yeni, duzeltme } = birlestir(eldeki?.gunler ?? [], taze.gunler, bugun);
      dogrula(gunler, bugun);

      const ham = {
        kaynak: `Diyanet İşleri Başkanlığı — ${cami.adTr} (ilçe ${cami.ilce})`,
        kaynakTuru: taze.kaynakTuru ?? 'diyanet', // kapı, 'diyanet' dışını reddeder
        kaynakUc: taze.kaynakUc,
        ilce: cami.ilce,
        ilceAdi: cami.ilceAdi,
        guncelleme: an.toISOString(),
        gunler,
      };
      const cikti = { ...ekranVakitleri(ham, bugun, cami.ilce), kaynakUc: taze.kaynakUc };

      if (eldeki && JSON.stringify(eldeki.gunler) === JSON.stringify(cikti.gunler)) {
        sonuc.push({ camiId: cami.camiId, durum: 'degismedi', ileti: `${cikti.gunler.length} gün · kontrol kaynağı: ${taze.kaynakAdi}` });
        continue;
      }
      mkdirSync(join(kok, 'c', cami.camiId), { recursive: true });
      writeFileSync(yol, JSON.stringify(cikti));
      sonuc.push({ camiId: cami.camiId, durum: 'yazildi', ileti: `${cikti.gunler.length} gün (${cikti.gunler[0].tarih} → ${cikti.gunler.at(-1).tarih}) · kaynak: ${taze.kaynakAdi} · yeni ${yeni}, düzeltme ${duzeltme}` });
    } catch (e) {
      sonuc.push({ camiId: cami.camiId, durum: 'hata', ileti: e.message });
    }
  }
  return { sonuc, hataVar: sonuc.some((s) => s.durum === 'hata') };
}

/** CLI çekirdeği: çıkış kodunu döner (0 tamam, 1 hata). */
export async function calistir({ kok, getir, bekle, simdi, yaz = console.log, hataYaz = console.error }) {
  let r;
  try {
    r = await uret({ kok, getir, bekle, simdi });
  } catch (e) {
    hataYaz('HATA: ' + e.message + ' — hiçbir şey yazılmadı.');
    return 1;
  }
  for (const s of r.sonuc) (s.durum === 'hata' ? hataYaz : yaz)(`${s.camiId}: ${s.durum} — ${s.ileti}`);
  return r.hataVar ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // kök: betik konumundan iki üst dizin (arac/vakit → depo kökü)
  process.exitCode = await calistir({ kok: fileURLToPath(new URL('../../', import.meta.url)) });
}
