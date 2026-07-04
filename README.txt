STOK JALUR PWA UNIVERSAL
========================

Tujuan:
- User buka link PWA biasa dari HP/laptop, bukan link script.google.com.
- Search tetap cepat karena data dari WEB_STOK_JALUR_INDEX dan WEB_STOK_JALUR_BATCH.
- Apps Script tetap menjadi mesin baca spreadsheet/cache.
- Vercel API dipakai sebagai proxy supaya PWA tidak kena masalah CORS/redirect Apps Script di browser HP.

ISI PAKET
---------
1. apps-script-api/Code.gs
   Paste ke Apps Script spreadsheet CENTER / cache.

2. index.html, styles.css, app.js, manifest.json, sw.js, public/icons
   File PWA untuk upload ke GitHub/Vercel.

3. api/stok.js
   API proxy Vercel. PWA memanggil /api/stok, lalu Vercel meneruskan ke Apps Script.

4. package.json, vercel.json
   Konfigurasi deploy Vercel.

LANGKAH A — APPS SCRIPT API
---------------------------
1. Buka spreadsheet CENTER / cache.
2. Extensions > Apps Script.
3. Paste apps-script-api/Code.gs ke Code.gs.
4. Cek CONFIG.CACHE_SPREADSHEET_ID:
   - Isi dengan ID spreadsheet CENTER / cache.
5. Cek CONFIG.SPREADSHEETS:
   - 1111, 1112, 1113 isi ID file stok jalur asli.
6. Save.
7. Run function:
   setupStokJalurOnline
8. Run salah satu dulu untuk test:
   rebuildPlant1112
9. Jika sukses, run:
   rebuildPlant1111
   rebuildPlant1113
10. Deploy > New deployment > Web app:
    Execute as: Me
    Who has access: Anyone
11. Copy Web app URL hasil deploy.
12. Tes URL API di browser dengan menambahkan:
    ?action=health
    Harus keluar JSON ok true.

LANGKAH B — DEPLOY PWA KE VERCEL
--------------------------------
1. Buat repo GitHub baru, contoh: stok-jalur-pwa.
2. Upload semua file di folder utama paket ini, KECUALI folder apps-script-api boleh tetap ada sebagai backup.
3. Buka Vercel > Add New Project > Import repo GitHub.
4. Di Project Settings > Environment Variables, tambahkan:
   Name : GAS_WEB_APP_URL
   Value: URL Web App Apps Script dari Langkah A
5. Deploy.
6. Buka link Vercel dari HP.
7. Di Chrome Android, menu titik tiga > Add to Home screen / Install app.

KENAPA MODEL INI LEBIH MUDAH DIBUKA DI HP?
------------------------------------------
- User membuka domain web biasa dari Vercel, bukan script.google.com.
- Tidak perlu login Google untuk user pencarian.
- PWA punya manifest dan service worker, sehingga bisa diinstall ke layar utama.
- Data index tersimpan lokal di HP sebagai cache cadangan.

CATATAN PENTING
---------------
- Jangan bagikan URL Apps Script API langsung ke user umum. Bagikan URL Vercel/PWA.
- Kalau data tidak muncul, cek Environment Variable GAS_WEB_APP_URL di Vercel.
- Kalau muncul error response bukan JSON, cek Deploy Apps Script harus:
  Execute as: Me
  Who has access: Anyone
- Kalau update index berat, gunakan trigger round-robin 15 menit:
  setupAutoRefresh15Menit

PIN DEFAULT UPDATE INDEX
------------------------
222

Untuk ganti PIN, ubah di apps-script-api/Code.gs:
ADMIN_REFRESH_PIN: '222'
