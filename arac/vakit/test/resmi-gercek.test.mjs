// Gerçek resmî sayfa yapısıyla ayrıştırma (13 Eki 2026'da alınan sayfanın haftalık + aylık tablosu ve yıllık tablonun
// ilk 30 satırı). Elle kurulmuş resmi-11890.html'in kaçırabileceği gerçek işaretleme farklarını yakalar; ayrıca resmî
// sayfa ile ayna aynı Diyanet takvimini vermeli (site 30 Ağu 2026'da 29 ortak günde sıfır fark doğrulamıştı).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resmiSayfayiAyristir, aynaDonustur } from '../diyanet.mjs';

const fikstur = (ad) => readFileSync(new URL('./fikstur/' + ad, import.meta.url), 'utf8');
const VAKITLER = ['imsak', 'gunes', 'ogle', 'ikindi', 'aksam', 'yatsi'];

test('gerçek resmî sayfa: haftalık, aylık ve yıllık satırlar ayrıştırılır', () => {
  const gunler = resmiSayfayiAyristir(fikstur('resmi-11890-gercek.html'));
  assert.equal(gunler.length, 61);
  assert.deepEqual(gunler[0], { tarih: '2026-10-13', hicri: '2 Cemaziyelevvel 1448', imsak: '06:09', gunes: '07:50', ogle: '13:30', ikindi: '16:22', aksam: '19:00', yatsi: '20:28' });
  assert.equal(gunler.at(-1).tarih, '2027-01-30');
  assert.ok(gunler.every((g, i) => i === 0 || gunler[i - 1].tarih < g.tarih), 'tarihler artan sırada');
});

test('resmî sayfa ile ayna ortak günlerde aynı altı vakti verir', () => {
  const resmi = new Map(resmiSayfayiAyristir(fikstur('resmi-11890-gercek.html')).map((g) => [g.tarih, g]));
  const ayna = JSON.parse(fikstur('ayna-11890.json')).map(aynaDonustur);
  const ortak = ayna.filter((g) => resmi.has(g.tarih));
  assert.ok(ortak.length >= 25, `ortak gün ${ortak.length}`);
  for (const g of ortak) for (const v of VAKITLER) assert.equal(resmi.get(g.tarih)[v], g[v], `${g.tarih} ${v}`);
});
