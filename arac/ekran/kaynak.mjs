// ekran-kaynak.json okuyucusu: platform sayfalarının derlendiği SİTE commit'i.
// Şema: { "surum": 1, "repo": "ulucamii2026/ulucamii2026.github.io", "sha": "<40 küçük onaltılık hane>" }
// Boş `sha` = henüz sabitlenmedi → hazir=false (iş akışı yeşil bir no-op olur, hiçbir şey yayınlanmaz).
// Başka sürüm, başka depo ya da biçimsiz sha → Error (iş akışı kırmızı olur; çıktıya hiçbir satır yazılmaz).
//
// CLI: node arac/ekran/kaynak.mjs [--dosya <yol>] >> "$GITHUB_OUTPUT"   → hazir=0|1, repo=…, sha=… satırları
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Yalnız dernek sitesinin deposu: başka depodan kod derlenmez. */
const SITE_DEPOSU = 'ulucamii2026/ulucamii2026.github.io';
const SHA = /^[0-9a-f]{40}$/;

/** ekran-kaynak.json metnini ayrıştırır ve doğrular. */
export function kaynakOku(metin) {
  let j;
  try { j = JSON.parse(metin); } catch (e) { throw new Error('ekran-kaynak.json bozuk: ' + e.message); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('ekran-kaynak.json: nesne bekleniyor');
  if (j.surum !== 1) throw new Error(`ekran-kaynak.json: surum 1 bekleniyor (${String(j.surum)})`);
  if (j.repo !== SITE_DEPOSU) throw new Error(`ekran-kaynak.json: repo ${SITE_DEPOSU} olmalı (${String(j.repo)})`);
  if (j.sha === '') return { hazir: false, repo: j.repo, sha: '' };
  if (typeof j.sha !== 'string' || !SHA.test(j.sha)) throw new Error('ekran-kaynak.json: sha boş ya da 40 küçük onaltılık hane olmalı');
  return { hazir: true, repo: j.repo, sha: j.sha };
}

function cli(argv) {
  try {
    let yol = fileURLToPath(new URL('../../ekran-kaynak.json', import.meta.url));
    if (argv.length > 0) {
      if (argv.length !== 2 || argv[0] !== '--dosya') throw new Error('kullanım: node arac/ekran/kaynak.mjs [--dosya <yol>]');
      yol = argv[1];
    }
    let govde;
    try { govde = readFileSync(yol, 'utf8'); } catch { throw new Error('ekran-kaynak.json okunamadı'); }
    const k = kaynakOku(govde);
    // Doğrulama bitmeden hiçbir satır basılmaz (GITHUB_OUTPUT'a yarım çıktı gitmesin).
    process.stdout.write(`hazir=${k.hazir ? 1 : 0}\nrepo=${k.repo}\nsha=${k.sha}\n`);
    return 0;
  } catch (e) {
    console.error(`kaynak: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  process.exitCode = cli(process.argv.slice(2));
}
