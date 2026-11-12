# K2C Management

PWA internal K2C Komputindo untuk penjualan toko, pesanan marketplace, stok per barang dan varian, serta pembelian.

## Menjalankan di Windows

Dari PowerShell di folder project, pakai Node.js 24 atau lebih baru.

```powershell
node server.mjs
```

Buka http://127.0.0.1:4173 dan pilih **Admin** atau **Teknisi**. Tombol **Ganti peran** mengembalikan aplikasi ke halaman pilihan. Riwayat mencatat peran yang dipilih.

Layar Teknisi memakai dua tab ponsel, **Shopee** dan **Tokopedia**. Angka pada tiap tab menunjukkan pesanan yang masih memerlukan tindakan. Admin dapat mencatat pesanan marketplace baru dari kedua kanal tersebut.

## Alur operasional

1. Tambahkan barang dan varian. Isi stok awal bila barang sudah ada, lalu catat barang masuk berikutnya dari **Pembelian**.
2. Transaksi toko mengurangi stok saat disimpan. Pesanan marketplace menahan stok, kemudian mencatat barang keluar saat paket diserahkan ke kurir atau gerai.
3. Teknisi membuka kamera dari pesanan, merekam dan meninjau video tes MP4, lalu menyimpannya. Kamera memerlukan izin browser dan browser yang mendukung rekaman MP4. Tim pengiriman mengisi resi dan mengunggah foto serah terima.
4. Saat paket kembali, catat penerimaan dan unggah dua foto paket serta satu video unboxing. Hanya jumlah yang lolos pemeriksaan ditambahkan ke stok siap jual.
5. Admin mencatat potongan dan dana yang cair dari marketplace. Nominal jual dan modal saat transaksi tersimpan di riwayat.

Pesanan PC rakitan dapat memakai stok unit siap jual atau memakai komponen yang dicatat oleh teknisi. Pembatalan melepas stok tertahan. Rakitan yang sudah dibuat bisa dibongkar untuk mengembalikan komponen, atau masuk stok barang jadi setelah tes.

## Pemakaian tim

Server lokal menerima koneksi loopback secara default. Siapa pun yang bisa membuka aplikasi dapat memilih Admin. Untuk penggunaan lintas perangkat, batasi akses di jaringan privat atau melalui gateway yang memverifikasi pengguna. HTTPS diperlukan untuk pemasangan PWA dari ponsel. Atur `K2C_ORIGIN` ke alamat HTTPS dan `K2C_SECURE_COOKIE=1` saat memakai reverse proxy HTTPS. Pencatatan dan pengunggahan memerlukan koneksi ke server, termasuk untuk transaksi penjualan di toko.

Database dan bukti pesanan disimpan bersama di `data/k2c.sqlite`. Untuk backup sederhana, hentikan server dan salin seluruh folder `data` (atau direktori dari `K2C_DATA_DIR`) sebelum menjalankan server lagi. File bukti disimpan dengan batas total 120 MB per pengiriman formulir. Aplikasi mencatat marketplace secara manual sesuai alur kerja admin.

## Deploy cloud di Vercel

Impor repo ke Vercel dengan preset **Other** dan Output Directory `public` (sudah didefinisikan di `vercel.json`). Terapkan `supabase/setup.sql` satu kali pada project Supabase khusus K2C. Masukkan variabel berikut di Vercel, lalu deploy ulang setelah menyimpannya.

| Variabel | Isi |
|---|---|
| `SUPABASE_URL` | URL project Supabase |
| `SUPABASE_SECRET_KEY` | Secret key server-side dari pengaturan API keys Supabase |
| `K2C_CLOUD_ACCESS_KEY` | Nilai acak setidaknya 32 karakter. Gunakan karakter alfanumerik atau hex |

Buka aplikasi melalui `https://alamat-vercel/#access=NILAI_K2C_CLOUD_ACCESS_KEY`. Kirim tautan ini hanya kepada tim yang boleh mengakses K2C. Setelah tautan dibuka, layar pertama tetap menampilkan **Admin** dan **Teknisi**. Kedua peran dapat dipilih oleh siapa pun yang menerima tautan. Rotasi kunci memutus sesi cloud yang sudah ada.

Bukti disimpan langsung dari browser ke bucket privat Supabase dengan batas 45 MB per file. Database cloud baru kosong. Data yang sebelumnya dicatat di SQLite tetap di perangkat lokal sampai ada migrasi data.
