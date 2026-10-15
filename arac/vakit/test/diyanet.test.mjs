// diyanet.mjs testleri — ağsız: sahte `getir` ve anında dönen `bekle` ile.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resmiAdres, aynaAdres, resmiSayfayiAyristir, resmiSayfaIlceAdi, ilceAdiNorm, aynaDonustur, cek } from '../diyanet.mjs';

const fikstur = (ad) => readFileSync(new URL(`./fikstur/${ad}`, import.meta.url), 'utf8');
const RESMI_HTML = fikstur('resmi-11890.html');
const AYNA_JSON = fikstur('ayna-11890.json');

// console.warn gürültüsünü sustur
const sustur = (t) => t.mock.method(console, 'warn', () => {});

const yanit = (govde, durum = 200, url) => ({ ok: durum >= 200 && durum < 300, status: durum, url, text: async () => govde, json: async () => JSON.parse(govde) });
const resetHata = () => Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });

test('adresler ilçe ve slug ile kurulur', () => {
  assert.equal(resmiAdres('11890', 'mfamenne'), 'https://namazvakitleri.diyanet.gov.tr/tr-TR/11890/mfamenne-namaz-vakitleri');
  assert.equal(aynaAdres('11890'), 'https://ezanvakti.emushaf.net/vakitler/11890');
});

test('resmî sayfa fikstüründen 10 gün ayrıştırılır; bozuk ay satırı atlanır, &nbsp; çözülür', () => {
  const g = resmiSayfayiAyristir(RESMI_HTML);
  assert.equal(g.length, 10);
  assert.deepEqual(g[0], { tarih: '2026-10-13', hicri: '2 Cemaziyelevvel 1448', imsak: '06:09', gunes: '07:50', ogle: '13:30', ikindi: '16:22', aksam: '19:00', yatsi: '20:28' });
  // bozuk ay adlı satır (23 Ekimm) hiç yok; başlık (<th>) satırı da yok
  assert.ok(!g.some((x) => x.tarih === '2026-10-23'));
  // &nbsp; içeren satır doğru çözülür
  assert.deepEqual(g[1], { tarih: '2026-10-14', hicri: '3 Cemaziyelevvel 1448', imsak: '06:11', gunes: '07:52', ogle: '13:30', ikindi: '16:20', aksam: '18:58', yatsi: '20:26' });
  // tarihe göre sıralı
  assert.deepEqual(g.map((x) => x.tarih), [...g.map((x) => x.tarih)].sort());
  assert.equal(g.at(-1).tarih, '2026-10-22');
});

test('resmî sayfa ayrıştırıcısı varlıkları çözer ve tekrar eden tarihte sonuncuyu tutar', () => {
  const html = '<tr><td>5&#32;Ocak 2027 Salı</td><td>1 Receb 1448</td><td>06:00</td><td>08:00</td><td>13:00</td><td>15:00</td><td>17:00</td><td>19:00</td></tr>'
    + '<tr><td>5 Ocak 2027 Salı</td><td>1 Receb 1448</td><td>06:01</td><td>08:00</td><td>13:00</td><td>15:00</td><td>17:00</td><td>19:00</td></tr>';
  const g = resmiSayfayiAyristir(html);
  assert.equal(g.length, 1);
  assert.equal(g[0].tarih, '2027-01-05');
  assert.equal(g[0].imsak, '06:01');
});

test('ayna fikstüründen en az 7 gün dönüşür; tarih biçimi YYYY-AA-GG', () => {
  const g = JSON.parse(AYNA_JSON).map(aynaDonustur);
  assert.ok(g.length >= 7);
  for (const x of g) assert.match(x.tarih, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(g[0], { tarih: '2026-10-08', hicri: '27 Rebiulahir 1448', imsak: '06:01', gunes: '07:42', ogle: '13:31', ikindi: '16:30', aksam: '19:11', yatsi: '20:39' });
});

test('cek: resmî sayfa 200 ise resmî sayfa kullanılır', async (t) => {
  sustur(t);
  // 7 günden az ayrıştırılırsa resmî kabul edilmez; fikstürde 10 gün var
  const istekler = [];
  const getir = async (url) => { istekler.push(url); return yanit(RESMI_HTML); };
  const s = await cek({ ilce: '11890', slug: 'mfamenne' }, { getir, bekle: async () => {} });
  assert.equal(s.kaynakAdi, 'resmî sayfa');
  assert.equal(s.kaynakUc, 'https://namazvakitleri.diyanet.gov.tr/tr-TR/11890/mfamenne-namaz-vakitleri');
  assert.equal(s.gunler.length, 10);
  assert.deepEqual(istekler, [s.kaynakUc]);
});

test('cek: resmî 3 kez ECONNRESET verirse aynaya düşer', async (t) => {
  sustur(t);
  const istekler = [];
  const beklemeler = [];
  const getir = async (url) => {
    istekler.push(url);
    if (url.includes('namazvakitleri.diyanet.gov.tr')) throw resetHata();
    return yanit(AYNA_JSON);
  };
  const s = await cek({ ilce: '11890', slug: 'mfamenne' }, { getir, bekle: async (ms) => { beklemeler.push(ms); } });
  assert.equal(s.kaynakAdi, 'ayna');
  assert.equal(s.kaynakUc, 'https://ezanvakti.emushaf.net/vakitler/11890');
  assert.equal(s.gunler.length, 32);
  assert.equal(s.gunler[0].tarih, '2026-10-08');
  assert.equal(istekler.filter((u) => u.includes('namazvakitleri')).length, 3);
  assert.deepEqual(beklemeler, [10000, 30000]); // resmî aralıkları
});

test('cek: resmî sayfa 7 günden az ayrıştırılırsa ya da HTTP hatası verirse aynaya düşer', async (t) => {
  sustur(t);
  for (const resmiYanit of [yanit('<html>bos</html>'), yanit('', 403)]) {
    const getir = async (url) => (url.includes('namazvakitleri') ? resmiYanit : yanit(AYNA_JSON));
    const s = await cek({ ilce: '11890', slug: 'mfamenne' }, { getir, bekle: async () => {} });
    assert.equal(s.kaynakAdi, 'ayna');
  }
});

test('cek: ayna beklenmeyen gövde verirse (dizi değil / 7 günden az) hata sayılır', async (t) => {
  sustur(t);
  const getir = async (url) => (url.includes('namazvakitleri') ? yanit('', 500) : yanit('{"hata":1}'));
  await assert.rejects(cek({ ilce: '11890', slug: 'mfamenne' }, { getir, bekle: async () => {} }), /alınamadı/);
});

test('cek: ikisi de başarısızsa hata iki kaynağı da adlandırır; ayna aralıkları 10 sn / 30 sn / 60 sn', async (t) => {
  sustur(t);
  const beklemeler = [];
  const getir = async (url) => {
    if (url.includes('namazvakitleri')) throw resetHata();
    return yanit('', 403);
  };
  await assert.rejects(
    cek({ ilce: '11890', slug: 'mfamenne' }, { getir, bekle: async (ms) => { beklemeler.push(ms); } }),
    (e) => /^Diyanet vakitleri hiçbir kaynaktan alınamadı — resmî: .*ECONNRESET.* · ayna: HTTP 403$/.test(e.message),
  );
  assert.deepEqual(beklemeler, [10000, 30000, 10000, 30000, 60000]);
});

test('cek: kaynak adresi ilçe ve slug parametresinden gelir', async (t) => {
  sustur(t);
  const istekler = [];
  const getir = async (url) => { istekler.push(url); throw resetHata(); };
  await assert.rejects(cek({ ilce: '12345', slug: 'ornek' }, { getir, bekle: async () => {} }));
  assert.ok(istekler.includes('https://namazvakitleri.diyanet.gov.tr/tr-TR/12345/ornek-namaz-vakitleri'));
  assert.ok(istekler.includes('https://ezanvakti.emushaf.net/vakitler/12345'));
});

// ---- ilçe adı kapısı (resmî sayfa başlığı)
const GERCEK_HTML = fikstur('resmi-11890-gercek.html');

test('resmiSayfaIlceAdi: gerçek sayfa M.famenne verir; Aylık/Yıllık başlıkları da kabul edilir; ilk eşleşme kazanır', () => {
  assert.equal(resmiSayfaIlceAdi(GERCEK_HTML), 'M.famenne');
  assert.equal(resmiSayfaIlceAdi(RESMI_HTML), 'M.famenne');
  assert.equal(resmiSayfaIlceAdi('<caption><h3 class="h4">Liège İçin Aylık Namaz Vakitleri</h3></caption>'), 'Liège');
  assert.equal(resmiSayfaIlceAdi('<caption id="x"><h3>Namur İçin Yıllık Namaz Vakti</h3></caption>'), 'Namur');
  assert.equal(resmiSayfaIlceAdi('<caption>A İçin Haftalık Namaz Vakitleri</caption><caption>B İçin Aylık Namaz Vakitleri</caption>'), 'A');
  assert.equal(resmiSayfaIlceAdi('<html><body>başlık yok</body></html>'), null);
  assert.equal(resmiSayfaIlceAdi('<caption>Başka bir tablo</caption>'), null);
});

test('ilceAdiNorm: büyük/küçük harf, aksan ve İ/ı farkı yok sayılır', () => {
  assert.equal(ilceAdiNorm('M.famenne'), ilceAdiNorm('M.FAMENNE'));
  assert.equal(ilceAdiNorm('Liège'), 'LIEGE');
  assert.equal(ilceAdiNorm('İzmir'), 'IZMIR');
  assert.equal(ilceAdiNorm(' Namur '), 'NAMUR');
  assert.notEqual(ilceAdiNorm('Liege'), ilceAdiNorm('M.FAMENNE'));
});

test('cek: ilceAdi verilmişse gerçek resmî sayfa başlığı eşleşince resmî sayfa kullanılır', async (t) => {
  sustur(t);
  const getir = async (url) => (url.includes('namazvakitleri') ? yanit(GERCEK_HTML) : yanit(AYNA_JSON));
  const s = await cek({ ilce: '11890', slug: 'mfamenne', ilceAdi: 'M.FAMENNE' }, { getir, bekle: async () => {} });
  assert.equal(s.kaynakAdi, 'resmî sayfa');
  assert.equal(s.gunler.length, 61);
});

test('cek: başlıktaki ilçe farklıysa hata (yeniden denenmez, aynaya da geçilmez: ayna aynı ilçe numarasını kullanır)', async (t) => {
  sustur(t);
  const yanlis = GERCEK_HTML.replace(/M\.famenne İçin Haftalık/, 'Liege İçin Haftalık');
  assert.notEqual(yanlis, GERCEK_HTML);
  const istekler = [];
  const beklemeler = [];
  const getir = async (url) => { istekler.push(url); return url.includes('namazvakitleri') ? yanit(yanlis) : yanit(AYNA_JSON); };
  await assert.rejects(
    cek({ ilce: '11890', slug: 'mfamenne', ilceAdi: 'M.FAMENNE' }, { getir, bekle: async (ms) => { beklemeler.push(ms); } }),
    /başka ilçeye ait: "Liege"/,
  );
  assert.equal(istekler.filter((u) => u.includes('namazvakitleri')).length, 1);
  assert.equal(istekler.filter((u) => u.includes('emushaf')).length, 0);
  assert.deepEqual(beklemeler, []);
});

test('cek: başlıksız resmî sayfa ilceAdi verilmişse reddedilir; verilmemişse kabul edilir', async (t) => {
  sustur(t);
  const basliksiz = RESMI_HTML.replace(/<caption>.*<\/caption>\n/, '');
  assert.ok(!basliksiz.includes('<caption>'));
  const getir = async (url) => (url.includes('namazvakitleri') ? yanit(basliksiz) : yanit(AYNA_JSON));
  const reddedildi = await cek({ ilce: '11890', slug: 'mfamenne', ilceAdi: 'M.FAMENNE' }, { getir, bekle: async () => {} });
  assert.equal(reddedildi.kaynakAdi, 'ayna');
  const kabul = await cek({ ilce: '11890', slug: 'mfamenne' }, { getir, bekle: async () => {} });
  assert.equal(kabul.kaynakAdi, 'resmî sayfa');
});

test('cek: ilçe adı kapısı aynaya uygulanmaz (ayna başlık taşımaz)', async (t) => {
  sustur(t);
  const getir = async (url) => { if (url.includes('namazvakitleri')) throw resetHata(); return yanit(AYNA_JSON); };
  const s = await cek({ ilce: '11890', slug: 'mfamenne', ilceAdi: 'BASKA' }, { getir, bekle: async () => {} });
  assert.equal(s.kaynakAdi, 'ayna');
});

// ---- yönlendirme denetimi
test('cek: yanıtın son adresi izinli alan dışındaysa ya da https değilse başarısız sayılır', async (t) => {
  sustur(t);
  for (const sonAdres of ['https://evil.test/x', 'http://namazvakitleri.diyanet.gov.tr/x', 'https://namazvakitleri.diyanet.gov.tr.evil.test/x']) {
    const getir = async (url) => (url.includes('namazvakitleri') ? yanit(RESMI_HTML, 200, sonAdres) : yanit(AYNA_JSON));
    const s = await cek({ ilce: '11890', slug: 'mfamenne' }, { getir, bekle: async () => {} });
    assert.equal(s.kaynakAdi, 'ayna', sonAdres);
  }
  // ayna da yönlendirilirse ikisi de başarısız
  const getir = async (url) => yanit(url.includes('namazvakitleri') ? RESMI_HTML : AYNA_JSON, 200, 'https://evil.test/y');
  await assert.rejects(cek({ ilce: '11890', slug: 'mfamenne' }, { getir, bekle: async () => {} }), /alınamadı/);
});

test('cek: son adres boşsa ya da izinli alandaysa kabul edilir', async (t) => {
  sustur(t);
  for (const sonAdres of [undefined, '', 'https://namazvakitleri.diyanet.gov.tr/tr-TR/11890/mfamenne-namaz-vakitleri']) {
    const s = await cek({ ilce: '11890', slug: 'mfamenne' }, { getir: async () => yanit(RESMI_HTML, 200, sonAdres), bekle: async () => {} });
    assert.equal(s.kaynakAdi, 'resmî sayfa');
  }
});

// ---- F1: son adresin yolu da istenen ilçeyi göstermeli
test('cek: ayna başka ilçeye yönlenirse reddedilir (11890 istenirken /vakitler/9999)', async (t) => {
  sustur(t);
  const getir = async (url) => {
    if (url.includes('namazvakitleri')) return yanit('', 500);
    return yanit(AYNA_JSON, 200, 'https://ezanvakti.emushaf.net/vakitler/9999');
  };
  await assert.rejects(
    cek({ ilce: '11890', slug: 'mfamenne' }, { getir, bekle: async () => {} }),
    (e) => /başka ilçeye yönlendirildi.*beklenen: "11890".*bulunan: "9999"/s.test(e.message),
  );
});

test('cek: resmî sayfa başka ilçenin yoluna yönlenirse resmî sayfa sayılmaz (ayna kullanılır)', async (t) => {
  sustur(t);
  const getir = async (url) => {
    if (url.includes('namazvakitleri')) return yanit(RESMI_HTML, 200, 'https://namazvakitleri.diyanet.gov.tr/tr-TR/9999/baska-namaz-vakitleri');
    return yanit(AYNA_JSON, 200, 'https://ezanvakti.emushaf.net/vakitler/11890');
  };
  const s = await cek({ ilce: '11890', slug: 'mfamenne' }, { getir, bekle: async () => {} });
  assert.equal(s.kaynakAdi, 'ayna');
});

test('cek: resmî sayfada yalnız slug farklıysa da reddedilir', async (t) => {
  sustur(t);
  const getir = async (url) => {
    if (url.includes('namazvakitleri')) return yanit(RESMI_HTML, 200, 'https://namazvakitleri.diyanet.gov.tr/tr-TR/11890/baska-namaz-vakitleri');
    return yanit(AYNA_JSON, 200, 'https://ezanvakti.emushaf.net/vakitler/11890');
  };
  const s = await cek({ ilce: '11890', slug: 'mfamenne' }, { getir, bekle: async () => {} });
  assert.equal(s.kaynakAdi, 'ayna');
});

test('cek: aynı yolun sondaki eğik çizgili son adresi kabul edilir; kaynakUc son adrestir', async (t) => {
  sustur(t);
  const resmiSon = 'https://namazvakitleri.diyanet.gov.tr/tr-TR/11890/mfamenne-namaz-vakitleri/';
  const r = await cek({ ilce: '11890', slug: 'mfamenne' }, { getir: async () => yanit(RESMI_HTML, 200, resmiSon), bekle: async () => {} });
  assert.equal(r.kaynakAdi, 'resmî sayfa');
  assert.equal(r.kaynakUc, resmiSon);
  const aynaSon = 'https://ezanvakti.emushaf.net/vakitler/11890/';
  const a = await cek(
    { ilce: '11890', slug: 'mfamenne' },
    { getir: async (url) => (url.includes('namazvakitleri') ? yanit('', 500) : yanit(AYNA_JSON, 200, aynaSon)), bekle: async () => {} },
  );
  assert.equal(a.kaynakAdi, 'ayna');
  assert.equal(a.kaynakUc, aynaSon);
});
