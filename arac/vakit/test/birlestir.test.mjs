// birlestir.mjs testleri — saf işlevler; `bugun` parametreli.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bugunISO, dkOnce, dogrula, birlestir, kalanGun } from '../birlestir.mjs';

const gun = (tarih, ek = {}) => ({ tarih, hicri: '15 Rebiulahir 1448', imsak: '05:41', gunes: '07:24', ogle: '13:35', ikindi: '16:49', aksam: '19:37', yatsi: '21:06', ...ek });
const gunler = (bas, n) => Array.from({ length: n }, (_, i) => gun(dkOnce(bas, -i)));
const BUGUN = '2026-10-13';

test('bugunISO Brüksel tarihini verir (UTC gece yarısı sınırı)', () => {
  assert.equal(bugunISO(new Date('2026-10-13T10:00:00Z')), '2026-10-13');
  // 22:30 UTC = Brüksel'de ertesi gün 00:30 (yaz saati +2)
  assert.equal(bugunISO(new Date('2026-10-13T22:30:00Z')), '2026-10-14');
  assert.equal(bugunISO(new Date('2026-10-13T21:30:00Z')), '2026-10-13');
  // kış saati +1
  assert.equal(bugunISO(new Date('2026-12-31T23:30:00Z')), '2027-01-01');
});

test('bugunISO yaz saati bitişinde (25 Eki 2026) doğru tarihi verir', () => {
  assert.equal(bugunISO(new Date('2026-10-24T22:30:00Z')), '2026-10-25'); // 00:30 CEST
  assert.equal(bugunISO(new Date('2026-10-25T22:30:00Z')), '2026-10-25'); // 23:30 CET
  assert.equal(bugunISO(new Date('2026-10-25T23:30:00Z')), '2026-10-26'); // 00:30 CET
});

test('dkOnce gün geriye/ileriye sayar', () => {
  assert.equal(dkOnce('2026-10-13', 1), '2026-10-12');
  assert.equal(dkOnce('2026-10-13', -3), '2026-10-16');
  assert.equal(dkOnce('2026-03-01', 1), '2026-02-28');
});

test('dogrula: sağlam veri geçer', () => {
  assert.doesNotThrow(() => dogrula(gunler('2026-10-12', 20), BUGUN));
});

test('dogrula: bugün veride yoksa hata', () => {
  assert.throws(() => dogrula(gunler('2026-10-14', 20), BUGUN), /bugün \(2026-10-13\) veride yok/);
});

test('dogrula: bugünden sonraki 7 günlük kesintisizlik eksikse hata', () => {
  const g = gunler('2026-10-12', 20).filter((x) => x.tarih !== '2026-10-17');
  assert.throws(() => dogrula(g, BUGUN), /bugünden sonraki 4\. gün \(2026-10-17\) eksik/);
});

test('dogrula: vakit sırası bozuksa hata', () => {
  const g = gunler('2026-10-12', 20);
  g[3] = gun(g[3].tarih, { ikindi: '12:00' });
  assert.throws(() => dogrula(g, BUGUN), /vakit sırası bozuk: 2026-10-15/);
});

test('dogrula: bozuk saat, bozuk tarih ve 7 günden az gün hata verir', () => {
  const g = gunler('2026-10-12', 20);
  g[1] = gun(g[1].tarih, { gunes: '7:24' });
  assert.throws(() => dogrula(g, BUGUN), /geçersiz gunes \(2026-10-13\): 7:24/);
  const h = gunler('2026-10-12', 20);
  h[0] = gun('12.10.2026');
  assert.throws(() => dogrula(h, BUGUN), /geçersiz tarih: 12\.10\.2026/);
  assert.throws(() => dogrula(gunler('2026-10-13', 6), BUGUN), /yetersiz gün sayısı \(6\)/);
  assert.throws(() => dogrula(null, BUGUN), /yetersiz gün sayısı \(0\)/);
});

test('birlestir: taze kazanır, düzeltme sayılır, dünden eski düşer, eldeki ileri günler korunur', (t) => {
  t.mock.method(console, 'warn', () => {});
  const eldeki = gunler('2026-09-14', 30); // 14 Eyl → 13 Eki
  const taze = gunler('2026-10-08', 10);   // 8 Eki → 17 Eki; 13 Eki'nin ikindisi düzeltilmiş
  taze[5] = gun('2026-10-13', { ikindi: '16:50' });
  const s = birlestir(eldeki, taze, BUGUN);
  assert.equal(s.duzeltme, 1);
  // eldeki 13 Eki'ye kadar; taze 17 Eki'ye kadar → 14..17 Eki yeni (4 gün). 8–11 Eki dünden eski olduğu için sayılmaz.
  assert.equal(s.yeni, 4);
  assert.equal(s.gunler[0].tarih, '2026-10-12'); // dün
  assert.equal(s.gunler.at(-1).tarih, '2026-10-17');
  assert.ok(!s.gunler.some((g) => g.tarih < '2026-10-12'));
  assert.equal(s.gunler.find((g) => g.tarih === '2026-10-13').ikindi, '16:50');
});

test('birlestir: taze veri kısaysa eldeki ileri günler korunur', () => {
  const eldeki = gunler('2026-10-12', 40);   // 12 Eki → 20 Kas
  const taze = gunler('2026-10-12', 5);
  const s = birlestir(eldeki, taze, BUGUN);
  assert.equal(s.gunler.at(-1).tarih, '2026-11-20');
  assert.equal(s.gunler.length, 40);
  assert.equal(s.duzeltme, 0);
  assert.equal(s.yeni, 0);
});

test('birlestir: taban yoksa (null/boş) yalnız taze günler, dünden itibaren', () => {
  const taze = gunler('2026-10-01', 20);
  for (const taban of [null, undefined, []]) {
    const s = birlestir(taban, taze, BUGUN);
    assert.equal(s.gunler[0].tarih, '2026-10-12');
    assert.equal(s.gunler.at(-1).tarih, '2026-10-20');
    assert.equal(s.yeni, 9);
  }
});

test('kalanGun: bugünden başlayan kesintisiz dizinin son gününe kadar gün sayısı', () => {
  assert.equal(kalanGun(gunler('2026-10-13', 10), BUGUN), 9);
  // boşluklu dizi: boşluktan öncesi sayılır
  const g = gunler('2026-10-13', 10).filter((x) => x.tarih !== '2026-10-18');
  assert.equal(kalanGun(g, BUGUN), 4);
  // bugün yoksa null
  assert.equal(kalanGun(gunler('2026-10-14', 10), BUGUN), null);
});
