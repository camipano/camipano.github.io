// İlçe adı karşılaştırması (resmî sayfa başlığı ve Awqat CityDetail ortak kullanır).
/** Aksan, büyük/küçük harf ve İ/ı farkı yok sayılır ("M.famenne" ≡ "M.FAMENNE"). */
export const ilceAdiNorm = (s) => s.normalize('NFKD').replace(/\p{M}/gu, '').toUpperCase().trim();
