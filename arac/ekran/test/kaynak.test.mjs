// kaynak.mjs testleri — ekran-kaynak.json (sitenin sabitlenmiş commit'i) okuyucusu.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { kaynakOku } from '../kaynak.mjs';

const REPO = 'ulucamii2026/ulucamii2026.github.io';
const SHA = '0123456789abcdef0123456789abcdef01234567';
const KAYNAK_MJS = fileURLToPath(new URL('../kaynak.mjs', import.meta.url));
const dosya = (ek = {}) => JSON.stringify({ surum: 1, repo: REPO, sha: '', ...ek });

const gecici = [];
after(() => { for (const d of gecici) rmSync(d, { recursive: true, force: true }); });
const geciciDosya = (icerik) => {
  const d = mkdtempSync(join(tmpdir(), 'ekran-kaynak-'));
  gecici.push(d);
  const y = join(d, 'ekran-kaynak.json');
  writeFileSync(y, icerik);
  return y;
};

test('boş sha: sabitlenmedi, hazir false (hata değil)', () => {
  assert.deepEqual(kaynakOku(dosya()), { hazir: false, repo: REPO, sha: '' });
});

test('40 haneli onaltılık sha: hazir true', () => {
  assert.deepEqual(kaynakOku(dosya({ sha: SHA })), { hazir: true, repo: REPO, sha: SHA });
});

test('başka depo, yanlış sürüm ve biçimsiz sha Error verir', () => {
  assert.throws(() => kaynakOku(dosya({ repo: 'baska/depo' })), /repo/);
  assert.throws(() => kaynakOku(dosya({ repo: undefined })), /repo/);
  assert.throws(() => kaynakOku(dosya({ surum: 2 })), /surum/);
  assert.throws(() => kaynakOku(dosya({ surum: undefined })), /surum/);
  assert.throws(() => kaynakOku(dosya({ sha: 'zzz' })), /sha/);
  assert.throws(() => kaynakOku(dosya({ sha: SHA.slice(1) })), /sha/);
  assert.throws(() => kaynakOku(dosya({ sha: SHA + '0' })), /sha/);
  assert.throws(() => kaynakOku(dosya({ sha: SHA.toUpperCase() })), /sha/);
  assert.throws(() => kaynakOku(dosya({ sha: ' ' })), /sha/);
  assert.throws(() => kaynakOku(dosya({ sha: 123 })), /sha/);
  assert.throws(() => kaynakOku(dosya({ sha: null })), /sha/);
  assert.throws(() => kaynakOku(dosya({ sha: undefined })), /sha/);
  assert.throws(() => kaynakOku(dosya({ sha: 'main' })), /sha/);
});

test('bozuk JSON ve nesne olmayan gövde Error verir', () => {
  assert.throws(() => kaynakOku('{bozuk'), /bozuk/);
  assert.throws(() => kaynakOku('[]'), /nesne/);
  assert.throws(() => kaynakOku('null'), /nesne/);
  assert.throws(() => kaynakOku(''), /bozuk/);
});

test('depodaki ekran-kaynak.json geçerlidir ve doğru depoyu gösterir', () => {
  const k = kaynakOku(readFileSync(new URL('../../../ekran-kaynak.json', import.meta.url), 'utf8'));
  assert.equal(k.repo, REPO);
  assert.equal(k.hazir, k.sha !== '');
});

test('CLI: sabitlenmemişse hazir=0, sabitliyse hazir=1; satırlar GITHUB_OUTPUT biçimindedir', () => {
  const bos = spawnSync(process.execPath, [KAYNAK_MJS, '--dosya', geciciDosya(dosya())], { encoding: 'utf8' });
  assert.equal(bos.status, 0, bos.stderr);
  assert.equal(bos.stdout, `hazir=0\nrepo=${REPO}\nsha=\n`);
  const dolu = spawnSync(process.execPath, [KAYNAK_MJS, '--dosya', geciciDosya(dosya({ sha: SHA }))], { encoding: 'utf8' });
  assert.equal(dolu.status, 0, dolu.stderr);
  assert.equal(dolu.stdout, `hazir=1\nrepo=${REPO}\nsha=${SHA}\n`);
});

test('CLI: dosya verilmezse depodaki ekran-kaynak.json okunur', () => {
  const r = spawnSync(process.execPath, [KAYNAK_MJS], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^hazir=[01]\nrepo=ulucamii2026\/ulucamii2026\.github\.io\nsha=[0-9a-f]{0,40}\n$/);
});

test('CLI: bozukluk 1 ile çıkar ve çıktıya hiçbir satır yazmaz (GITHUB_OUTPUT kirlenmez)', () => {
  for (const icerik of [dosya({ repo: 'baska/depo' }), dosya({ sha: 'zzz' }), '{bozuk']) {
    const r = spawnSync(process.execPath, [KAYNAK_MJS, '--dosya', geciciDosya(icerik)], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.notEqual(r.stderr, '');
  }
  const yok = spawnSync(process.execPath, [KAYNAK_MJS, '--dosya', join(tmpdir(), 'yok-boyle-bir-dosya.json')], { encoding: 'utf8' });
  assert.equal(yok.status, 1);
  assert.equal(yok.stdout, '');
});
