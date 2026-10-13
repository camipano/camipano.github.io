// camiler.json okuyucu ve doğrulayıcı.
// Şema: { "surum": 1, "camiler": [ { camiId, adTr, adFr, ilce, ilceAdi, slug, saatDilimi, konum: { enlem, boylam }, cumaSaati } ] }
// Bozuk JSON, surum !== 1, bozuk alan ya da yinelenen camiId → Error (çağıran hiçbir şey yazmaz).

const CAMI_ID = /^[a-z0-9][a-z0-9-]{2,39}$/;
const ILCE = /^[0-9]{1,6}$/;
const SLUG = /^[a-z0-9-]{1,60}$/;
const SAAT = /^([01]\d|2[0-3]):[0-5]\d$/;

const metin = (v) => typeof v === 'string' && v.trim() !== '';
const sayi = (v) => typeof v === 'number' && Number.isFinite(v);

function camiDogrula(c, sira) {
  const ad = `camiler[${sira}]`;
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error(`${ad}: nesne değil`);
  if (typeof c.camiId !== 'string' || !CAMI_ID.test(c.camiId)) throw new Error(`${ad}: geçersiz camiId (${String(c.camiId)})`);
  if (!metin(c.adTr)) throw new Error(`${ad} (${c.camiId}): adTr boş`);
  if (typeof c.adFr !== 'string') throw new Error(`${ad} (${c.camiId}): adFr metin değil`);
  if (typeof c.ilce !== 'string' || !ILCE.test(c.ilce)) throw new Error(`${ad} (${c.camiId}): geçersiz ilce (${String(c.ilce)})`);
  if (!metin(c.ilceAdi)) throw new Error(`${ad} (${c.camiId}): ilceAdi boş`);
  if (typeof c.slug !== 'string' || !SLUG.test(c.slug)) throw new Error(`${ad} (${c.camiId}): geçersiz slug (${String(c.slug)})`);
  if (c.saatDilimi !== 'Europe/Brussels') throw new Error(`${ad} (${c.camiId}): saatDilimi yalnız Europe/Brussels olabilir (${String(c.saatDilimi)})`);
  if (!c.konum || !sayi(c.konum.enlem) || !sayi(c.konum.boylam)) throw new Error(`${ad} (${c.camiId}): konum {enlem, boylam} sayı olmalı`);
  if (typeof c.cumaSaati !== 'string' || (c.cumaSaati !== '' && !SAAT.test(c.cumaSaati))) throw new Error(`${ad} (${c.camiId}): cumaSaati boş ya da SS:DD olmalı`);
  return {
    camiId: c.camiId, adTr: c.adTr, adFr: c.adFr, ilce: c.ilce, ilceAdi: c.ilceAdi, slug: c.slug,
    saatDilimi: c.saatDilimi, konum: { enlem: c.konum.enlem, boylam: c.konum.boylam }, cumaSaati: c.cumaSaati,
  };
}

/** camiler.json metnini ayrıştırır ve doğrular. */
export function camilerOku(metinGovde) {
  let j;
  try { j = JSON.parse(metinGovde); } catch (e) { throw new Error('camiler.json bozuk: ' + e.message); }
  if (!j || typeof j !== 'object' || j.surum !== 1) throw new Error(`camiler.json: surum 1 bekleniyor (${String(j?.surum)})`);
  if (!Array.isArray(j.camiler)) throw new Error('camiler.json: camiler dizi olmalı');
  const gorulen = new Set();
  return j.camiler.map((c, i) => {
    const d = camiDogrula(c, i);
    if (gorulen.has(d.camiId)) throw new Error(`camiler.json: yinelenen camiId (${d.camiId})`);
    gorulen.add(d.camiId);
    return d;
  });
}
