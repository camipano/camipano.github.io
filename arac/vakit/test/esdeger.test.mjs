// esdeger.mjs testleri — saf `esdegerlik` + sahte `getir` ile CLI çekirdeği. Ağ yok.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { esdegerlik, esdeger, calistir } from '../esdeger.mjs';

const BUGUN = '2026-10-13';
const SIMDI = new Date('2026-10-13T10:00:00Z');
const gun = (tarih, ek = {}) => ({ tarih, hicri: '2 Cemaziyelevvel 1448', imsak: '06:09', gunes: '07:50', ogle: '13:30', ikindi: '16:22', aksam: '19:00', yatsi: '20:28', ...ek });
const gunler = (bas, n) => Array.from({ length: n }, (_, i) => gun(new Date(Date.parse(bas + 'T12:00:00Z') + i * 864e5).toISOString().slice(0, 10)));
const akis = (liste, ek = {}) => ({ kaynak: 'Diyanet', kaynakTuru: 'diyanet', ilce: '11890', ilceAdi: 'M.FAMENNE', guncelleme: '2026-10-13T03:30:00Z', gunler: liste, atlanan: [], ...ek });
const baglam = { bugun: BUGUN, simdi: SIMDI };

test('aynı günler → esit', () => {
  const r = esdegerlik(akis(gunler('2026-10-12', 20)), akis(gunler('2026-10-12', 20)), baglam);
  assert.equal(r.durum, 'esit');
  assert.equal(r.ortak, 19); // 13 Eki ve sonrası
  assert.deepEqual(r.farklar, []);
  assert.deepEqual(r.uyarilar, []);
});

test('bir günün ikindisi 1 dk farklıysa → fark; ileti tarih ve vakti içerir', () => {
  const site = gunler('2026-10-12', 20);
  site[5] = gun(site[5].tarih, { ikindi: '16:23' });
  const r = esdegerlik(akis(gunler('2026-10-12', 20)), akis(site), baglam);
  assert.equal(r.durum, 'fark');
  assert.deepEqual(r.farklar, ['2026-10-17 ikindi platform=16:22 site=16:23']);
});

test('yalnız hicrî farkı → esit + uyarı', () => {
  const site = gunler('2026-10-12', 20);
  site[4] = gun(site[4].tarih, { hicri: '5 Cemaziyelevvel 1448' });
  const r = esdegerlik(akis(gunler('2026-10-12', 20)), akis(site), baglam);
  assert.equal(r.durum, 'esit');
  assert.deepEqual(r.farklar, []);
  assert.equal(r.uyarilar.length, 1);
  assert.match(r.uyarilar[0], /2026-10-16 hicri/);
});

test('bugünden önceki bir günde fark dikkate alınmaz; bugünün kendisi karşılaştırılır', () => {
  const site = gunler('2026-10-10', 20);
  site[0] = gun(site[0].tarih, { imsak: '05:00' }); // 10 Eki: geçmiş
  site[2] = gun(site[2].tarih, { imsak: '05:00' }); // 12 Eki: dün
  const r1 = esdegerlik(akis(gunler('2026-10-10', 20)), akis(site), baglam);
  assert.equal(r1.durum, 'esit');
  const bugunFarkli = gunler('2026-10-10', 20);
  bugunFarkli[3] = gun(bugunFarkli[3].tarih, { aksam: '19:01' }); // 13 Eki: bugün
  const r2 = esdegerlik(akis(gunler('2026-10-10', 20)), akis(bugunFarkli), baglam);
  assert.equal(r2.durum, 'fark');
  assert.match(r2.farklar[0], /^2026-10-13 aksam platform=19:00 site=19:01$/);
});

test('site.guncelleme 31 saat önceyse → atlandi; 29 saat önceyse karşılaştırılır', () => {
  const eski = akis(gunler('2026-10-12', 20), { guncelleme: '2026-10-12T03:00:00Z' }); // 31 sa
  const r = esdegerlik(akis(gunler('2026-10-12', 20)), eski, baglam);
  assert.equal(r.durum, 'atlandi');
  assert.match(r.uyarilar.join(' '), /30 saat/);
  const taze = akis(gunler('2026-10-12', 20), { guncelleme: '2026-10-12T05:00:00Z' }); // 29 sa
  assert.equal(esdegerlik(akis(gunler('2026-10-12', 20)), taze, baglam).durum, 'esit');
  // eski olsa bile fark varsa atlandi (kıyas yapılmaz)
  const eskiFarkli = akis(gunler('2026-10-12', 20).map((g) => ({ ...g, ogle: '13:31' })), { guncelleme: '2026-10-12T03:00:00Z' });
  assert.equal(esdegerlik(akis(gunler('2026-10-12', 20)), eskiFarkli, baglam).durum, 'atlandi');
});

test('guncelleme eksik ya da bozuk, gövde geçersiz → atlandi', () => {
  const p = akis(gunler('2026-10-12', 20));
  assert.equal(esdegerlik(p, akis(gunler('2026-10-12', 20), { guncelleme: undefined }), baglam).durum, 'atlandi');
  assert.equal(esdegerlik(p, akis(gunler('2026-10-12', 20), { guncelleme: 'dün' }), baglam).durum, 'atlandi');
  assert.equal(esdegerlik(p, null, baglam).durum, 'atlandi');
  assert.equal(esdegerlik(p, { gunler: 'x' }, baglam).durum, 'atlandi');
  assert.equal(esdegerlik(null, akis(gunler('2026-10-12', 20)), baglam).durum, 'atlandi');
});

test('ortak gün yok ya da 2 → atlandi; 3 → karşılaştırılır', () => {
  const r0 = esdegerlik(akis(gunler('2026-10-12', 3)), akis(gunler('2026-11-01', 5)), baglam);
  assert.equal(r0.durum, 'atlandi');
  assert.equal(r0.ortak, 0);
  // 12, 13, 14 → bugünden itibaren 13 ve 14 = 2 ortak gün
  const r2 = esdegerlik(akis(gunler('2026-10-12', 3)), akis(gunler('2026-10-12', 3)), baglam);
  assert.equal(r2.durum, 'atlandi');
  assert.equal(r2.ortak, 2);
  const r3 = esdegerlik(akis(gunler('2026-10-12', 4)), akis(gunler('2026-10-12', 4)), baglam);
  assert.equal(r3.durum, 'esit');
  assert.equal(r3.ortak, 3);
});

test('üst düzey kaynakTuru, ilce, ilceAdi farkı → fark', () => {
  const p = akis(gunler('2026-10-12', 20));
  for (const [alan, deger] of [['ilce', '9999'], ['kaynakTuru', 'aladhan'], ['ilceAdi', 'BASKA']]) {
    const r = esdegerlik(p, akis(gunler('2026-10-12', 20), { [alan]: deger }), baglam);
    assert.equal(r.durum, 'fark', alan);
    assert.ok(r.farklar.some((f) => f.includes(alan) && f.includes(deger)), r.farklar.join('|'));
  }
});

test('guncelleme, atlanan, kaynak ve kaynakUc karşılaştırılmaz', () => {
  const p = akis(gunler('2026-10-12', 20), { kaynakUc: 'https://ezanvakti.emushaf.net/vakitler/11890', kaynak: 'A', guncelleme: '2026-10-13T04:41:00Z' });
  const s = akis(gunler('2026-10-12', 20), { kaynak: 'B', atlanan: ['2026-11-01'], guncelleme: '2026-10-13T03:30:00Z' });
  assert.equal(esdegerlik(p, s, baglam).durum, 'esit');
});

test('platformda boşluklu tarih dizisi: yalnız ortak günler karşılaştırılır → esit', () => {
  const platform = gunler('2026-10-12', 20).filter((g) => g.tarih !== '2026-10-20');
  const r = esdegerlik(akis(platform), akis(gunler('2026-10-12', 20)), baglam);
  assert.equal(r.durum, 'esit');
  assert.equal(r.ortak, 18);
});

test('yalnız bir tarafta olan gün fark sayılmaz', () => {
  const r = esdegerlik(akis(gunler('2026-10-12', 40)), akis(gunler('2026-10-12', 20)), baglam);
  assert.equal(r.durum, 'esit');
  assert.equal(r.ortak, 19);
});

// ---- CLI çekirdeği
function kokKur(platformAkis) {
  const kok = mkdtempSync(join(tmpdir(), 'esdeger-test-'));
  if (platformAkis !== undefined) {
    mkdirSync(join(kok, 'c', 'ulucamii-marche'), { recursive: true });
    writeFileSync(join(kok, 'c', 'ulucamii-marche', 'vakitler.json'), typeof platformAkis === 'string' ? platformAkis : JSON.stringify(platformAkis));
  }
  return kok;
}
const yanit = (govde, durum = 200) => ({ ok: durum < 400, status: durum, text: async () => govde, json: async () => JSON.parse(govde) });
const sustur = (t) => { t.mock.method(console, 'log', () => {}); t.mock.method(console, 'error', () => {}); t.mock.method(console, 'warn', () => {}); };

test('esdeger: canlı adresten okur, aynı veri → esit; fark → fark', async () => {
  const kok = kokKur(akis(gunler('2026-10-12', 20)));
  try {
    const istekler = [];
    const canli = akis(gunler('2026-10-12', 20));
    const r = await esdeger({ kok, getir: async (u) => { istekler.push(u); return yanit(JSON.stringify(canli)); }, simdi: () => SIMDI });
    assert.equal(r.durum, 'esit');
    assert.deepEqual(istekler, ['https://ulucamii.be/ekran/vakitler.json']);
    canli.gunler[6] = gun(canli.gunler[6].tarih, { yatsi: '20:29' });
    const r2 = await esdeger({ kok, getir: async () => yanit(JSON.stringify(canli)), simdi: () => SIMDI });
    assert.equal(r2.durum, 'fark');
    assert.match(r2.farklar[0], /yatsi platform=20:28 site=20:29/);
  } finally { rmSync(kok, { recursive: true, force: true }); }
});

test('esdeger: canlı 500, ağ hatası ya da bozuk gövde → atlandi', async () => {
  const kok = kokKur(akis(gunler('2026-10-12', 20)));
  try {
    for (const getir of [
      async () => yanit('', 500),
      async () => { throw new Error('fetch failed'); },
      async () => yanit('<html>bakım</html>'),
    ]) {
      const r = await esdeger({ kok, getir, simdi: () => SIMDI });
      assert.equal(r.durum, 'atlandi');
      assert.ok(r.uyarilar.length >= 1);
    }
  } finally { rmSync(kok, { recursive: true, force: true }); }
});

test('esdeger: platform dosyası yoksa ya da bozuksa → atlandi (ağa gidilmez)', async () => {
  for (const platform of [undefined, '{bozuk']) {
    const kok = kokKur(platform);
    try {
      let cagri = 0;
      const r = await esdeger({ kok, getir: async () => { cagri++; return yanit('{}'); }, simdi: () => SIMDI });
      assert.equal(r.durum, 'atlandi');
      assert.equal(cagri, 0);
    } finally { rmSync(kok, { recursive: true, force: true }); }
  }
});

test('calistir: fark → çıkış 1; esit ve atlandi → 0; çıktı durum ve ortak günü yazar', async (t) => {
  sustur(t);
  const kok = kokKur(akis(gunler('2026-10-12', 20)));
  try {
    const cikti = [];
    const yaz = (s) => cikti.push(s);
    const esitKod = await calistir({ kok, getir: async () => yanit(JSON.stringify(akis(gunler('2026-10-12', 20)))), simdi: () => SIMDI, yaz, hataYaz: yaz });
    assert.equal(esitKod, 0);
    assert.match(cikti.join('\n'), /durum: esit, ortak gün: 19/);

    const farkli = akis(gunler('2026-10-12', 20).map((g) => ({ ...g, ogle: '13:31' })));
    const c2 = [];
    const farkKod = await calistir({ kok, getir: async () => yanit(JSON.stringify(farkli)), simdi: () => SIMDI, yaz: (s) => c2.push(s), hataYaz: (s) => c2.push(s) });
    assert.equal(farkKod, 1);
    assert.match(c2.join('\n'), /durum: fark/);
    assert.match(c2.join('\n'), /2026-10-13 ogle platform=13:30 site=13:31/);

    const atlaKod = await calistir({ kok, getir: async () => yanit('', 500), simdi: () => SIMDI, yaz: () => {}, hataYaz: () => {} });
    assert.equal(atlaKod, 0);
  } finally { rmSync(kok, { recursive: true, force: true }); }
});
