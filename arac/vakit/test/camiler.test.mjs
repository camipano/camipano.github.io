// camiler.mjs testleri — şema doğrulama.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { camilerOku } from '../camiler.mjs';

const cami = (ek = {}) => ({
  camiId: 'ornek-cami', adTr: 'Örnek Cami', adFr: 'Mosquée Exemple', ilce: '12345', ilceAdi: 'ORNEK', slug: 'ornek',
  saatDilimi: 'Europe/Brussels', konum: { enlem: 50.1, boylam: 5.2 }, cumaSaati: '', ...ek,
});
const dosya = (camiler, surum = 1) => JSON.stringify({ surum, camiler });

test('depodaki camiler.json geçerlidir ve referans camiyi içerir', () => {
  const liste = camilerOku(readFileSync(new URL('../../../camiler.json', import.meta.url), 'utf8'));
  assert.equal(liste.length, 1);
  assert.equal(liste[0].camiId, 'ulucamii-marche');
  assert.equal(liste[0].ilce, '11890');
  assert.equal(liste[0].slug, 'mfamenne');
});

test('geçerli giriş okunur; cumaSaati dolu olabilir', () => {
  const l = camilerOku(dosya([cami(), cami({ camiId: 'baska-cami', cumaSaati: '13:05' })]));
  assert.equal(l.length, 2);
  assert.equal(l[1].cumaSaati, '13:05');
  assert.deepEqual(camilerOku(dosya([])), []);
});

test('bozuk JSON, yanlış sürüm ve dizi olmayan camiler hata verir', () => {
  assert.throws(() => camilerOku('{bozuk'), /bozuk/);
  assert.throws(() => camilerOku(dosya([cami()], 2)), /surum/);
  assert.throws(() => camilerOku('{"camiler":[]}'), /surum/);
  assert.throws(() => camilerOku('null'), /surum/);
  assert.throws(() => camilerOku('{"surum":1,"camiler":{}}'), /dizi/);
});

test('yinelenen camiId hata verir', () => {
  assert.throws(() => camilerOku(dosya([cami(), cami({ adTr: 'Başka' })])), /yinelenen camiId \(ornek-cami\)/);
});

test('alan kuralları: camiId, ilce, slug, saatDilimi, cumaSaati, konum', () => {
  for (const kotu of [
    { camiId: 'Ab' }, { camiId: 'ab' }, { camiId: '-abc' }, { camiId: 'ABC-def' }, { camiId: 'a'.repeat(41) },
    { ilce: '' }, { ilce: '1234567' }, { ilce: '12a45' }, { ilce: 11890 },
    { slug: '' }, { slug: 'Büyük' }, { slug: 'a b' }, { slug: 'a'.repeat(61) },
    { saatDilimi: 'Europe/Paris' }, { saatDilimi: undefined },
    { cumaSaati: '25:00' }, { cumaSaati: '1:05' }, { cumaSaati: undefined },
    { konum: undefined }, { konum: { enlem: '50', boylam: 5 } },
    { adTr: '' }, { adFr: undefined }, { ilceAdi: ' ' },
  ]) {
    assert.throws(() => camilerOku(dosya([cami(kotu)])), Error, JSON.stringify(kotu));
  }
  // sınırlar kabul edilir
  assert.doesNotThrow(() => camilerOku(dosya([cami({ camiId: 'abc' }), cami({ camiId: 'a' + 'b'.repeat(39) }), cami({ camiId: 'c' + '1'.repeat(2), ilce: '1' }), cami({ camiId: 'x-y-z', ilce: '123456' })])));
});

test('cami nesnesi olmayan eleman hata verir', () => {
  assert.throws(() => camilerOku(dosya([null])), /nesne değil/);
  assert.throws(() => camilerOku(dosya(['x'])), /nesne değil/);
});
