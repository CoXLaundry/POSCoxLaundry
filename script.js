const API_URL = 'https://script.google.com/macros/s/AKfycbxq3pGfjN4bLTZ9X-ZxoDdZNkI2goBWGC_3pkP6w0HdImBi5JVB0JnbvAEwm7-MIzZd/exec'; 

        // GANTI dengan nilai yang SAMA PERSIS dengan Script Property "API_TOKEN"
        // yang Anda set di Apps Script (Project Settings > Script Properties).
        // Lihat komentar di code.gs untuk cara membuatnya.
        const TOKEN = '5ea2a27c-c70a-4afd-9969-5e6a29e5d694';

        // ISI dengan URL tempat Anda meng-host file "lacak.html" (halaman
        // publik pelacakan pesanan untuk pelanggan), contoh:
        // 'https://nama-anda.github.io/cox-laundry/lacak.html'
        // Kosongkan ('') kalau belum di-deploy -- QR code di nota otomatis
        // tidak ditampilkan sampai ini diisi.
        const LACAK_URL = '';

        // ==========================================
        // KEAMANAN: escape HTML sebelum ditulis ke innerHTML
        // ==========================================
        // Data yang berasal dari input pengguna (nama pelanggan, keterangan
        // pengeluaran, nama layanan, username, dll) TIDAK PERNAH langsung
        // dimasukkan ke innerHTML tanpa lewat fungsi ini -- supaya kalau ada
        // yang mengetik tag HTML/script di salah satu field itu, ia tampil
        // sebagai teks biasa, bukan dieksekusi sebagai kode (mencegah XSS).
        function escapeHtml(val) {
            if (val === undefined || val === null) return '';
            return String(val)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        // ==========================================
        // HELPER: komunikasi ke Google Apps Script
        // ==========================================
        // Content-Type: text/plain (bukan application/json) supaya browser
        // TIDAK mengirim preflight OPTIONS (yang tidak didukung Apps Script
        // secara default) -> respons JSON dari server bisa dibaca oleh JS,
        // tidak lagi "fire-and-forget" seperti sebelumnya (mode:'no-cors').
        //
        // sessionToken & actor dilampirkan otomatis di sini (bukan di tiap
        // pemanggil) supaya konsisten: sessionToken dipakai server untuk
        // membuktikan role Admin pada aksi sensitif (lihat ADMIN_ONLY_ACTIONS
        // di code.gs), dan actor dipakai untuk catatan Log_Aktivitas.
        //
        // Kontrak respons backend: { "result": "success" | "error", "message"?: "..." }
        async function kirimKeApiScript(payload) {
            const payloadDenganToken = Object.assign({
                token: TOKEN,
                sessionToken: localStorage.getItem('cox_session') || '',
                actor: localStorage.getItem('cox_kasir') || 'Sistem'
            }, payload);
            const res = await fetch(API_URL, {
                method: 'POST',
                cache: 'no-cache',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payloadDenganToken)
            });
            if (!res.ok) throw new Error(`Server merespons status ${res.status}`);
            let hasil;
            try { hasil = await res.json(); } catch (e) { throw new Error('Respons server tidak valid.'); }
            if (hasil && hasil.result === 'error') throw new Error(hasil.message || 'Server menolak permintaan.');
            return hasil;
        }

        async function apiGet(sheetName) {
            const res = await fetch(`${API_URL}?sheetName=${encodeURIComponent(sheetName)}&token=${encodeURIComponent(TOKEN)}`);
            if (!res.ok) throw new Error(`Server merespons status ${res.status}`);
            let hasil;
            try { hasil = await res.json(); } catch (e) { throw new Error('Respons server tidak valid.'); }
            if (hasil && hasil.result === 'error') throw new Error(hasil.message || 'Server menolak permintaan.');
            return hasil;
        }
        // ==========================================

        // ==========================================
        // KONFIGURASI HAK AKSES (FLEXIBLE RBAC)
        // ==========================================
        const ROLE_PERMISSIONS = {
            'Admin': ['*'], 
            'Kasir': [
                'buat_pesanan', 
                'lihat_pesanan', 
                'sinkronisasi',
                'presensi'
                // Secara default Kasir TIDAK diberi akses ke data finansial
                // (Laporan, Kelola Layanan/harga, Pengeluaran, dan rekap
                // presensi SEMUA pegawai) -- ini melanjutkan pola yang sudah
                // ada di aplikasi ini sebelumnya (Kasir juga tidak melihat
                // kartu "Pendapatan Hari Ini" di Beranda).
                // Ingin Kasir bisa mencatat pengeluaran operasional harian?
                // Tambahkan 'pengeluaran' ke daftar ini.
                // Ingin Kasir bisa melihat tab Laporan? Tambahkan 'laporan'.
            ] 
        };

        function terapkanHakAksesRole() {
            let currentRole = localStorage.getItem('cox_role') || 'Kasir';
            if (currentRole.toLowerCase() === 'admin') {
                currentRole = 'Admin';
            }

            const restrictedElements = document.querySelectorAll('[data-feature]');
            
            restrictedElements.forEach(el => {
                const featureName = el.getAttribute('data-feature');
                let hasAccess = false;
                
                if (currentRole === 'Admin' || (ROLE_PERMISSIONS[currentRole] && ROLE_PERMISSIONS[currentRole].includes(featureName))) {
                    hasAccess = true;
                }
                
                if (!hasAccess) {
                    el.classList.add('hidden');
                } else {
                    el.classList.remove('hidden');
                }
            });
        }
        // ==========================================

        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const currentDateTimeString = `${year}-${month}-${day}T${hours}:${minutes}`;

        document.getElementById('tanggalHariIni').innerText = now.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        document.getElementById('inputTglMasuk').value = currentDateTimeString;

        let masterLayanan = [];
        let masterPelanggan = [];
        let masterPengguna = []; 
        let masterTransaksi = [];
        let masterPengeluaran = [];
        let masterPresensi = [];
        let masterTemplateWa = [];
        let masterTemplateToko = [];
        let keranjangItem = [];
        let kategoriAktif = 'Kiloan';
        let percobaanLogin = 0;
        let periodeLaporanAktif = 'harian';
        let waktuTerakhirAktif = Date.now();

        // ==========================================
        // TEMPLATE NOTA & WHATSAPP (dinamis)
        // ==========================================
        // Data placeholder yang tersedia di kedua jenis template. Dipakai
        // untuk render tombol "sisip placeholder" & untuk resolve nilainya.
        const DAFTAR_PLACEHOLDER_TEMPLATE = [
            { token: '[NAMA]', label: 'Nama' },
            { token: '[NOTA]', label: 'No. Invoice' },
            { token: '[TOTAL]', label: 'Total' },
            { token: '[TGL_MASUK]', label: 'Tgl Masuk' },
            { token: '[TGL_SELESAI]', label: 'Est. Selesai' },
            { token: '[LAYANAN]', label: 'Layanan' },
            { token: '[METODE]', label: 'Metode Bayar' },
            { token: '[POIN]', label: 'Poin' },
            { token: '[TOKO]', label: 'Nama Toko' },
            { token: '[ALAMAT]', label: 'Alamat Toko' }
        ];

        // Beberapa template WA siap pakai untuk situasi berbeda -- dipakai
        // sebagai TAMPILAN AWAL saja sebelum ada satu pun template yang
        // benar-benar tersimpan ke Sheet "Template_WA" (lihat
        // ambilDaftarTemplateWa()). Nama field sengaja disamakan dengan
        // nama kolom Sheet (ID_Template/Nama/Isi) supaya konsisten dengan
        // data yang datang dari server.
        const DEFAULT_WA_TEMPLATES = [
            { ID_Template: 'default_diterima', Nama: 'Pesanan Diterima', Isi: 'Halo *[NAMA]*, pesanan laundry Anda (No. Nota *[NOTA]*) sudah kami terima.\nLayanan: [LAYANAN]\nEstimasi selesai: [TGL_SELESAI]\nTotal: *[TOTAL]*\nTerima kasih!' },
            { ID_Template: 'default_selesai', Nama: 'Notifikasi Selesai', Isi: 'Halo *[NAMA]*, pesanan laundry Anda dengan No. Nota *[NOTA]* sudah selesai dan siap diambil. Total tagihan: *[TOTAL]*. Terima kasih!' },
            { ID_Template: 'default_reminder', Nama: 'Reminder Belum Diambil', Isi: 'Halo *[NAMA]*, mengingatkan pesanan laundry Anda (No. Nota *[NOTA]*) sudah selesai sejak [TGL_SELESAI] dan belum diambil ya. Ditunggu kedatangannya, terima kasih!' },
            { ID_Template: 'default_terimakasih', Nama: 'Ucapan Terima Kasih', Isi: 'Terima kasih *[NAMA]* sudah menggunakan layanan kami! Poin Anda sekarang: *[POIN]*. Sampai jumpa lagi 🙏' }
        ];

        // Susunan nota bawaan -- baris diawali "^^" dirender rata tengah,
        // dibungkus "**...**" dirender tebal. Lihat parseBarisNota(). Pesan
        // penutup langsung ditulis sebagai teks biasa di baris terakhir
        // (bukan placeholder terpisah lagi) -- tinggal diedit langsung di
        // sini kalau mau diganti.
        const DEFAULT_NOTA_TEMPLATE = "^^**[TOKO]**\n^^[ALAMAT]\n--------------------------------\nInv  : [NOTA]\nNama : [NAMA]\nMasuk: [TGL_MASUK]\nSelesai (Est): [TGL_SELESAI]\n--------------------------------\nLayanan:\n[LAYANAN]\n--------------------------------\n**TOTAL: [TOTAL]**\nBayar: [METODE]\n--------------------------------\nPoin Anda: [POIN]\n\n^^Terima kasih telah mempercayakan cucian Anda";

        // Data contoh untuk preview live di editor template (bukan transaksi
        // sungguhan).
        const CONTOH_TRX_PREVIEW = {
            Nama_Pelanggan: 'Budi Santoso', No_Invoice: 'INV2608299999', Total_Harga: 45000,
            Tanggal_Masuk: '2026-08-29 14:00', Tanggal_Selesai: '2026-08-30 14:00',
            Layanan: 'Cuci Setrika Reguler (3), Setrika Saja (2)', Metode_Pembayaran: 'QRIS', No_HP: '81234567890'
        };

        let _trxUntukKirimWa = null;
        let _daftarTemplateUntukKirimWa = [];

        hitungOtomatisTanggalSelesai();

        const defaultLayanan = [
            { Nama_Layanan: "Cuci Setrika Reguler", Kategori: "Kiloan", Harga: "7.000" },
            { Nama_Layanan: "Cuci Setrika (Express)", Kategori: "Kiloan", Harga: "14.000" },
            { Nama_Layanan: "Setrika Reguler", Kategori: "Kiloan", Harga: "5.000" },
            { Nama_Layanan: "Bed Cover", Kategori: "Satuan", Harga: "25.000" }
        ];

        masterLayanan = defaultLayanan;
        renderDropdownLayanan();

        // ==========================================
        // AUTO-LOGOUT KARENA TIDAK AKTIF
        // ==========================================
        // Mitigasi untuk perangkat yang lupa di-logout manual (misal HP kasir
        // ditinggal di meja kasir dalam keadaan terbuka). Ganti BATAS_IDLE_MENIT
        // sesuai kenyamanan toko Anda.
        //
        // Waktu aktivitas terakhir disimpan di localStorage (bukan cuma
        // variabel JS di memori) supaya perhitungan idle tetap akurat walau
        // browser/PWA sempat benar-benar dimatikan paksa oleh OS saat
        // di-minimize (umum terjadi di HP, apalagi PWA yang di-"Add to Home
        // Screen") -- begitu dibuka lagi, kita langsung tahu sudah berapa
        // lama berlalu sejak aktivitas terakhir, bukan mulai hitung dari nol.
        const BATAS_IDLE_MENIT = 30;

        function catatAktivitasTerakhir() {
            waktuTerakhirAktif = Date.now();
            localStorage.setItem('cox_last_active', String(waktuTerakhirAktif));
        }
        function bersihkanSesiLogin() {
            ['cox_logged_in', 'cox_kasir', 'cox_role', 'cox_session', 'cox_last_active'].forEach(k => localStorage.removeItem(k));
        }
        function sesiSudahKedaluwarsa() {
            const tersimpan = parseInt(localStorage.getItem('cox_last_active') || '0', 10);
            if (!tersimpan) return false; // belum pernah tercatat -> anggap belum kedaluwarsa
            return (Date.now() - tersimpan) > BATAS_IDLE_MENIT * 60 * 1000;
        }

        ['click', 'keydown', 'touchstart', 'mousemove'].forEach(evt => {
            document.addEventListener(evt, catatAktivitasTerakhir, { passive: true });
        });
        setInterval(() => {
            const sesiAktifSekarang = localStorage.getItem('cox_logged_in') === 'true';
            if (sesiAktifSekarang && sesiSudahKedaluwarsa()) {
                bersihkanSesiLogin();
                alert(`Sesi berakhir karena tidak ada aktivitas selama ${BATAS_IDLE_MENIT} menit. Silakan login kembali.`);
                location.reload();
            }
        }, 60 * 1000);

        // Cek ulang begitu aplikasi kembali terlihat (mis. dibuka lagi
        // setelah di-minimize) -- tidak perlu menunggu interval 60 detik
        // berikutnya untuk tahu apakah sesi sudah kedaluwarsa.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible') return;
            const sesiAktifSekarang = localStorage.getItem('cox_logged_in') === 'true';
            if (sesiAktifSekarang && sesiSudahKedaluwarsa()) {
                bersihkanSesiLogin();
                alert(`Sesi berakhir karena tidak ada aktivitas selama ${BATAS_IDLE_MENIT} menit. Silakan login kembali.`);
                location.reload();
            } else if (sesiAktifSekarang) {
                catatAktivitasTerakhir();
            }
        });

        window.addEventListener('DOMContentLoaded', async () => {
            const sesiAktif = localStorage.getItem('cox_logged_in');
            const namaKasirSesi = localStorage.getItem('cox_kasir');
            let roleKasirSesi = 'Kasir';
            let sesiValid = false;

            // Kalau waktu sejak aktivitas terakhir sudah melewati batas idle
            // (termasuk selama aplikasi di-minimize / proses sempat mati),
            // anggap sesi kedaluwarsa dan paksa login ulang -- jangan
            // langsung auto-login begitu saja walau datanya masih ada.
            if (sesiAktif === 'true' && sesiSudahKedaluwarsa()) {
                bersihkanSesiLogin();
            } else if (sesiAktif === 'true' && namaKasirSesi && API_URL) {
                // Jangan pernah percaya begitu saja pada role yang tersimpan di
                // localStorage (bisa diubah manual lewat DevTools). Role wajib
                // dicocokkan ulang ke data akun asli dari server setiap kali
                // aplikasi dibuka.
                try {
                    const json = await apiGet('Pengguna');
                    if (json.data) {
                        masterPengguna = json.data;
                        renderDaftarPegawai();

                        const akunDitemukan = masterPengguna.find(p =>
                            String(p.Username || p.username || '').trim().toLowerCase() === String(namaKasirSesi).trim().toLowerCase()
                        );

                        if (akunDitemukan) {
                            roleKasirSesi = String(akunDitemukan.Role || akunDitemukan.role || akunDitemukan.ROLE || 'Kasir').trim();
                            localStorage.setItem('cox_role', roleKasirSesi);
                            sesiValid = true;
                        }
                    }
                } catch(e) { /* offline atau token salah: sesi lama ditolak, lihat di bawah */ }
            }

            if (sesiValid) {
                document.getElementById('loginScreen').classList.add('hidden');
                const app = document.getElementById('appContainer');
                app.classList.remove('hidden');
                app.classList.remove('opacity-0');

                document.getElementById('namaKasir').innerText = namaKasirSesi;
                document.getElementById('badgeRoleKasir').innerText = roleKasirSesi;

                catatAktivitasTerakhir(); // reset jam idle begitu berhasil masuk lagi
                terapkanHakAksesRole(); 
                sinkronisasiData();
            } else if (sesiAktif === 'true') {
                // Sesi lama ada tapi akunnya tidak bisa diverifikasi ulang
                // (misal akun dihapus, atau localStorage dipalsukan) -> paksa logout.
                bersihkanSesiLogin();
            }
        });

        function bukaFormPrinter() {
            document.getElementById('menuPengaturanList').classList.add('hidden');
            document.getElementById('formPegawaiPengaturan').classList.add('hidden');
            document.getElementById('formLayananPengaturan').classList.add('hidden');
            const form = document.getElementById('formPrinterPengaturan');
            form.classList.remove('hidden'); form.classList.add('fade-in');
            perbaruiStatusPrinterBT();
        }

        function tutupFormPrinter() {
            document.getElementById('formPrinterPengaturan').classList.add('hidden');
            const menu = document.getElementById('menuPengaturanList');
            menu.classList.remove('hidden'); menu.classList.add('fade-in');
        }

        function bukaFormPegawai() {
            renderDaftarPegawai();
            document.getElementById('menuPengaturanList').classList.add('hidden');
            document.getElementById('formPrinterPengaturan').classList.add('hidden');
            document.getElementById('formLayananPengaturan').classList.add('hidden');
            const form = document.getElementById('formPegawaiPengaturan');
            form.classList.remove('hidden'); form.classList.add('fade-in');
        }

        function tutupFormPegawai() {
            document.getElementById('formPegawaiPengaturan').classList.add('hidden');
            const menu = document.getElementById('menuPengaturanList');
            menu.classList.remove('hidden'); menu.classList.add('fade-in');
        }

        function bukaFormLayanan() {
            renderDaftarLayanan();
            document.getElementById('menuPengaturanList').classList.add('hidden');
            document.getElementById('formPrinterPengaturan').classList.add('hidden');
            document.getElementById('formPegawaiPengaturan').classList.add('hidden');
            const form = document.getElementById('formLayananPengaturan');
            form.classList.remove('hidden'); form.classList.add('fade-in');
        }

        function tutupFormLayanan() {
            document.getElementById('formLayananPengaturan').classList.add('hidden');
            resetFormLayanan();
            const menu = document.getElementById('menuPengaturanList');
            menu.classList.remove('hidden'); menu.classList.add('fade-in');
        }

        function renderDaftarPegawai() {
            const container = document.getElementById('listPegawaiContainer');
            if (masterPengguna.length === 0) {
                container.innerHTML = `<p class="text-[11px] text-blue-400 text-center italic py-2">Belum ada akun terdaftar di Database.</p>`;
                return;
            }

            let html = '';
            masterPengguna.forEach((p) => {
                let uname = String(p.Username || p.username || '').trim();
                let roleName = String(p.Role || p.role || p.ROLE || 'Kasir').trim();
                if (uname.toLowerCase() === 'admin') roleName = 'Admin';
                
                let isAdmin = roleName.toLowerCase() === 'admin';
                let roleColor = isAdmin ? 'text-rose-400 bg-rose-500/10 border-rose-500/50' : 'text-cox-cyan bg-cox-cyan/10 border-cox-cyan/50';
                
                html += `
                <div class="flex justify-between items-center bg-slate-900 border border-blue-800 p-3 rounded-xl text-xs">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full bg-blue-800/50 flex items-center justify-center text-blue-300">
                            <i class="fa-solid fa-user"></i>
                        </div>
                        <div>
                            <p class="font-bold text-white">${escapeHtml(uname) || 'Tanpa Nama'}</p>
                            <p class="text-[9px] text-blue-400 mt-0.5">Pass: ${'*'.repeat(String(p.Password || p.password || '').length) || '***'}</p>
                        </div>
                    </div>
                    <span class="px-2.5 py-1 border rounded-lg text-[10px] font-bold ${roleColor}">${escapeHtml(roleName)}</span>
                </div>
                `;
            });
            container.innerHTML = html;
        }

        async function simpanPegawaiBaru() {
            if (!API_URL) { alert('URL Apps Script belum diisi!'); return; }
            const user = document.getElementById('inputNewUser').value.trim();
            const pass = document.getElementById('inputNewPass').value.trim();
            const role = document.getElementById('inputNewRole').value;

            if (!user || !pass) { alert("Username dan Password tidak boleh kosong!"); return; }

            let exists = masterPengguna.some(p => String(p.Username || p.username).toLowerCase() === user.toLowerCase());
            if(exists) { alert("Username tersebut sudah digunakan, pilih nama lain."); return; }

            const btn = document.getElementById('btnSimpanPegawai');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...';
            btn.disabled = true;

            const payload = {
                sheetName: "Pengguna", action: "insert",
                rowData: { "Username": user, "Password": pass, "Role": role }
            };

            try {
                await kirimKeApiScript(payload);

                alert(`Akun pegawai ${user} berhasil ditambahkan!`);
                masterPengguna.push({"Username": user, "Password": pass, "Role": role});
                document.getElementById('inputNewUser').value = '';
                document.getElementById('inputNewPass').value = '';
                renderDaftarPegawai();
            } catch (err) {
                alert(`Gagal menambahkan pegawai: ${err.message}`);
            } finally {
                btn.innerHTML = originalText; btn.disabled = false;
            }
        }

        function renderDaftarLayanan() {
            const container = document.getElementById('listLayananContainer');
            if (!container) return;
            if (!masterLayanan || masterLayanan.length === 0) {
                container.innerHTML = `<p class="text-[11px] text-blue-400 text-center italic py-2">Belum ada layanan di Database.</p>`;
                return;
            }
            let html = '';
            masterLayanan.forEach((item, idx) => {
                let nama = item.Nama_Layanan || '';
                let kategori = item.Kategori || 'Kiloan';
                let rawHarga = item.Harga !== undefined && item.Harga !== "" ? item.Harga : "0";
                let harga = typeof rawHarga === 'string' ? parseInt(rawHarga.replace(/\./g, '').replace(/,/g, '')) || 0 : parseInt(rawHarga) || 0;
                html += `
                <div class="flex justify-between items-center bg-slate-900 border border-blue-800 p-3 rounded-xl text-xs">
                    <div>
                        <p class="font-bold text-white">${escapeHtml(nama)}</p>
                        <p class="text-[9px] text-blue-400 mt-0.5">${escapeHtml(kategori)} &middot; Rp ${harga.toLocaleString('id-ID')}</p>
                    </div>
                    <div class="flex gap-2">
                        <button onclick="mulaiEditLayanan(${idx})" class="w-8 h-8 rounded-full bg-blue-900/50 text-blue-300 hover:bg-cox-cyan hover:text-cox-bg flex items-center justify-center transition"><i class="fa-solid fa-pen text-[10px]"></i></button>
                        <button onclick="hapusLayanan(${idx})" class="w-8 h-8 rounded-full bg-blue-900/50 text-rose-400 hover:bg-rose-500 hover:text-white flex items-center justify-center transition"><i class="fa-solid fa-trash-can text-[10px]"></i></button>
                    </div>
                </div>
                `;
            });
            container.innerHTML = html;
        }

        function resetFormLayanan() {
            document.getElementById('editLayananOriginalNama').value = '';
            document.getElementById('inputNewLayananNama').value = '';
            document.getElementById('inputNewLayananKategori').value = 'Kiloan';
            document.getElementById('inputNewLayananHarga').value = '';
            document.getElementById('judulFormLayanan').innerHTML = '<i class="fa-solid fa-plus"></i> Tambah Layanan Baru';
            document.getElementById('btnSimpanLayanan').innerHTML = '<i class="fa-solid fa-plus"></i> Tambah Layanan';
            document.getElementById('btnBatalEditLayanan').classList.add('hidden');
        }

        function mulaiEditLayanan(idx) {
            const item = masterLayanan[idx];
            if (!item) return;
            let rawHarga = item.Harga !== undefined && item.Harga !== "" ? item.Harga : "0";
            let harga = typeof rawHarga === 'string' ? parseInt(rawHarga.replace(/\./g, '').replace(/,/g, '')) || 0 : parseInt(rawHarga) || 0;

            document.getElementById('editLayananOriginalNama').value = item.Nama_Layanan || '';
            document.getElementById('inputNewLayananNama').value = item.Nama_Layanan || '';
            document.getElementById('inputNewLayananKategori').value = item.Kategori || 'Kiloan';
            document.getElementById('inputNewLayananHarga').value = harga;
            document.getElementById('judulFormLayanan').innerHTML = '<i class="fa-solid fa-pen"></i> Edit Layanan';
            document.getElementById('btnSimpanLayanan').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Perubahan';
            document.getElementById('btnBatalEditLayanan').classList.remove('hidden');
            document.getElementById('formTambahLayanan').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        async function simpanLayanan() {
            if (!API_URL) { alert('URL Apps Script belum diisi!'); return; }
            const namaBaru = document.getElementById('inputNewLayananNama').value.trim();
            const kategori = document.getElementById('inputNewLayananKategori').value;
            const harga = parseFloat(document.getElementById('inputNewLayananHarga').value);
            const namaLama = document.getElementById('editLayananOriginalNama').value;
            const isEdit = !!namaLama;

            if (!namaBaru || !harga || harga <= 0) { alert('Nama layanan dan harga wajib diisi dengan benar!'); return; }

            const textEdit = '<i class="fa-solid fa-floppy-disk"></i> Simpan Perubahan';
            const textAdd = '<i class="fa-solid fa-plus"></i> Tambah Layanan';
            const btn = document.getElementById('btnSimpanLayanan');
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...'; btn.disabled = true;

            try {
                if (isEdit) {
                    await kirimKeApiScript({
                        sheetName: "Layanan", action: "update", idField: "Nama_Layanan", id: namaLama,
                        updateData: { "Nama_Layanan": namaBaru, "Kategori": kategori, "Harga": harga }
                    });
                    let idx = masterLayanan.findIndex(l => l.Nama_Layanan === namaLama);
                    if (idx > -1) masterLayanan[idx] = { Nama_Layanan: namaBaru, Kategori: kategori, Harga: harga };
                    alert(`Layanan "${namaBaru}" berhasil diperbarui!`);
                } else {
                    let sudahAda = masterLayanan.some(l => String(l.Nama_Layanan).toLowerCase() === namaBaru.toLowerCase());
                    if (sudahAda) { alert('Nama layanan tersebut sudah ada, gunakan nama lain atau edit yang sudah ada.'); btn.disabled = false; btn.innerHTML = textAdd; return; }
                    await kirimKeApiScript({
                        sheetName: "Layanan", action: "insert",
                        rowData: { "Nama_Layanan": namaBaru, "Kategori": kategori, "Harga": harga }
                    });
                    masterLayanan.push({ Nama_Layanan: namaBaru, Kategori: kategori, Harga: harga });
                    alert(`Layanan "${namaBaru}" berhasil ditambahkan!`);
                }
                resetFormLayanan();
                renderDaftarLayanan();
                renderDropdownLayanan();
            } catch (err) {
                alert(`Gagal menyimpan layanan: ${err.message}`);
                btn.innerHTML = isEdit ? textEdit : textAdd;
            } finally {
                btn.disabled = false;
            }
        }

        async function hapusLayanan(idx) {
            const item = masterLayanan[idx];
            if (!item) return;
            const nama = item.Nama_Layanan || '';
            if (!confirm(`Hapus layanan "${nama}"? Tindakan ini tidak bisa dibatalkan.`)) return;
            try {
                await kirimKeApiScript({ sheetName: "Layanan", action: "delete", idField: "Nama_Layanan", id: nama });
                masterLayanan.splice(idx, 1);
                renderDaftarLayanan();
                renderDropdownLayanan();
                alert(`Layanan "${nama}" berhasil dihapus.`);
            } catch (err) {
                alert(`Gagal menghapus layanan: ${err.message}`);
            }
        }

        function formatWaktuIndo(tglStr) {
            if (!tglStr) return '-';
            try {
                let cleanStr = String(tglStr).replace('T', ' ').replace('.000Z', '').replace('Z', '');
                let parts = cleanStr.split(' ');
                let datePart = parts[0]; 
                let timePart = parts[1] || '00:00';

                if (datePart && datePart.includes('-')) {
                    let [y, m, d] = datePart.split('-');
                    const namaBulan = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
                    let bln = namaBulan[parseInt(m, 10) - 1];
                    let timeFormatted = timePart ? `, ${timePart.substring(0, 5)} WIB` : '';
                    return `${d} ${bln} ${y}${timeFormatted}`;
                }
                return cleanStr;
            } catch(e) { return String(tglStr); }
        }

        function togglePassword() {
            const passInput = document.getElementById('password'); const eyeIcon = document.getElementById('eyeIcon');
            if (passInput.type === 'password') { passInput.type = 'text'; eyeIcon.className = 'fa-solid fa-eye-slash text-sm';
            } else { passInput.type = 'password'; eyeIcon.className = 'fa-solid fa-eye text-sm'; }
        }

        function switchTab(tab) {
            const views = ['viewBeranda', 'viewPesanan', 'viewLaporan', 'viewPengaturan'];
            const navs = ['navBeranda', 'navPesanan', 'navLaporan', 'navPengaturan'];
            const titles = { beranda: "Beranda", pesanan: "Daftar Pesanan", laporan: "Laporan Keuangan", pengaturan: "Pengaturan & Alat" };
            
            document.getElementById('headerTitle').innerText = titles[tab];

            if (tab !== 'pengaturan') {
                document.getElementById('formPrinterPengaturan').classList.add('hidden');
                document.getElementById('formPegawaiPengaturan').classList.add('hidden');
                document.getElementById('formLayananPengaturan').classList.add('hidden');
                document.getElementById('menuPengaturanList').classList.remove('hidden');
            }

            views.forEach(v => document.getElementById(v).classList.add('hidden'));
            navs.forEach(n => {
                const el = document.getElementById(n);
                if(el) { el.classList.replace('text-cox-cyan', 'text-blue-400'); el.classList.add('hover:text-cox-cyan'); }
            });

            let viewId = 'view' + tab.charAt(0).toUpperCase() + tab.slice(1);
            let navId = 'nav' + tab.charAt(0).toUpperCase() + tab.slice(1);

            document.getElementById(viewId).classList.remove('hidden');
            let navActive = document.getElementById(navId);
            if(navActive) { navActive.classList.replace('text-blue-400', 'text-cox-cyan'); navActive.classList.remove('hover:text-cox-cyan'); }

            if (tab === 'laporan') { renderLaporan(); }
        }

        async function sinkronisasiData() {
            if (!API_URL) return;
            const syncIcon = document.getElementById('syncIcon');
            syncIcon.classList.add('fa-spin');

            try {
                // Ambil SEMUA sheet secara PARALEL, bukan satu per satu
                // berurutan. Setiap panggilan ke Google Apps Script punya
                // latensi tersendiri (termasuk "cold start" yang bisa 1-3
                // detik) -- memanggilnya berurutan berarti total waktu tunggu
                // adalah JUMLAH semua latensi itu. Dengan Promise.all, total
                // waktu tunggu cuma sebesar request yang PALING LAMBAT, bukan
                // jumlah semuanya -- ini yang paling berdampak ke kecepatan
                // sinkronisasi awal (login/refresh).
                const [jsonPengguna, jsonLayanan, jsonPelanggan, jsonTransaksi, jsonPengeluaran, jsonPresensi, jsonTemplateWa, jsonTemplateToko] = await Promise.all([
                    apiGet('Pengguna'),
                    apiGet('Layanan'),
                    apiGet('Pelanggan'),
                    apiGet('Transaksi'),
                    apiGet('Pengeluaran'),
                    apiGet('Presensi'),
                    apiGet('Template_WA'),
                    apiGet('Template_Toko')
                ]);

                if (jsonPengguna.data) { masterPengguna = jsonPengguna.data; renderDaftarPegawai(); }
                if (jsonLayanan.data && jsonLayanan.data.length > 0) { masterLayanan = jsonLayanan.data; renderDropdownLayanan(); renderDaftarLayanan(); }
                if (jsonPelanggan.data && jsonPelanggan.data.length > 0) { masterPelanggan = jsonPelanggan.data; renderDropdownPelangganMenu(); }

                masterTransaksi = jsonTransaksi.data || [];
                kalkulasiDashboard(masterTransaksi); renderDaftarPesanan(masterTransaksi);

                masterPengeluaran = jsonPengeluaran.data || [];

                masterPresensi = jsonPresensi.data || [];
                renderStatusPresensiHariIni();
                renderDaftarPresensiSemua();

                masterTemplateWa = jsonTemplateWa.data || [];
                masterTemplateToko = jsonTemplateToko.data || [];

                const viewLaporanEl = document.getElementById('viewLaporan');
                if (viewLaporanEl && !viewLaporanEl.classList.contains('hidden')) renderLaporan();
            } catch (error) {
                console.log("Menggunakan data lokal/fallback.");
            } finally {
                syncIcon.classList.remove('fa-spin');
            }
        }

        function renderDropdownPelangganMenu() {
            const select = document.getElementById('pilihPelangganDropdown');
            select.innerHTML = '<option value="" disabled selected>+ Ketik Pelanggan Baru / Pilih dari daftar...</option>';
            masterPelanggan.forEach(p => {
                if(p.Nama && p.No_HP) {
                    const opt = document.createElement('option'); opt.value = p.No_HP; opt.setAttribute('data-nama', p.Nama); opt.innerText = `${p.Nama} (${p.No_HP})`; select.appendChild(opt);
                }
            });
        }

        function pilihPelangganDariDropdown() {
            const select = document.getElementById('pilihPelangganDropdown');
            if (select.selectedIndex > 0) {
                document.getElementById('inputNamaPelanggan').value = select.options[select.selectedIndex].getAttribute('data-nama');
                document.getElementById('inputNoHP').value = select.value;
            }
        }

        function filterKategori(kategori, element) {
            kategoriAktif = kategori;
            document.querySelectorAll('.btn-kat').forEach(b => b.className = "btn-kat bg-slate-900 border border-blue-800 text-blue-200 py-1.5 rounded-lg text-xs transition");
            element.className = "btn-kat bg-cox-cyan/20 border border-cox-cyan text-cox-cyan py-1.5 rounded-lg text-xs font-semibold transition";
            renderDropdownLayanan();
        }

        function hitungOtomatisTanggalSelesai() {
            const tglMasukVal = document.getElementById('inputTglMasuk').value;
            if (!tglMasukVal) return;
            let dateObj = new Date(tglMasukVal);
            let adaSatuan = keranjangItem.some(item => String(item.kategori).trim().toLowerCase() === 'satuan');
            let adaExpress = keranjangItem.some(item => item.nama.toLowerCase().includes('express'));
            let durasiJam = adaSatuan ? 72 : (adaExpress ? 12 : 24);
            dateObj.setTime(dateObj.getTime() + (durasiJam * 60 * 60 * 1000));
            const y = dateObj.getFullYear(), m = String(dateObj.getMonth() + 1).padStart(2, '0'), d = String(dateObj.getDate()).padStart(2, '0');
            const h = String(dateObj.getHours()).padStart(2, '0'), min = String(dateObj.getMinutes()).padStart(2, '0');
            document.getElementById('inputTglSelesai').value = `${y}-${m}-${d}T${h}:${min}`;
        }

        function renderDropdownLayanan() {
            const select = document.getElementById('inputLayanan');
            select.innerHTML = '<option value="" disabled selected>Pilih layanan...</option>';
            let filtered = masterLayanan.filter(item => String(item.Kategori).trim().toLowerCase() === kategoriAktif.toLowerCase());
            filtered.forEach(item => {
                let rawHarga = item.Harga !== undefined && item.Harga !== "" ? item.Harga : "0";
                let harga = typeof rawHarga === 'string' ? parseInt(rawHarga.replace(/\./g, '').replace(/,/g, '')) || 0 : parseInt(rawHarga) || 0;
                const opt = document.createElement('option'); opt.value = item.Nama_Layanan; opt.setAttribute('data-harga', harga); opt.setAttribute('data-kategori', item.Kategori || 'Kiloan');
                opt.innerText = `${item.Nama_Layanan} - Rp ${harga.toLocaleString('id-ID')}`;
                select.appendChild(opt);
            });
        }

        function tambahItemKeranjang() {
            const select = document.getElementById('inputLayanan'), jumlahInput = document.getElementById('inputJumlah');
            if (select.selectedIndex <= 0) { alert('Silakan pilih jenis layanan terlebih dahulu!'); return; }
            const qty = parseFloat(jumlahInput.value);
            if (!qty || qty <= 0) { alert('Masukkan jumlah (Kg/Pcs) dengan benar!'); return; }
            const namaLayanan = select.value, hargaSatuan = parseFloat(select.options[select.selectedIndex].getAttribute('data-harga')) || 0;
            const kategoriItem = select.options[select.selectedIndex].getAttribute('data-kategori') || 'Kiloan';
            keranjangItem.push({ nama: namaLayanan, kategori: kategoriItem, qty: qty, hargaSatuan: hargaSatuan, subtotal: hargaSatuan * qty });
            select.selectedIndex = 0; jumlahInput.value = '';
            renderKeranjang(); hitungOtomatisTanggalSelesai(); 
        }

        function hapusItemKeranjang(index) { keranjangItem.splice(index, 1); renderKeranjang(); hitungOtomatisTanggalSelesai(); }

        function ubahTipeDiskon(tipe, element) {
            document.getElementById('tipeDiskonVal').value = tipe;
            document.querySelectorAll('.btn-tipe-diskon').forEach(b => b.className = "btn-tipe-diskon w-1/2 text-blue-400 text-xs py-1.5 rounded-lg hover:text-white transition");
            element.className = "btn-tipe-diskon w-1/2 bg-cox-cyan/20 text-cox-cyan text-xs py-1.5 rounded-lg font-semibold transition";
            hitungTotalAkhir();
        }

        function renderKeranjang() {
            const container = document.getElementById('keranjangContainer'), badge = document.getElementById('badgeJumlahItem');
            badge.innerText = `${keranjangItem.length} Item`;
            if (keranjangItem.length === 0) {
                container.innerHTML = `<p class="text-[11px] text-blue-400 text-center py-3 italic">Belum ada item ditambahkan ke pesanan.</p>`;
                hitungTotalAkhir(); return;
            }
            let html = '';
            keranjangItem.forEach((item, idx) => {
                html += `<div class="flex justify-between items-center bg-slate-900 border border-blue-800/60 p-2.5 rounded-xl text-xs"><div class="flex-1 pr-2"><p class="font-semibold text-white">${escapeHtml(item.nama)} <span class="text-[10px] text-cox-cyan">(${escapeHtml(item.kategori)})</span></p><p class="text-[10px] text-blue-300">${item.qty} x Rp ${item.hargaSatuan.toLocaleString('id-ID')}</p></div><div class="flex items-center gap-3"><span class="font-bold text-cox-cyan">Rp ${item.subtotal.toLocaleString('id-ID')}</span><button type="button" onclick="hapusItemKeranjang(${idx})" class="text-rose-400 hover:text-rose-300 p-1"><i class="fa-solid fa-trash-can"></i></button></div></div>`;
            });
            container.innerHTML = html; hitungTotalAkhir();
        }

        function hitungTotalAkhir() {
            let subtotal = keranjangItem.reduce((sum, item) => sum + item.subtotal, 0);
            let valDiskon = parseFloat(document.getElementById('inputDiskon').value) || 0;
            let tipe = document.getElementById('tipeDiskonVal').value;
            let potongan = (valDiskon > 0) ? (tipe === '%' ? subtotal * (valDiskon / 100) : valDiskon) : 0;
            
            let totalAkhir = Math.max(0, subtotal - potongan);
            let displayEl = document.getElementById('displayTotalHarga');
            
            if (potongan > 0) { displayEl.innerHTML = `<div class="flex flex-col items-end"><span class="text-[10px] text-rose-400 line-through mb-[-4px]">Rp ${subtotal.toLocaleString('id-ID')}</span><span class="text-xl font-bold text-cox-cyan">Rp ${totalAkhir.toLocaleString('id-ID')}</span></div>`;
            } else { displayEl.innerHTML = `Rp ${subtotal.toLocaleString('id-ID')}`; }
            displayEl.setAttribute('data-total', totalAkhir);
        }

        function kalkulasiDashboard(dataTransaksi) {
            let pendapatan = 0, antrean = 0;
            dataTransaksi.forEach(trx => {
                if (trx.Tanggal_Masuk && String(trx.Tanggal_Masuk).includes(currentDateTimeString.split('T')[0])) { pendapatan += parseFloat(trx.Total_Harga) || 0; }
                if (trx.Status && trx.Status.toLowerCase() !== 'selesai' && trx.Status.toLowerCase() !== 'diambil') { antrean++; }
            });
            document.getElementById('displayPendapatan').innerHTML = `Rp ${pendapatan.toLocaleString('id-ID')}`;
            document.getElementById('displayAntrean').innerHTML = `${antrean} Nota`;
        }

        // ==========================================
        // LAPORAN KEUANGAN
        // ==========================================
        function getTanggalDariString(str) {
            // Ambil bagian YYYY-MM-DD dari sebuah nilai tanggal, baik itu
            // string biasa ("2026-08-29 10:30") maupun string ISO hasil
            // serialisasi Date oleh Google Sheets ("2026-08-29T10:30:00.000Z").
            // Pola pembersihan ini sama dengan yang dipakai formatWaktuIndo().
            if (!str) return '';
            let cleanStr = String(str).replace('T', ' ').replace('.000Z', '').replace('Z', '');
            return cleanStr.split(' ')[0];
        }

        function ubahPeriodeLaporan(mode, element) {
            periodeLaporanAktif = mode;
            document.querySelectorAll('.btn-periode-laporan').forEach(b => b.className = "btn-periode-laporan flex-1 py-2 rounded-lg text-xs font-semibold text-blue-300 transition");
            element.className = "btn-periode-laporan flex-1 py-2 rounded-lg text-xs font-semibold bg-cox-cyan/20 text-cox-cyan transition";
            document.getElementById('inputTanggalLaporan').classList.toggle('hidden', mode !== 'harian');
            document.getElementById('inputBulanLaporan').classList.toggle('hidden', mode !== 'bulanan');
            renderLaporan();
        }

        function getFilterKeyLaporan() {
            let tglInput = document.getElementById('inputTanggalLaporan');
            let bulanInput = document.getElementById('inputBulanLaporan');
            if (!tglInput.value) tglInput.value = new Date().toISOString().slice(0, 10);
            if (!bulanInput.value) bulanInput.value = new Date().toISOString().slice(0, 7);
            return periodeLaporanAktif === 'harian' ? tglInput.value : bulanInput.value;
        }

        function getDataPeriodeLaporan() {
            const filterKey = getFilterKeyLaporan();
            const transaksiPeriode = masterTransaksi.filter(trx => {
                let tgl = getTanggalDariString(trx.Tanggal_Masuk);
                return periodeLaporanAktif === 'harian' ? tgl === filterKey : tgl.startsWith(filterKey);
            });
            const pengeluaranPeriode = masterPengeluaran.filter(p => {
                let tgl = getTanggalDariString(p.Tanggal);
                return periodeLaporanAktif === 'harian' ? tgl === filterKey : tgl.startsWith(filterKey);
            });
            return { filterKey, transaksiPeriode, pengeluaranPeriode };
        }

        function renderLaporan() {
            if (!document.getElementById('viewLaporan')) return;
            const { transaksiPeriode, pengeluaranPeriode } = getDataPeriodeLaporan();

            let totalPendapatan = transaksiPeriode.reduce((sum, t) => sum + (parseFloat(t.Total_Harga) || 0), 0);
            let totalPengeluaran = pengeluaranPeriode.reduce((sum, p) => sum + (parseFloat(p.Nominal) || 0), 0);
            let notaSelesai = transaksiPeriode.filter(t => t.Status && ['selesai', 'diambil'].includes(String(t.Status).toLowerCase())).length;

            document.getElementById('lapPendapatan').innerText = `Rp ${totalPendapatan.toLocaleString('id-ID')}`;
            document.getElementById('lapPengeluaran').innerText = `Rp ${totalPengeluaran.toLocaleString('id-ID')}`;
            document.getElementById('lapLaba').innerText = `Rp ${(totalPendapatan - totalPengeluaran).toLocaleString('id-ID')}`;
            document.getElementById('lapNotaSelesai').innerText = `${notaSelesai} Nota`;

            let metodeMap = {};
            transaksiPeriode.forEach(t => {
                let m = t.Metode_Pembayaran || t.Metode || t.Pembayaran || 'Lainnya';
                metodeMap[m] = (metodeMap[m] || 0) + (parseFloat(t.Total_Harga) || 0);
            });
            let rincianEl = document.getElementById('rincianMetodeLaporan');
            let entriMetode = Object.entries(metodeMap);
            if (entriMetode.length === 0) {
                rincianEl.innerHTML = `<p class="text-blue-400 italic text-center py-2">Belum ada transaksi pada periode ini.</p>`;
            } else {
                rincianEl.innerHTML = entriMetode.map(([m, v]) => `
                    <div class="flex justify-between items-center bg-slate-900/60 px-3 py-2 rounded-lg">
                        <span class="text-blue-200">${escapeHtml(m)}</span>
                        <span class="font-bold text-cox-cyan">Rp ${v.toLocaleString('id-ID')}</span>
                    </div>`).join('');
            }

            renderTrenLaporan();
            renderInsightLaporan(transaksiPeriode);
        }

        // Ambil nama-nama layanan murni dari field Layanan yang formatnya
        // "Cuci Setrika Reguler (4.6), Setrika Reguler (2) [Diskon Rp 5.000]"
        // -- buang bagian (qty) dan [Diskon ...].
        function ekstrakNamaLayanan(layananStr) {
            if (!layananStr) return [];
            let tanpaDiskon = String(layananStr).replace(/\[Diskon[^\]]*\]/gi, '');
            return tanpaDiskon.split(',').map(s => s.replace(/\(.*?\)/g, '').trim()).filter(Boolean);
        }

        function renderInsightLaporan(transaksiPeriode) {
            // --- Layanan terlaris ---
            let hitungLayanan = {};
            transaksiPeriode.forEach(t => {
                ekstrakNamaLayanan(t.Layanan).forEach(nama => {
                    hitungLayanan[nama] = (hitungLayanan[nama] || 0) + 1;
                });
            });
            let layananTerlaris = Object.entries(hitungLayanan).sort((a, b) => b[1] - a[1]).slice(0, 5);
            let layananEl = document.getElementById('layananTerlarisLaporan');
            if (layananTerlaris.length === 0) {
                layananEl.innerHTML = `<p class="text-blue-400 italic text-center py-2">Belum ada transaksi pada periode ini.</p>`;
            } else {
                layananEl.innerHTML = layananTerlaris.map(([nama, jumlah], idx) => `
                    <div class="flex justify-between items-center bg-slate-900/60 px-3 py-2 rounded-lg">
                        <span class="text-blue-200">${idx + 1}. ${escapeHtml(nama)}</span>
                        <span class="font-bold text-cox-cyan">${jumlah}x</span>
                    </div>`).join('');
            }

            // --- Jam tersibuk (mode harian) / Hari tersibuk (mode bulanan) ---
            let insightWaktu;
            if (periodeLaporanAktif === 'harian') {
                document.getElementById('judulInsightWaktu').innerText = 'Jam Tersibuk';
                let hitungJam = new Array(24).fill(0);
                transaksiPeriode.forEach(t => {
                    let cleanStr = String(t.Tanggal_Masuk || '').replace('T', ' ').replace('.000Z', '').replace('Z', '');
                    let jamPart = cleanStr.split(' ')[1];
                    if (jamPart) {
                        let jam = parseInt(jamPart.split(':')[0], 10);
                        if (!isNaN(jam) && jam >= 0 && jam < 24) hitungJam[jam]++;
                    }
                });
                let totalJam = hitungJam.reduce((a, b) => a + b, 0);
                if (totalJam === 0) {
                    insightWaktu = 'Belum ada data jam masuk pada periode ini.';
                } else {
                    let jamPuncak = hitungJam.indexOf(Math.max(...hitungJam));
                    insightWaktu = `Pukul ${String(jamPuncak).padStart(2, '0')}:00 - ${String((jamPuncak + 1) % 24).padStart(2, '0')}:00 (${hitungJam[jamPuncak]} pesanan)`;
                }
            } else {
                document.getElementById('judulInsightWaktu').innerText = 'Hari Tersibuk (dalam sebulan)';
                const namaHari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
                let hitungHari = new Array(7).fill(0);
                transaksiPeriode.forEach(t => {
                    let tglStr = getTanggalDariString(t.Tanggal_Masuk);
                    if (tglStr) {
                        let d = new Date(tglStr + 'T00:00:00');
                        if (!isNaN(d.getTime())) hitungHari[d.getDay()]++;
                    }
                });
                let totalHari = hitungHari.reduce((a, b) => a + b, 0);
                if (totalHari === 0) {
                    insightWaktu = 'Belum ada data pada periode ini.';
                } else {
                    let hariPuncak = hitungHari.indexOf(Math.max(...hitungHari));
                    insightWaktu = `${namaHari[hariPuncak]} (${hitungHari[hariPuncak]} pesanan)`;
                }
            }
            document.getElementById('insightWaktuLaporan').innerText = insightWaktu;
        }

        function renderTrenLaporan() {
            const container = document.getElementById('grafikTrenLaporan');
            if (!container) return;
            let labels = [], values = [];

            if (periodeLaporanAktif === 'harian') {
                for (let i = 6; i >= 0; i--) {
                    let d = new Date(); d.setDate(d.getDate() - i);
                    let key = d.toISOString().slice(0, 10);
                    let total = masterTransaksi.filter(t => getTanggalDariString(t.Tanggal_Masuk) === key).reduce((s, t) => s + (parseFloat(t.Total_Harga) || 0), 0);
                    labels.push(d.toLocaleDateString('id-ID', { weekday: 'short' }));
                    values.push(total);
                }
            } else {
                for (let i = 5; i >= 0; i--) {
                    let d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
                    let key = d.toISOString().slice(0, 7);
                    let total = masterTransaksi.filter(t => getTanggalDariString(t.Tanggal_Masuk).startsWith(key)).reduce((s, t) => s + (parseFloat(t.Total_Harga) || 0), 0);
                    labels.push(d.toLocaleDateString('id-ID', { month: 'short' }));
                    values.push(total);
                }
            }

            let max = Math.max(...values, 1);
            container.innerHTML = values.map((v, idx) => {
                let heightPct = Math.max(4, (v / max) * 100);
                return `<div class="flex-1 flex flex-col items-center justify-end h-full gap-1">
                            <div class="w-full bg-gradient-to-t from-cox-cyan to-cox-blue rounded-t-md transition-all" style="height:${heightPct}%" title="Rp ${v.toLocaleString('id-ID')}"></div>
                            <span class="text-[8px] text-blue-400">${labels[idx]}</span>
                        </div>`;
            }).join('');
        }

        function csvEscape(val) {
            let s = String(val === undefined || val === null ? '' : val);
            if (/^[=+\-@]/.test(s)) s = "'" + s; // cegah formula injection saat CSV dibuka di Excel
            s = s.replace(/"/g, '""');
            return `"${s}"`;
        }

        function exportLaporanCSV() {
            const { filterKey, transaksiPeriode, pengeluaranPeriode } = getDataPeriodeLaporan();
            if (transaksiPeriode.length === 0 && pengeluaranPeriode.length === 0) { alert('Tidak ada data untuk diekspor pada periode ini.'); return; }

            let csv = 'LAPORAN PENDAPATAN (TRANSAKSI)\n';
            csv += ['No Invoice', 'Tanggal Masuk', 'Nama Pelanggan', 'Layanan', 'Total Harga', 'Status', 'Metode Pembayaran'].map(csvEscape).join(',') + '\n';
            transaksiPeriode.forEach(t => {
                csv += [t.No_Invoice, t.Tanggal_Masuk, t.Nama_Pelanggan, t.Layanan, t.Total_Harga, t.Status, (t.Metode_Pembayaran || t.Metode || t.Pembayaran || '')].map(csvEscape).join(',') + '\n';
            });
            csv += '\nLAPORAN PENGELUARAN\n';
            csv += ['Tanggal', 'Kategori', 'Keterangan', 'Nominal', 'Dicatat Oleh'].map(csvEscape).join(',') + '\n';
            pengeluaranPeriode.forEach(p => {
                csv += [p.Tanggal, p.Kategori, p.Keterangan, p.Nominal, p.Dicatat_Oleh].map(csvEscape).join(',') + '\n';
            });

            const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `Laporan_CoxLaundry_${filterKey}.csv`;
            document.body.appendChild(link); link.click(); document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
        }

        // ==========================================
        // PENCATATAN PENGELUARAN
        // ==========================================
        function bukaModalPengeluaran() {
            document.getElementById('inputTglPengeluaran').value = new Date().toISOString().slice(0, 10);
            document.getElementById('inputKategoriPengeluaran').selectedIndex = 0;
            document.getElementById('inputKeteranganPengeluaran').value = '';
            document.getElementById('inputNominalPengeluaran').value = '';
            renderPengeluaranHariIni();
            const overlay = document.getElementById('modalPengeluaranOverlay'), content = document.getElementById('modalPengeluaranContent');
            overlay.classList.remove('hidden'); setTimeout(() => { overlay.classList.remove('opacity-0'); content.classList.add('active'); }, 10);
        }
        function tutupModalPengeluaran() {
            const overlay = document.getElementById('modalPengeluaranOverlay'), content = document.getElementById('modalPengeluaranContent');
            content.classList.remove('active'); overlay.classList.add('opacity-0');
            setTimeout(() => overlay.classList.add('hidden'), 300);
        }

        function renderPengeluaranHariIni() {
            const todayStr = new Date().toISOString().slice(0, 10);
            const container = document.getElementById('listPengeluaranHariIni');
            const badge = document.getElementById('badgeTotalPengeluaranHariIni');
            let listHariIni = masterPengeluaran.filter(p => getTanggalDariString(p.Tanggal) === todayStr);
            let total = listHariIni.reduce((s, p) => s + (parseFloat(p.Nominal) || 0), 0);
            badge.innerText = `Rp ${total.toLocaleString('id-ID')}`;
            if (listHariIni.length === 0) {
                container.innerHTML = `<p class="text-[11px] text-blue-400 text-center py-3 italic">Belum ada pengeluaran hari ini.</p>`;
                return;
            }
            container.innerHTML = listHariIni.map((p) => {
                let idxAsli = masterPengeluaran.indexOf(p);
                return `<div class="flex justify-between items-center bg-slate-900 border border-blue-800/60 p-2.5 rounded-xl text-xs">
                    <div class="flex-1 pr-2">
                        <p class="font-semibold text-white">${escapeHtml(p.Keterangan) || '-'}</p>
                        <p class="text-[10px] text-blue-300">${escapeHtml(p.Kategori) || '-'}</p>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="font-bold text-rose-400">Rp ${(parseFloat(p.Nominal) || 0).toLocaleString('id-ID')}</span>
                        <button onclick="hapusPengeluaran(${idxAsli})" class="text-rose-400 hover:text-rose-300 p-1"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </div>`;
            }).join('');
        }

        async function simpanPengeluaran() {
            if (!API_URL) { alert('URL Apps Script belum diisi!'); return; }
            const tanggal = document.getElementById('inputTglPengeluaran').value;
            const kategori = document.getElementById('inputKategoriPengeluaran').value;
            const keterangan = document.getElementById('inputKeteranganPengeluaran').value.trim();
            const nominal = parseFloat(document.getElementById('inputNominalPengeluaran').value);

            if (!tanggal || !keterangan || !nominal || nominal <= 0) { alert('Mohon lengkapi seluruh data pengeluaran dengan benar!'); return; }

            const idPengeluaran = 'EXP' + Date.now();
            const pencatat = localStorage.getItem('cox_kasir') || 'Admin';
            const btn = document.getElementById('btnSimpanPengeluaran'), originalHtml = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; btn.disabled = true;

            const payload = {
                sheetName: "Pengeluaran", action: "insert",
                rowData: { "ID_Pengeluaran": idPengeluaran, "Tanggal": tanggal, "Kategori": kategori, "Keterangan": keterangan, "Nominal": nominal, "Dicatat_Oleh": pencatat }
            };

            try {
                await kirimKeApiScript(payload);
                masterPengeluaran.push({ ID_Pengeluaran: idPengeluaran, Tanggal: tanggal, Kategori: kategori, Keterangan: keterangan, Nominal: nominal, Dicatat_Oleh: pencatat });
                document.getElementById('inputKeteranganPengeluaran').value = '';
                document.getElementById('inputNominalPengeluaran').value = '';
                renderPengeluaranHariIni();
                alert('Pengeluaran berhasil dicatat!');
            } catch (err) {
                alert(`Gagal mencatat pengeluaran: ${err.message}`);
            } finally {
                btn.innerHTML = originalHtml; btn.disabled = false;
            }
        }

        async function hapusPengeluaran(idx) {
            const item = masterPengeluaran[idx];
            if (!item) return;
            if (!confirm(`Hapus catatan pengeluaran "${item.Keterangan}" senilai Rp ${(parseFloat(item.Nominal) || 0).toLocaleString('id-ID')}?`)) return;
            try {
                await kirimKeApiScript({ sheetName: "Pengeluaran", action: "delete", idField: "ID_Pengeluaran", id: item.ID_Pengeluaran });
                masterPengeluaran.splice(idx, 1);
                renderPengeluaranHariIni();
            } catch (err) {
                alert(`Gagal menghapus pengeluaran: ${err.message}`);
            }
        }

        // ==========================================
        // PRESENSI / ABSENSI PEGAWAI
        // ==========================================
        function buatIdPresensiHariIni(username) {
            const todayStr = new Date().toISOString().slice(0, 10);
            return `${username}_${todayStr}`;
        }

        function bukaModalPresensi() {
            renderStatusPresensiHariIni();
            renderDaftarPresensiSemua();
            terapkanHakAksesRole();
            const overlay = document.getElementById('modalPresensiOverlay'), content = document.getElementById('modalPresensiContent');
            overlay.classList.remove('hidden'); setTimeout(() => { overlay.classList.remove('opacity-0'); content.classList.add('active'); }, 10);
        }
        function tutupModalPresensi() {
            const overlay = document.getElementById('modalPresensiOverlay'), content = document.getElementById('modalPresensiContent');
            content.classList.remove('active'); overlay.classList.add('opacity-0');
            setTimeout(() => overlay.classList.add('hidden'), 300);
        }

        function renderStatusPresensiHariIni() {
            const statusEl = document.getElementById('statusPresensiSaya');
            const btnMasuk = document.getElementById('btnAbsenMasuk'), btnPulang = document.getElementById('btnAbsenPulang');
            const username = localStorage.getItem('cox_kasir');
            if (!statusEl || !username) return;

            const idHariIni = buatIdPresensiHariIni(username);
            const rec = masterPresensi.find(p => String(p.ID_Presensi) === idHariIni);

            if (!rec) {
                statusEl.innerHTML = `<p class="text-xs text-blue-300">Anda belum melakukan absen masuk hari ini.</p>`;
                if (btnMasuk) btnMasuk.disabled = false;
                if (btnPulang) btnPulang.disabled = true;
            } else if (rec.Jam_Masuk && !rec.Jam_Pulang) {
                statusEl.innerHTML = `<p class="text-xs text-emerald-400 font-semibold"><i class="fa-solid fa-circle-check"></i> Masuk pukul ${escapeHtml(rec.Jam_Masuk)}</p><p class="text-[10px] text-blue-300 mt-1">Jangan lupa absen pulang setelah shift selesai.</p>`;
                if (btnMasuk) btnMasuk.disabled = true;
                if (btnPulang) btnPulang.disabled = false;
            } else {
                statusEl.innerHTML = `<p class="text-xs text-cox-cyan font-semibold"><i class="fa-solid fa-circle-check"></i> Masuk: ${escapeHtml(rec.Jam_Masuk)} &nbsp;|&nbsp; Pulang: ${escapeHtml(rec.Jam_Pulang)}</p><p class="text-[10px] text-blue-300 mt-1">Presensi hari ini sudah lengkap. Sampai jumpa besok!</p>`;
                if (btnMasuk) btnMasuk.disabled = true;
                if (btnPulang) btnPulang.disabled = true;
            }
            [btnMasuk, btnPulang].forEach(b => { if (b) b.classList.toggle('opacity-40', b.disabled); });
        }

        function renderDaftarPresensiSemua() {
            const container = document.getElementById('listPresensiSemua');
            if (!container) return;
            const todayStr = new Date().toISOString().slice(0, 10);
            let listHariIni = masterPresensi.filter(p => getTanggalDariString(p.Tanggal) === todayStr);
            if (listHariIni.length === 0) {
                container.innerHTML = `<p class="text-[11px] text-blue-400 text-center py-3 italic">Belum ada pegawai yang absen hari ini.</p>`;
                return;
            }
            container.innerHTML = listHariIni.map(p => `
                <div class="flex justify-between items-center bg-slate-900 border border-blue-800/60 p-2.5 rounded-xl text-xs">
                    <span class="font-semibold text-white">${escapeHtml(p.Username) || '-'}</span>
                    <span class="text-[10px] text-blue-300">Masuk ${escapeHtml(p.Jam_Masuk) || '-'} &middot; Pulang ${escapeHtml(p.Jam_Pulang) || '-'}</span>
                </div>`).join('');
        }

        async function absenMasuk() {
            const username = localStorage.getItem('cox_kasir');
            if (!username) return;
            const idHariIni = buatIdPresensiHariIni(username);
            if (masterPresensi.some(p => String(p.ID_Presensi) === idHariIni)) { alert('Anda sudah tercatat absen masuk hari ini.'); return; }

            const now = new Date();
            const jamStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            const tglStr = now.toISOString().slice(0, 10);

            const btn = document.getElementById('btnAbsenMasuk'); btn.disabled = true; const original = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...';

            const payload = { sheetName: "Presensi", action: "insert", rowData: { "ID_Presensi": idHariIni, "Username": username, "Tanggal": tglStr, "Jam_Masuk": jamStr, "Jam_Pulang": "", "Status": "Masuk" } };
            try {
                await kirimKeApiScript(payload);
                masterPresensi.push({ ID_Presensi: idHariIni, Username: username, Tanggal: tglStr, Jam_Masuk: jamStr, Jam_Pulang: "", Status: "Masuk" });
                renderStatusPresensiHariIni(); renderDaftarPresensiSemua();
                alert(`Absen masuk berhasil dicatat pukul ${jamStr}.`);
            } catch (err) {
                alert(`Gagal mencatat absen masuk: ${err.message}`);
                btn.innerHTML = original; btn.disabled = false;
            }
        }

        async function absenPulang() {
            const username = localStorage.getItem('cox_kasir');
            if (!username) return;
            const idHariIni = buatIdPresensiHariIni(username);
            const rec = masterPresensi.find(p => String(p.ID_Presensi) === idHariIni);
            if (!rec) { alert('Anda belum melakukan absen masuk hari ini.'); return; }
            if (rec.Jam_Pulang) { alert('Anda sudah tercatat absen pulang hari ini.'); return; }

            const now = new Date();
            const jamStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

            const btn = document.getElementById('btnAbsenPulang'); btn.disabled = true; const original = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...';

            const payload = { sheetName: "Presensi", action: "update", idField: "ID_Presensi", id: idHariIni, updateData: { "Jam_Pulang": jamStr, "Status": "Pulang" } };
            try {
                await kirimKeApiScript(payload);
                rec.Jam_Pulang = jamStr; rec.Status = "Pulang";
                renderStatusPresensiHariIni(); renderDaftarPresensiSemua();
                alert(`Absen pulang berhasil dicatat pukul ${jamStr}.`);
            } catch (err) {
                alert(`Gagal mencatat absen pulang: ${err.message}`);
                btn.innerHTML = original; btn.disabled = false;
            }
        }

        // ==========================================
        // PELANGGAN & POIN LOYALITAS
        // ==========================================
        // Poin dihitung LANGSUNG dari riwayat transaksi (bukan disimpan di
        // sheet terpisah) supaya selalu akurat dan tidak bisa "diakali" lewat
        // API insert/update biasa. Ganti POIN_PER_RUPIAH sesuai kebijakan
        // toko Anda.
        const POIN_PER_RUPIAH = 10000; // 1 poin tiap kelipatan Rp 10.000 dari transaksi Selesai/Diambil

        function hitungPoinPelanggan(noHp) {
            let total = masterTransaksi
                .filter(t => String(t.No_HP || '').trim() === String(noHp || '').trim())
                .filter(t => t.Status && ['selesai', 'diambil'].includes(String(t.Status).toLowerCase()))
                .reduce((sum, t) => sum + (parseFloat(t.Total_Harga) || 0), 0);
            return Math.floor(total / POIN_PER_RUPIAH);
        }

        function bukaModalPelanggan() {
            document.getElementById('inputCariPelanggan').value = '';
            tutupDetailPelanggan();
            renderDaftarPelanggan();
            const overlay = document.getElementById('modalPelangganOverlay'), content = document.getElementById('modalPelangganContent');
            overlay.classList.remove('hidden'); setTimeout(() => { overlay.classList.remove('opacity-0'); content.classList.add('active'); }, 10);
        }
        function tutupModalPelanggan() {
            const overlay = document.getElementById('modalPelangganOverlay'), content = document.getElementById('modalPelangganContent');
            content.classList.remove('active'); overlay.classList.add('opacity-0');
            setTimeout(() => overlay.classList.add('hidden'), 300);
        }

        function renderDaftarPelanggan() {
            const container = document.getElementById('listPelangganContainer');
            const keyword = document.getElementById('inputCariPelanggan').value.trim().toLowerCase();
            let list = masterPelanggan.filter(p => {
                if (!keyword) return true;
                return String(p.Nama || '').toLowerCase().includes(keyword) || String(p.No_HP || '').includes(keyword);
            });
            list = [...list].sort((a, b) => (parseInt(b.Total_Order) || 0) - (parseInt(a.Total_Order) || 0));

            if (list.length === 0) {
                container.innerHTML = `<p class="text-[11px] text-blue-400 text-center italic py-6">Tidak ada pelanggan ditemukan.</p>`;
                return;
            }
            container.innerHTML = list.map((p) => {
                let idx = masterPelanggan.indexOf(p);
                let poin = hitungPoinPelanggan(p.No_HP);
                return `
                <div onclick="bukaDetailPelanggan(${idx})" class="flex justify-between items-center bg-cox-card border border-blue-800/50 p-3 rounded-xl text-xs cursor-pointer hover:border-cox-cyan transition">
                    <div>
                        <p class="font-bold text-white">${escapeHtml(p.Nama) || 'Tanpa Nama'}</p>
                        <p class="text-[10px] text-blue-300 mt-0.5">${escapeHtml(p.No_HP) || '-'} &middot; ${p.Total_Order || 0}x order</p>
                    </div>
                    <span class="text-[10px] bg-cox-cyan/15 text-cox-cyan px-2 py-1 rounded-full font-bold"><i class="fa-solid fa-star"></i> ${poin} poin</span>
                </div>`;
            }).join('');
        }

        function bukaDetailPelanggan(idx) {
            const p = masterPelanggan[idx];
            if (!p) return;
            document.getElementById('listViewPelanggan').classList.add('hidden');
            document.getElementById('detailViewPelanggan').classList.remove('hidden');
            document.getElementById('judulModalPelanggan').innerText = p.Nama || 'Detail Pelanggan';

            let riwayat = masterTransaksi
                .filter(t => String(t.No_HP || '').trim() === String(p.No_HP || '').trim())
                .sort((a, b) => String(b.Tanggal_Masuk || '').localeCompare(String(a.Tanggal_Masuk || '')));
            let poin = hitungPoinPelanggan(p.No_HP);
            let totalBelanja = riwayat
                .filter(t => t.Status && ['selesai', 'diambil'].includes(String(t.Status).toLowerCase()))
                .reduce((s, t) => s + (parseFloat(t.Total_Harga) || 0), 0);

            let riwayatHtml = riwayat.length === 0 ? `<p class="text-[11px] text-blue-400 text-center italic py-4">Belum ada riwayat pesanan.</p>` :
                riwayat.map(t => `
                    <div class="flex justify-between items-center bg-slate-900 border border-blue-800/50 p-2.5 rounded-xl text-[11px]">
                        <div>
                            <p class="font-mono text-blue-300">${escapeHtml(t.No_Invoice)}</p>
                            <p class="text-blue-400 mt-0.5">${escapeHtml(formatWaktuIndo(t.Tanggal_Masuk))}</p>
                        </div>
                        <div class="text-right">
                            <p class="font-bold text-cox-cyan">Rp ${parseFloat(t.Total_Harga || 0).toLocaleString('id-ID')}</p>
                            <p class="text-[9px] text-blue-400 mt-0.5 uppercase">${escapeHtml(t.Status)}</p>
                        </div>
                    </div>`).join('');

            document.getElementById('isiDetailPelanggan').innerHTML = `
                <div class="bg-cox-card rounded-2xl p-4 border border-blue-800/50 flex justify-between items-center">
                    <div>
                        <p class="text-[10px] text-blue-300">${escapeHtml(p.No_HP)}</p>
                        <p class="text-xs text-blue-300 mt-1">Total belanja (selesai): <span class="text-white font-semibold">Rp ${totalBelanja.toLocaleString('id-ID')}</span></p>
                    </div>
                    <span class="text-xs bg-cox-cyan/15 text-cox-cyan px-3 py-1.5 rounded-full font-bold"><i class="fa-solid fa-star"></i> ${poin} poin</span>
                </div>
                <p class="text-[9px] text-blue-400 italic px-1">1 poin didapat tiap kelipatan Rp 10.000 dari transaksi berstatus Selesai/Diambil. Penukaran poin dilakukan manual oleh kasir lewat kolom Diskon saat membuat pesanan baru.</p>
                <div>
                    <h4 class="text-xs font-bold text-blue-200 mb-2">Riwayat Pesanan</h4>
                    <div class="space-y-2">${riwayatHtml}</div>
                </div>
            `;
        }

        function tutupDetailPelanggan() {
            document.getElementById('detailViewPelanggan').classList.add('hidden');
            document.getElementById('listViewPelanggan').classList.remove('hidden');
        }

        // ==========================================
        // RESOLVE PLACEHOLDER (dipakai bersama oleh WA, Nota HTML, PDF, Bluetooth)
        // ==========================================
        function bangunDataPlaceholder(trx, layananMultiBaris) {
            const daftarLayananArr = (trx.Layanan || '').split(',').map(s => s.trim()).filter(Boolean);
            return {
                '[NAMA]': trx.Nama_Pelanggan || '-',
                '[NOTA]': trx.No_Invoice || '-',
                '[TOTAL]': 'Rp ' + parseFloat(trx.Total_Harga || 0).toLocaleString('id-ID'),
                '[TGL_MASUK]': formatWaktuIndo(trx.Tanggal_Masuk),
                '[TGL_SELESAI]': formatWaktuIndo(trx.Tanggal_Selesai),
                '[LAYANAN]': layananMultiBaris ? (daftarLayananArr.map(s => `- ${s}`).join('\n') || '-') : (daftarLayananArr.join(', ') || '-'),
                '[METODE]': trx.Metode_Pembayaran || trx.Metode || trx.Pembayaran || '-',
                '[POIN]': String(hitungPoinPelanggan(trx.No_HP)),
                '[TOKO]': ambilNamaToko(),
                '[ALAMAT]': ambilAlamatToko()
            };
        }

        function isiPlaceholder(template, trx, layananMultiBaris) {
            const data = bangunDataPlaceholder(trx, layananMultiBaris);
            let hasil = template || '';
            for (const key in data) hasil = hasil.split(key).join(data[key]);
            return hasil;
        }

        // Parsing konvensi sederhana untuk baris template Nota:
        // "^^..." = rata tengah, "**...**" = tebal (bisa digabung).
        function parseBarisNota(rawBaris) {
            let baris = rawBaris, tengah = false, tebal = false;
            if (baris.startsWith('^^')) { tengah = true; baris = baris.slice(2); }
            if (baris.startsWith('**') && baris.endsWith('**') && baris.length >= 4) { tebal = true; baris = baris.slice(2, -2); }
            return { teks: baris, tengah, tebal };
        }

        // ==========================================
        // PENYIMPANAN TEMPLATE WA (Sheet "Template_WA" -- tersinkron ke
        // SEMUA perangkat/kasir, BUKAN localStorage lagi)
        // ==========================================
        // Sebelumnya template WA disimpan di localStorage, yang artinya
        // per perangkat/browser -- kalau dibuat di satu HP tapi dites di
        // HP lain, template barunya memang belum pernah "sampai" ke sana.
        // Sekarang disimpan di Sheet lewat masterTemplateWa (diisi saat
        // sinkronisasiData()), jadi otomatis sama di semua perangkat.
        function ambilDaftarTemplateWa() {
            if (masterTemplateWa && masterTemplateWa.length > 0) return masterTemplateWa;
            return DEFAULT_WA_TEMPLATES; // tampilan awal sebelum ada yang benar-benar tersimpan
        }
        // ==========================================
        // PENYIMPANAN TEMPLATE NOTA & IDENTITAS TOKO (Sheet "Template_Toko"
        // -- tersinkron ke SEMUA perangkat/kasir, sama seperti Template_WA)
        // ==========================================
        // Disimpan sebagai SATU baris konfigurasi (Kunci="config", Nilai=
        // JSON berisi nama toko/alamat/susunan nota) supaya cukup SATU kali
        // insert/update saat disimpan, bukan tiga panggilan API terpisah.
        function ambilKonfigTokoTersimpan() {
            if (masterTemplateToko && masterTemplateToko.length > 0) {
                try { return JSON.parse(masterTemplateToko[0].Nilai); } catch (e) { /* data rusak/kosong -- fallback di bawah */ }
            }
            return null;
        }
        function ambilNamaToko() {
            const cfg = ambilKonfigTokoTersimpan();
            return (cfg && cfg.toko_nama) || 'COX LAUNDRY';
        }
        function ambilAlamatToko() {
            const cfg = ambilKonfigTokoTersimpan();
            return (cfg && cfg.toko_alamat) || 'Jl. Contoh Alamat';
        }
        function ambilTemplateNotaTeks() {
            const cfg = ambilKonfigTokoTersimpan();
            return (cfg && cfg.nota_template) || DEFAULT_NOTA_TEMPLATE;
        }

        // ==========================================
        // KIRIM WA -- otomatis tawarkan pilihan kalau template lebih dari satu
        // ==========================================
        function kirimWA(noInvoice) {
            const trx = masterTransaksi.find(t => String(t.No_Invoice) === String(noInvoice));
            if (!trx) { alert('Data transaksi tidak ditemukan. Coba sinkronisasi ulang.'); return; }

            const daftarTemplate = ambilDaftarTemplateWa();
            if (daftarTemplate.length === 1) { kirimWaDenganTemplate(trx, daftarTemplate[0]); return; }
            bukaModalPilihTemplate(trx, daftarTemplate);
        }

        // Normalisasi nomor HP ke format internasional (62xxx) untuk link
        // wa.me. Dibuat tahan terhadap beberapa kasus nyata:
        //  - Sudah format 62xxx -> dibiarkan.
        //  - Format lokal 0xxx -> 0 diganti 62.
        //  - 0 di depan SUDAH HILANG (kasus paling umum: kolom No_HP di
        //    Spreadsheet otomatis terdeteksi sebagai tipe Angka, dan angka
        //    tidak bisa punya 0 di depan -- "081234567890" tersimpan
        //    sebagai 81234567890) -- tetap ditambahkan 62 di depan, karena
        //    nomor HP Indonesia yang valid akan diawali 8 pada titik ini.
        //  - Ada karakter format lain (spasi, strip, tanda +) -- dibuang dulu.
        function normalisasiNoHp(nomor) {
            let n = String(nomor || '').trim().replace(/\D/g, ''); // buang semua selain digit
            if (!n) return '';
            if (n.startsWith('62')) return n;
            if (n.startsWith('0')) return '62' + n.substring(1);
            return '62' + n; // asumsikan 0 di depan sudah hilang (lihat catatan di atas)
        }

        function kirimWaDenganTemplate(trx, template) {
            const noHp = normalisasiNoHp(trx.No_HP);
            if (!noHp) { alert('Nomor HP pelanggan ini kosong/tidak valid, tidak bisa kirim WA.'); return; }
            const teks = isiPlaceholder(template.Isi, trx, false);
            window.open(`https://wa.me/${noHp}?text=${encodeURIComponent(teks)}`, '_blank');
        }

        function bukaModalPilihTemplate(trx, daftarTemplate) {
            const container = document.getElementById('listPilihTemplateWa');
            container.innerHTML = daftarTemplate.map((t, idx) => `
                <button onclick="pilihTemplateUntukKirim(${idx})" class="w-full text-left bg-cox-card border border-blue-800 hover:border-cox-cyan p-3 rounded-xl transition">
                    <p class="text-sm font-bold text-white">${escapeHtml(t.Nama)}</p>
                    <p class="text-[10px] text-blue-300 mt-1 line-clamp-2">${escapeHtml(t.Isi.slice(0, 90))}${t.Isi.length > 90 ? '...' : ''}</p>
                </button>`).join('');
            _trxUntukKirimWa = trx;
            _daftarTemplateUntukKirimWa = daftarTemplate;

            const overlay = document.getElementById('modalPilihTemplateOverlay'), content = document.getElementById('modalPilihTemplateContent');
            overlay.classList.remove('hidden'); setTimeout(() => { overlay.classList.remove('opacity-0'); content.classList.add('active'); }, 10);
        }
        function tutupModalPilihTemplate() {
            const overlay = document.getElementById('modalPilihTemplateOverlay'), content = document.getElementById('modalPilihTemplateContent');
            content.classList.remove('active'); overlay.classList.add('opacity-0');
            setTimeout(() => overlay.classList.add('hidden'), 300);
        }
        function pilihTemplateUntukKirim(idx) {
            tutupModalPilihTemplate();
            kirimWaDenganTemplate(_trxUntukKirimWa, _daftarTemplateUntukKirimWa[idx]);
        }

        // --- Prompt kirim WA setelah pesanan ditandai selesai ---
        // Dipisah dari confirm() supaya window.open() (dipanggil lewat
        // kirimWA -> kirimWaDenganTemplate) selalu terjadi tepat saat
        // tombol di modal ini di-tap, bukan setelah proses async lain --
        // lihat catatan di updateStatus().
        let _invoiceUntukPromptWa = null;

        function tampilkanPromptKirimWa(invoice) {
            _invoiceUntukPromptWa = invoice;
            document.getElementById('teksPromptWa').innerText = `Kirim notifikasi WhatsApp untuk pesanan ${invoice} sekarang?`;
            const overlay = document.getElementById('modalPromptWaOverlay'), content = document.getElementById('modalPromptWaContent');
            overlay.classList.remove('hidden'); setTimeout(() => { overlay.classList.remove('opacity-0'); content.classList.add('active'); }, 10);
        }
        function tutupPromptKirimWa() {
            const overlay = document.getElementById('modalPromptWaOverlay'), content = document.getElementById('modalPromptWaContent');
            content.classList.remove('active'); overlay.classList.add('opacity-0');
            setTimeout(() => overlay.classList.add('hidden'), 300);
        }
        function konfirmasiKirimWaDariPrompt() {
            tutupPromptKirimWa();
            if (_invoiceUntukPromptWa) kirimWA(_invoiceUntukPromptWa);
        }

        // ==========================================
        // MODAL KELOLA TEMPLATE (dibuka dari tile "Template" di Beranda)
        // ==========================================
        function bukaModalTemplate() {
            gantiTabTemplate('wa', document.querySelector('.tab-template-btn'));
            renderListTemplateWa();
            document.getElementById('inputNamaTokoTemplate').value = ambilNamaToko();
            document.getElementById('inputAlamatTokoTemplate').value = ambilAlamatToko();
            document.getElementById('inputTemplateNota').value = ambilTemplateNotaTeks();
            renderChipPlaceholder('chipPlaceholderWa', 'inputIsiTemplateWa');
            renderChipPlaceholder('chipPlaceholderNota', 'inputTemplateNota');
            perbaruiPreviewNota();

            const overlay = document.getElementById('modalTemplateOverlay'), content = document.getElementById('modalTemplateContent');
            overlay.classList.remove('hidden'); setTimeout(() => { overlay.classList.remove('opacity-0'); content.classList.add('active'); }, 10);
        }
        function tutupModalTemplate() {
            const overlay = document.getElementById('modalTemplateOverlay'), content = document.getElementById('modalTemplateContent');
            content.classList.remove('active'); overlay.classList.add('opacity-0');
            setTimeout(() => overlay.classList.add('hidden'), 300);
        }

        function gantiTabTemplate(tab, btnEl) {
            document.querySelectorAll('.tab-template-btn').forEach(b => b.className = "tab-template-btn flex-1 py-2 rounded-t-lg text-xs font-semibold text-blue-300 transition");
            if (btnEl) btnEl.className = "tab-template-btn flex-1 py-2 rounded-t-lg text-xs font-semibold bg-cox-cyan/20 text-cox-cyan transition";

            document.getElementById('tabWaList').classList.add('hidden');
            document.getElementById('tabWaEditor').classList.add('hidden');
            document.getElementById('tabNota').classList.add('hidden');

            if (tab === 'wa') document.getElementById('tabWaList').classList.remove('hidden');
            else document.getElementById('tabNota').classList.remove('hidden');
        }

        function renderChipPlaceholder(containerId, targetTextareaId) {
            const container = document.getElementById(containerId);
            container.innerHTML = DAFTAR_PLACEHOLDER_TEMPLATE.map(p => `
                <button type="button" onclick="sisipkanPlaceholder('${targetTextareaId}', '${p.token}')" class="text-[10px] bg-slate-800 border border-blue-800 text-blue-300 hover:text-cox-cyan hover:border-cox-cyan px-2 py-1 rounded-full transition">+ ${p.label}</button>`).join('');
        }

        function sisipkanPlaceholder(textareaId, placeholder) {
            const ta = document.getElementById(textareaId);
            const mulai = ta.selectionStart ?? ta.value.length, akhir = ta.selectionEnd ?? ta.value.length;
            const teks = ta.value;
            ta.value = teks.slice(0, mulai) + placeholder + teks.slice(akhir);
            const posisiBaru = mulai + placeholder.length;
            ta.focus(); ta.setSelectionRange(posisiBaru, posisiBaru);
            if (textareaId === 'inputIsiTemplateWa') perbaruiPreviewWa();
            else if (textareaId === 'inputTemplateNota') perbaruiPreviewNota();
        }

        // --- Tab WhatsApp: daftar & editor ---
        function renderListTemplateWa() {
            const list = ambilDaftarTemplateWa();
            const container = document.getElementById('listTemplateWa');
            container.innerHTML = list.map((t, idx) => `
                <button onclick="mulaiEditTemplateWa(${idx})" class="w-full text-left bg-cox-card border border-blue-800 hover:border-cox-cyan p-3 rounded-xl transition flex justify-between items-center">
                    <div class="flex-1 pr-2">
                        <p class="text-sm font-bold text-white">${escapeHtml(t.Nama)}</p>
                        <p class="text-[10px] text-blue-300 mt-0.5 line-clamp-1">${escapeHtml(t.Isi.slice(0, 60))}${t.Isi.length > 60 ? '...' : ''}</p>
                    </div>
                    <i class="fa-solid fa-chevron-right text-blue-400"></i>
                </button>`).join('');
        }

        function mulaiTambahTemplateWa() {
            document.getElementById('editTemplateWaId').value = '';
            document.getElementById('inputNamaTemplateWa').value = '';
            document.getElementById('inputIsiTemplateWa').value = '';
            document.getElementById('btnHapusTemplateWa').classList.add('hidden');
            perbaruiPreviewWa();
            document.getElementById('tabWaList').classList.add('hidden');
            document.getElementById('tabWaEditor').classList.remove('hidden');
        }

        function mulaiEditTemplateWa(idx) {
            const list = ambilDaftarTemplateWa();
            const t = list[idx];
            if (!t) return;
            document.getElementById('editTemplateWaId').value = t.ID_Template;
            document.getElementById('inputNamaTemplateWa').value = t.Nama;
            document.getElementById('inputIsiTemplateWa').value = t.Isi;
            // Tombol Hapus cuma muncul untuk template yang BENAR-BENAR
            // sudah tersimpan di Sheet -- template bawaan yang belum pernah
            // disimpan tidak punya apa-apa untuk dihapus di server.
            const tersimpanDiSheet = masterTemplateWa.some(m => m.ID_Template === t.ID_Template);
            document.getElementById('btnHapusTemplateWa').classList.toggle('hidden', !tersimpanDiSheet);
            perbaruiPreviewWa();
            document.getElementById('tabWaList').classList.add('hidden');
            document.getElementById('tabWaEditor').classList.remove('hidden');
        }

        function kembaliKeListTemplateWa() {
            document.getElementById('tabWaEditor').classList.add('hidden');
            document.getElementById('tabWaList').classList.remove('hidden');
            renderListTemplateWa();
        }

        async function simpanTemplateWa() {
            if (!API_URL) { alert('URL Apps Script belum diisi!'); return; }
            const nama = document.getElementById('inputNamaTemplateWa').value.trim();
            const isi = document.getElementById('inputIsiTemplateWa').value.trim();
            const idLama = document.getElementById('editTemplateWaId').value;
            if (!nama || !isi) { alert('Nama dan isi template wajib diisi!'); return; }

            // Template ini "nyata" (tersimpan di Sheet) kalau ID-nya memang
            // ada di masterTemplateWa. Kalau tidak (mis. sedang "mengedit"
            // salah satu template bawaan yang belum pernah disimpan),
            // perlakukan sebagai simpan baru, bukan update.
            const templateNyata = masterTemplateWa.find(t => t.ID_Template === idLama);
            const isEdit = !!templateNyata;

            const btnSimpan = document.getElementById('btnSimpanTemplateWa');
            const originalHtml = btnSimpan.innerHTML;
            btnSimpan.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; btnSimpan.disabled = true;

            try {
                if (isEdit) {
                    await kirimKeApiScript({
                        sheetName: "Template_WA", action: "update", idField: "ID_Template", id: idLama,
                        updateData: { "Nama": nama, "Isi": isi }
                    });
                    templateNyata.Nama = nama; templateNyata.Isi = isi;
                } else {
                    const idBaru = 'tpl' + Date.now();
                    await kirimKeApiScript({
                        sheetName: "Template_WA", action: "insert",
                        rowData: { "ID_Template": idBaru, "Nama": nama, "Isi": isi }
                    });
                    masterTemplateWa.push({ ID_Template: idBaru, Nama: nama, Isi: isi });
                }
                alert(`Template "${nama}" berhasil disimpan!`);
                kembaliKeListTemplateWa();
            } catch (err) {
                alert(`Gagal menyimpan template: ${err.message}`);
            } finally {
                btnSimpan.innerHTML = originalHtml; btnSimpan.disabled = false;
            }
        }

        async function hapusTemplateWaAktif() {
            const idLama = document.getElementById('editTemplateWaId').value;
            if (!idLama) return;
            const templateNyata = masterTemplateWa.find(t => t.ID_Template === idLama);
            if (!templateNyata) { kembaliKeListTemplateWa(); return; } // template bawaan yang belum pernah disimpan, tidak ada yang perlu dihapus di server

            if (masterTemplateWa.length <= 1) { alert('Minimal harus ada 1 template WhatsApp.'); return; }
            if (!confirm('Hapus template ini?')) return;

            try {
                await kirimKeApiScript({ sheetName: "Template_WA", action: "delete", idField: "ID_Template", id: idLama });
                masterTemplateWa = masterTemplateWa.filter(t => t.ID_Template !== idLama);
                kembaliKeListTemplateWa();
            } catch (err) {
                alert(`Gagal menghapus template: ${err.message}`);
            }
        }

        function perbaruiPreviewWa() {
            const isi = document.getElementById('inputIsiTemplateWa').value;
            document.getElementById('previewTemplateWa').innerText = isiPlaceholder(isi, CONTOH_TRX_PREVIEW, false);
        }

        // --- Tab Nota ---
        function perbaruiPreviewNota() {
            const template = document.getElementById('inputTemplateNota').value;
            const teksResolved = isiPlaceholder(template, CONTOH_TRX_PREVIEW, true);
            document.getElementById('previewTemplateNota').innerHTML = teksResolved.split('\n').map(rawBaris => {
                const { teks, tengah, tebal } = parseBarisNota(rawBaris);
                const style = `${tengah ? 'text-align:center;' : ''}${tebal ? 'font-weight:bold;' : ''}`;
                return `<div style="${style}">${escapeHtml(teks) || '&nbsp;'}</div>`;
            }).join('');
        }

        function resetTemplateNotaDefault() {
            if (!confirm('Kembalikan susunan nota ke bawaan aplikasi? Perubahan yang belum disimpan akan hilang.')) return;
            document.getElementById('inputTemplateNota').value = DEFAULT_NOTA_TEMPLATE;
            perbaruiPreviewNota();
        }

        async function simpanTemplateNota_UI() {
            if (!API_URL) { alert('URL Apps Script belum diisi!'); return; }
            const namaToko = document.getElementById('inputNamaTokoTemplate').value.trim() || 'COX LAUNDRY';
            const alamatToko = document.getElementById('inputAlamatTokoTemplate').value.trim() || 'Jl. Contoh Alamat';
            const templateNota = document.getElementById('inputTemplateNota').value;

            const konfigBaru = { toko_nama: namaToko, toko_alamat: alamatToko, nota_template: templateNota };
            const nilaiJson = JSON.stringify(konfigBaru);
            // Sudah ada baris config di Sheet? -> update. Belum? -> insert.
            const sudahAda = masterTemplateToko && masterTemplateToko.length > 0;

            const btn = document.getElementById('btnSimpanTemplateNota');
            const originalHtml = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; btn.disabled = true;

            try {
                if (sudahAda) {
                    await kirimKeApiScript({
                        sheetName: "Template_Toko", action: "update", idField: "Kunci", id: "config",
                        updateData: { "Nilai": nilaiJson }
                    });
                    masterTemplateToko[0].Nilai = nilaiJson;
                } else {
                    await kirimKeApiScript({
                        sheetName: "Template_Toko", action: "insert",
                        rowData: { "Kunci": "config", "Nilai": nilaiJson }
                    });
                    masterTemplateToko = [{ Kunci: "config", Nilai: nilaiJson }];
                }
                alert('Template nota berhasil disimpan!');
            } catch (err) {
                alert(`Gagal menyimpan template nota: ${err.message}`);
            } finally {
                btn.innerHTML = originalHtml; btn.disabled = false;
            }
        }

        // ==========================================
        // CETAK VIA BLUETOOTH (ESC/POS, printer thermal BLE)
        // ==========================================
        // PENTING -- baca ini kalau printer tidak mau tersambung:
        // Web Bluetooth di browser HANYA bisa bicara dengan printer
        // Bluetooth Low Energy (BLE). Banyak printer thermal murah justru
        // pakai Bluetooth Classic (SPP) -- itu TIDAK BISA disambungkan lewat
        // browser sama sekali, ini keterbatasan Web Bluetooth API, bukan
        // bug di kode ini. Tandanya: kalau nama printer Anda tidak muncul
        // sama sekali di jendela pemilihan perangkat saat klik "Sambungkan",
        // printer Anda kemungkinan Classic SPP -- gunakan tombol "Nota"
        // (cetak lewat dialog print biasa) sebagai gantinya.
        //
        // Kalau printer BISA tersambung tapi tidak ada yang tercetak: itu
        // biasanya karena UUID service/characteristic tebakan kita tidak
        // cocok dengan chip Bluetooth di printer Anda. Daripada menebak
        // satu UUID saja, kode di bawah ini MENCOBA BEBERAPA kandidat UUID
        // paling umum dipakai printer thermal BLE murah secara berurutan
        // (termasuk chip "ISSC UART" yang dipakai sangat banyak printer
        // sejenis Kassen MT-200/Goojprt/YHK dkk), lalu memakai yang pertama
        // ditemukan dan bisa ditulis data. Kalau SEMUA kandidat gagal, pakai
        // tombol "Diagnostik Printer BT" di bawah untuk melihat UUID asli
        // printer Anda, lalu tambahkan ke daftar BT_KANDIDAT_SERVICE_UUID.
        const BT_KANDIDAT_SERVICE_UUID = [
            '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Chip "ISSC UART" -- paling umum dipakai printer thermal BLE murah/OEM (termasuk kelas Kassen MT-200)
            '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART Service (NUS) -- umum di modul BLE berbasis nRF
            0xff00,
            0xffe0,
            0x18f0
        ];

        let btPrinterDevice = null;
        let btPrinterCharacteristic = null;

        async function sambungkanPrinterBT() {
            if (!navigator.bluetooth) {
                alert('Browser ini tidak mendukung Web Bluetooth. Gunakan Chrome/Edge terbaru di Android atau desktop (bukan Safari/iOS).');
                return;
            }
            try {
                btPrinterDevice = await navigator.bluetooth.requestDevice({
                    acceptAllDevices: true,
                    optionalServices: BT_KANDIDAT_SERVICE_UUID
                });
                const server = await btPrinterDevice.gatt.connect();

                btPrinterCharacteristic = null;
                for (const svcUuid of BT_KANDIDAT_SERVICE_UUID) {
                    try {
                        const service = await server.getPrimaryService(svcUuid);
                        const chars = await service.getCharacteristics();
                        const tulisabel = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
                        if (tulisabel) { btPrinterCharacteristic = tulisabel; break; }
                    } catch (eSvc) { /* service ini tidak ada di printer -- coba kandidat berikutnya */ }
                }

                if (!btPrinterCharacteristic) {
                    throw new Error('Tersambung, tapi tidak menemukan jalur tulis data yang cocok dari daftar UUID yang dikenal. Coba tombol "Diagnostik Printer BT" untuk melihat UUID asli printer Anda.');
                }

                btPrinterDevice.addEventListener('gattserverdisconnected', () => {
                    btPrinterCharacteristic = null;
                    perbaruiStatusPrinterBT();
                });
                alert(`Berhasil tersambung ke printer: ${btPrinterDevice.name || 'printer'}`);
                perbaruiStatusPrinterBT();
            } catch (err) {
                if (err.name === 'NotFoundError') return; // Pengguna membatalkan pemilihan, tidak perlu dianggap error.
                alert(`Gagal tersambung ke printer: ${err.message}\n\nKemungkinan printer Anda pakai Bluetooth Classic (SPP), bukan BLE -- lihat catatan di panel Pengaturan.`);
                perbaruiStatusPrinterBT();
            }
        }

        // Alat bantu troubleshooting: sambungkan lalu tampilkan SEMUA
        // service & characteristic yang diizinkan browser untuk diakses,
        // supaya Anda (atau saya) bisa melihat UUID asli printer Anda kalau
        // semua kandidat di atas ternyata tidak cocok.
        async function diagnosaPrinterBT() {
            if (!navigator.bluetooth) {
                alert('Browser ini tidak mendukung Web Bluetooth.');
                return;
            }
            try {
                const device = await navigator.bluetooth.requestDevice({
                    acceptAllDevices: true,
                    optionalServices: BT_KANDIDAT_SERVICE_UUID
                });
                const server = await device.gatt.connect();
                const services = await server.getPrimaryServices();
                let hasil = `Printer: ${device.name || '(tanpa nama)'}\n\n`;
                for (const service of services) {
                    hasil += `Service: ${service.uuid}\n`;
                    const chars = await service.getCharacteristics();
                    for (const c of chars) {
                        let props = [];
                        if (c.properties.write) props.push('write');
                        if (c.properties.writeWithoutResponse) props.push('writeNoResponse');
                        if (c.properties.notify) props.push('notify');
                        if (c.properties.read) props.push('read');
                        hasil += `  - Characteristic: ${c.uuid} [${props.join(', ') || '-'}]\n`;
                    }
                }
                console.log(hasil);
                alert(hasil + '\n\nDaftar ini juga dicetak ke Console browser (F12) kalau ingin disalin dan dikirimkan untuk dibantu diagnosa lebih lanjut.\n\nCatatan: kalau daftar di atas KOSONG (tidak ada Service sama sekali), berarti UUID service printer Anda tidak ada di daftar kandidat kita -- perlu ditambahkan manual dulu sebelum bisa terlihat di sini.');
            } catch (err) {
                if (err.name === 'NotFoundError') return;
                alert(`Gagal diagnosa: ${err.message}`);
            }
        }

        function perbaruiStatusPrinterBT() {
            const statusEl = document.getElementById('statusPrinterBT');
            if (!statusEl) return;
            if (btPrinterDevice && btPrinterDevice.gatt && btPrinterDevice.gatt.connected) {
                statusEl.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-400"></i> Tersambung: ${escapeHtml(btPrinterDevice.name || 'Printer')}`;
            } else {
                statusEl.innerHTML = `<i class="fa-solid fa-circle-xmark text-blue-400"></i> Belum tersambung`;
            }
        }

        // Susun perintah ESC/POS mentah untuk satu nota (setara isi cetakNota,
        // tapi berbentuk byte, bukan HTML).
        function buatPerintahEscPosNota(trx) {
            const ESC = 0x1B;
            let bytes = [];
            const teksBytes = (s) => Array.from(new TextEncoder().encode(String(s)));
            const tambah = (arr) => { bytes = bytes.concat(arr); };

            const teksResolved = isiPlaceholder(ambilTemplateNotaTeks(), trx, true);

            tambah([ESC, 0x40]); // Inisialisasi printer

            teksResolved.split('\n').forEach(rawBaris => {
                const { teks, tengah, tebal } = parseBarisNota(rawBaris);
                tambah([ESC, 0x61, tengah ? 0x01 : 0x00]);
                tambah([ESC, 0x45, tebal ? 0x01 : 0x00]);
                tambah(teksBytes(teks + '\n'));
            });
            tambah([ESC, 0x45, 0x00]); // Pastikan bold mati di akhir
            tambah(teksBytes('\n\n'));

            return new Uint8Array(bytes);
        }

        // ==========================================
        // PDF NOTA (untuk dibagikan/dicetak lewat aplikasi pihak ketiga
        // seperti Thermer -- solusi utama untuk printer Bluetooth Classic
        // (SPP) yang TIDAK bisa disambungkan lewat Web Bluetooth browser)
        // ==========================================
        // Thermer & aplikasi print Bluetooth sejenis mendukung menerima PDF
        // lewat menu "Bagikan" Android. Kita buat PDF pas ukuran kertas
        // thermal (58mm) di sini, lalu langsung tawarkan lewat Web Share
        // API -- kalau didukung perangkat, menu Bagikan Android akan
        // langsung terbuka dan Anda tinggal pilih Thermer.
        function buatPdfNota(trx) {
            const { jsPDF } = window.jspdf;
            const teksResolved = isiPlaceholder(ambilTemplateNotaTeks(), trx, true);
            const barisArr = teksResolved.split('\n');

            // Perkirakan tinggi kertas dari jumlah baris konten, supaya PDF
            // tidak menyisakan banyak spasi kosong.
            const tinggiMm = Math.max(40, 16 + barisArr.length * 4.3);

            const doc = new jsPDF({ unit: 'mm', format: [58, tinggiMm] });
            const tengahX = 29;
            let y = 8;

            barisArr.forEach(rawBaris => {
                const { teks, tengah, tebal } = parseBarisNota(rawBaris);
                doc.setFont('courier', tebal ? 'bold' : 'normal');
                doc.setFontSize(tebal ? 9.5 : 8);
                if (tengah) doc.text(teks, tengahX, y, { align: 'center' });
                else doc.text(teks, 2, y);
                y += 4.3;
            });

            return doc;
        }

        function unduhNotaPdf(noInvoice) {
            const trx = masterTransaksi.find(t => String(t.No_Invoice) === String(noInvoice));
            if (!trx) { alert('Data transaksi tidak ditemukan. Coba sinkronisasi ulang.'); return; }
            if (!window.jspdf) { alert('Modul PDF belum siap dimuat, coba lagi sebentar.'); return; }
            const doc = buatPdfNota(trx);
            doc.save(`Nota_${trx.No_Invoice}.pdf`);
        }

        async function bagikanNotaPdf(noInvoice) {
            const trx = masterTransaksi.find(t => String(t.No_Invoice) === String(noInvoice));
            if (!trx) { alert('Data transaksi tidak ditemukan. Coba sinkronisasi ulang.'); return; }
            if (!window.jspdf) { alert('Modul PDF belum siap dimuat, coba lagi sebentar.'); return; }

            const doc = buatPdfNota(trx);
            const namaFile = `Nota_${trx.No_Invoice}.pdf`;
            const blob = doc.output('blob');
            const file = new File([blob], namaFile, { type: 'application/pdf' });

            // Kalau perangkat mendukung berbagi file (umumnya Chrome di
            // Android), langsung buka menu Bagikan -- dari situ pilih
            // Thermer (atau aplikasi print Bluetooth lain) untuk mencetak.
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                try {
                    await navigator.share({ files: [file], title: namaFile });
                    return;
                } catch (err) {
                    if (err.name === 'AbortError') return; // Dibatalkan pengguna, bukan error.
                    // Kalau gagal karena sebab lain, lanjut ke cara unduh biasa di bawah.
                }
            }

            // Fallback (mis. di laptop yang tidak mendukung berbagi file):
            // unduh PDF-nya, lalu buka manual lewat aplikasi print pilihan Anda.
            doc.save(namaFile);
        }

        async function cetakNotaBluetooth(noInvoice) {
            const trx = masterTransaksi.find(t => String(t.No_Invoice) === String(noInvoice));
            if (!trx) { alert('Data transaksi tidak ditemukan. Coba sinkronisasi ulang.'); return; }

            if (!btPrinterCharacteristic || !btPrinterDevice || !btPrinterDevice.gatt.connected) {
                alert('Printer Bluetooth belum tersambung. Buka Pengaturan > "Sambungkan Printer Bluetooth" dulu, atau gunakan tombol "Nota" biasa.');
                return;
            }

            try {
                const data = buatPerintahEscPosNota(trx);
                const bisaWriteNoResponse = btPrinterCharacteristic.properties.writeWithoutResponse;
                // BLE punya batas ukuran per pengiriman -- kirim per potongan
                // kecil dengan jeda supaya buffer internal printer (yang
                // umumnya tanpa flow control) tidak kebanjiran data.
                const UKURAN_POTONGAN = 100;
                for (let i = 0; i < data.length; i += UKURAN_POTONGAN) {
                    const potongan = data.slice(i, i + UKURAN_POTONGAN);
                    if (bisaWriteNoResponse) {
                        await btPrinterCharacteristic.writeValueWithoutResponse(potongan);
                    } else {
                        await btPrinterCharacteristic.writeValue(potongan);
                    }
                    await new Promise(r => setTimeout(r, 40));
                }
            } catch (err) {
                alert(`Gagal mencetak lewat Bluetooth: ${err.message}\n\nCoba sambungkan ulang printer dari Pengaturan, atau gunakan tombol "Nota" biasa sebagai cadangan.`);
            }
        }

        function cetakNota(noInvoice) {
            const trx = masterTransaksi.find(t => String(t.No_Invoice) === String(noInvoice));
            if (!trx) { alert('Data transaksi tidak ditemukan. Coba sinkronisasi ulang.'); return; }

            const teksResolved = isiPlaceholder(ambilTemplateNotaTeks(), trx, true);
            const printWindow = window.open('', '_blank', 'width=350,height=600');
            const noInvoiceAman = escapeHtml(trx.No_Invoice);

            const bodyHtml = teksResolved.split('\n').map(rawBaris => {
                const { teks, tengah, tebal } = parseBarisNota(rawBaris);
                const style = `${tengah ? 'text-align:center;' : ''}${tebal ? 'font-weight:bold;' : ''}`;
                return `<div style="${style}">${escapeHtml(teks) || '&nbsp;'}</div>`;
            }).join('');

            // QR code lacak pesanan hanya muncul kalau LACAK_URL sudah diisi
            // (lihat komentar di dekat deklarasi konstanta LACAK_URL).
            let qrHtml = '';
            if (LACAK_URL) {
                const urlLacak = `${LACAK_URL}?invoice=${encodeURIComponent(trx.No_Invoice)}`;
                const urlGambarQr = `https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=${encodeURIComponent(urlLacak)}`;
                qrHtml = `<div style="text-align:center;margin-top:10px;"><img src="${urlGambarQr}" width="100" height="100" alt="QR Lacak Pesanan"/><div style="font-size:9px;margin-top:2px;">Scan untuk lacak status pesanan</div></div>`;
            }

            const html = `<html><head><title>Nota - ${noInvoiceAman}</title><style>@media print { @page { margin: 0; } body { margin: 0; } } body { font-family: monospace; font-size: 12px; color: #000; margin: 0; padding: 15px; width: 280px; }</style></head><body>${bodyHtml}${qrHtml}<script>window.onload = function() { window.print(); window.onafterprint = function(){ window.close(); } };<\/script></body></html>`;
            printWindow.document.write(html); printWindow.document.close();
        }

        async function updateStatus(invoice) {
            if(!confirm(`Ubah pesanan ${invoice} menjadi SELESAI?`)) return;
            if(!API_URL) return;
            const btnEl = document.getElementById(`btn-status-${invoice}`);
            if(btnEl) btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            const payload = { sheetName: "Transaksi", action: "update", id: invoice, updateData: { "Status": "Selesai" } };
            try {
                await kirimKeApiScript(payload);
                // Update lokal langsung (bukan sinkronisasi ulang ke 6 sheet)
                // -- kita sudah tahu persis perubahannya, tidak perlu
                // menunggu round-trip tambahan ke server.
                const trxLokal = masterTransaksi.find(t => String(t.No_Invoice) === String(invoice));
                if (trxLokal) trxLokal.Status = 'Selesai';
                kalkulasiDashboard(masterTransaksi);
                renderDaftarPesanan(masterTransaksi);
                // PENTING (khusus mobile): window.open() untuk WA HARUS
                // dipicu LANGSUNG dari tap pengguna yang sinkron -- banyak
                // browser mobile (terutama Safari iOS, juga makin ketat di
                // Chrome Android) memblokir popup kalau ada jeda proses
                // async (seperti panggilan API di atas) sebelum
                // window.open() dipanggil, meskipun jedanya cuma lewat
                // dialog confirm(). Makanya di sini TIDAK langsung
                // confirm()+kirimWA seperti sebelumnya, tapi memunculkan
                // modal dengan tombol nyata -- begitu tombol itu di-tap,
                // window.open() terjadi tanpa jeda async apa pun lagi.
                tampilkanPromptKirimWa(invoice);
            } catch (error) {
                alert(`Gagal merubah status: ${error.message}`);
                if (btnEl) btnEl.innerHTML = '<i class="fa-solid fa-check-double"></i> Selesai';
            }
        }

        function renderDaftarPesanan(dataTransaksi) {
            const container = document.getElementById('listPesananContainer');
            if (!dataTransaksi || dataTransaksi.length === 0) { container.innerHTML = `<p class="text-xs text-blue-300 text-center italic mt-5">Belum ada transaksi.</p>`; return; }
            let reversedData = [...dataTransaksi].reverse();
            let html = '';
            reversedData.forEach(trx => {
                let colorClass = 'bg-slate-600 text-white', isSelesai = false;
                if(trx.Status && trx.Status.toLowerCase() === 'baru') colorClass = 'bg-cox-blue text-white';
                if(trx.Status && trx.Status.toLowerCase() === 'proses') colorClass = 'bg-amber-500 text-white';
                if(trx.Status && (trx.Status.toLowerCase() === 'selesai' || trx.Status.toLowerCase() === 'diambil')) { colorClass = 'bg-emerald-500 text-white'; isSelesai = true; }
                let btnSelesaiHtml = !isSelesai ? `<button id="btn-status-${trx.No_Invoice}" onclick="updateStatus('${trx.No_Invoice}')" class="bg-emerald-500/20 text-emerald-400 border border-emerald-500 hover:bg-emerald-500 hover:text-white px-3 py-1.5 rounded-lg text-[10px] font-bold transition flex items-center gap-1"><i class="fa-solid fa-check-double"></i> Selesai</button>` : '';
                
                let metodeBayar = trx.Metode_Pembayaran || trx.Metode || trx.Pembayaran || '-';

                html += `
                <div class="bg-cox-card p-4 rounded-2xl border border-blue-800 shadow-sm flex flex-col gap-2 relative">
                    <div class="flex justify-between items-start">
                        <div>
                            <span class="text-[10px] text-blue-300 font-mono">${escapeHtml(trx.No_Invoice) || ''}</span>
                            <h4 class="font-bold text-sm text-white">${escapeHtml(trx.Nama_Pelanggan) || ''}</h4>
                        </div>
                        <span class="text-[10px] ${colorClass} px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">${escapeHtml(trx.Status) || 'Baru'}</span>
                    </div>
                    
                    <div class="flex justify-between items-end mt-1 pb-3 border-b border-blue-900/50">
                        <div class="text-[11px] text-blue-200 space-y-1">
                            <p><i class="fa-solid fa-shirt w-4 text-cox-cyan"></i> ${escapeHtml(trx.Layanan) || ''}</p>
                            <p><i class="fa-regular fa-clock w-4 text-cox-cyan"></i> Masuk: ${escapeHtml(formatWaktuIndo(trx.Tanggal_Masuk))}</p>
                            <p><i class="fa-regular fa-calendar-check w-4 text-cox-cyan"></i> Est. Selesai: ${escapeHtml(formatWaktuIndo(trx.Tanggal_Selesai))}</p>
                            <p><i class="fa-solid fa-wallet w-4 text-cox-cyan"></i> Pembayaran: <span class="text-white font-medium">${escapeHtml(metodeBayar)}</span></p>
                        </div>
                        <span class="font-bold text-sm text-cox-cyan">Rp ${parseFloat(trx.Total_Harga || 0).toLocaleString('id-ID')}</span>
                    </div>

                    <div class="flex justify-between items-center pt-1">
                        <div class="flex gap-2">
                            ${btnSelesaiHtml}
                        </div>
                        <div class="flex gap-2">
                            <button onclick="kirimWA('${trx.No_Invoice}')" class="bg-slate-800 text-blue-300 border border-blue-800 hover:text-emerald-400 hover:border-emerald-500 px-3 py-1.5 rounded-lg text-[10px] font-bold transition flex items-center gap-1"><i class="fa-brands fa-whatsapp text-sm"></i> WA</button>
                            <button onclick="cetakNota('${trx.No_Invoice}')" class="bg-slate-800 text-blue-300 border border-blue-800 hover:text-cox-cyan hover:border-cox-cyan px-3 py-1.5 rounded-lg text-[10px] font-bold transition flex items-center gap-1"><i class="fa-solid fa-print text-sm"></i> Nota</button>
                            <button onclick="bagikanNotaPdf('${trx.No_Invoice}')" title="Buat PDF nota berukuran kertas thermal, lalu bagikan/cetak lewat aplikasi seperti Thermer" class="bg-slate-800 text-blue-300 border border-blue-800 hover:text-emerald-400 hover:border-emerald-500 px-3 py-1.5 rounded-lg text-[10px] font-bold transition flex items-center gap-1"><i class="fa-solid fa-file-pdf text-sm"></i></button>
                            <button onclick="cetakNotaBluetooth('${trx.No_Invoice}')" title="Cetak langsung ke printer Bluetooth BLE (eksperimental, kemungkinan tidak berfungsi untuk printer Bluetooth Classic/SPP)" class="bg-slate-800 text-blue-300 border border-blue-800 hover:text-cox-cyan hover:border-cox-cyan px-3 py-1.5 rounded-lg text-[10px] font-bold transition flex items-center gap-1"><i class="fa-brands fa-bluetooth-b text-sm"></i></button>
                        </div>
                    </div>
                </div>`;
            });
            container.innerHTML = html;
        }

        async function prosesLogin(e) {
            e.preventDefault();
            const user = document.getElementById('username').value.trim();
            const pass = document.getElementById('password').value.trim();
            const btn = document.getElementById('btnLogin');
            if (btn.disabled) return;

            if (!API_URL) {
                alert('URL Apps Script belum diisi! Tidak bisa memverifikasi akun.');
                return;
            }

            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memverifikasi...';
            btn.disabled = true;

            try {
                // Verifikasi username/password dilakukan sepenuhnya di server
                // (Apps Script action "login"). Password tidak pernah dicek
                // atau dibandingkan di browser, dan daftar password pegawai
                // tidak pernah diunduh ke perangkat kasir.
                const hasil = await kirimKeApiScript({ sheetName: "Pengguna", action: "login", username: user, password: pass });
                const userRole = String(hasil.role || 'Kasir').trim();

                localStorage.setItem('cox_logged_in', 'true');
                localStorage.setItem('cox_kasir', user);
                localStorage.setItem('cox_role', userRole);
                // sessionToken dipakai server untuk membuktikan role Admin pada
                // aksi sensitif (Kelola Layanan, hapus Pengeluaran, tambah
                // pegawai) -- lihat ADMIN_ONLY_ACTIONS di code.gs. Berbeda dari
                // cox_role di atas, ini TIDAK bisa dipalsukan lewat DevTools
                // karena server memverifikasinya lewat CacheService, bukan
                // dari nilai yang diklaim client.
                localStorage.setItem('cox_session', hasil.sessionToken || '');
                catatAktivitasTerakhir();

                document.getElementById('namaKasir').innerText = user;
                document.getElementById('badgeRoleKasir').innerText = userRole;
                document.getElementById('loginScreen').classList.add('opacity-0');

                setTimeout(() => {
                    document.getElementById('loginScreen').classList.add('hidden');
                    const app = document.getElementById('appContainer');
                    app.classList.remove('hidden');
                    setTimeout(() => app.classList.remove('opacity-0'), 50);

                    terapkanHakAksesRole(); 
                    sinkronisasiData();
                }, 500);
            } catch (err) {
                // Baik kredensial salah maupun gangguan jaringan/server sama-sama
                // dianggap percobaan gagal. Lockout visual di tombol ini cuma
                // kosmetik/UX -- pembatasan yang sesungguhnya sudah dijaga di
                // server (lihat cekRateLimitLogin_ di code.gs), jadi tetap
                // efektif walau halaman ini di-refresh atau diserang lewat API
                // langsung.
                handleGagalLogin(btn);
            }
        }

        function handleGagalLogin(btn) {
            percobaanLogin++;
            if (percobaanLogin >= 3) {
                let detik = 30; btn.disabled = true;
                let timer = setInterval(() => {
                    btn.innerHTML = `Terkunci (${detik}s)`; detik--;
                    if (detik < 0) { clearInterval(timer); btn.disabled = false; btn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> Masuk Sistem`; percobaanLogin = 0; }
                }, 1000);
            } else {
                alert('Login gagal! Periksa kembali username dan password Anda.');
                btn.disabled = false; btn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> Masuk Sistem`;
            }
        }

        function logout() { if(confirm('Apakah Anda yakin ingin keluar?')) { bersihkanSesiLogin(); location.reload(); } }
        function buatNoInvoice() { const dateStr = new Date().toISOString().slice(2,10).replace(/-/g, ''); const randomNum = Math.floor(1000 + Math.random() * 9000); return `INV${dateStr}${randomNum}`; }
        function bukaModalPesanan() { document.getElementById('noInvoiceDisplay').innerText = buatNoInvoice(); const overlay = document.getElementById('modalPesananOverlay'), content = document.getElementById('modalPesananContent'); overlay.classList.remove('hidden'); setTimeout(() => { overlay.classList.remove('opacity-0'); content.classList.add('active'); }, 10); }
        function tutupModalPesanan() { const overlay = document.getElementById('modalPesananOverlay'), content = document.getElementById('modalPesananContent'); content.classList.remove('active'); overlay.classList.add('opacity-0'); setTimeout(() => { overlay.classList.add('hidden'); resetFormPesanan(); }, 300); }

        function resetFormPesanan() {
            document.getElementById('pilihPelangganDropdown').selectedIndex = 0; 
            document.getElementById('inputNamaPelanggan').value = ''; document.getElementById('inputNoHP').value = '';
            document.getElementById('inputJumlah').value = ''; document.getElementById('inputDiskon').value = ''; 
            document.getElementById('inputTglMasuk').value = currentDateTimeString;
            
            const btnTipes = document.querySelectorAll('.btn-tipe-diskon');
            if(btnTipes.length > 0) ubahTipeDiskon('Rp', btnTipes[0]);

            hitungOtomatisTanggalSelesai();
            document.getElementById('inputMetodePembayaran').value = '';
            keranjangItem = []; renderKeranjang();
            document.querySelectorAll('.btn-bayar').forEach(b => b.classList.remove('bg-cox-cyan/20', 'border-cox-cyan', 'text-cox-cyan'));
        }

        function pilihPembayaran(metode, element) {
            document.getElementById('inputMetodePembayaran').value = metode;
            document.querySelectorAll('.btn-bayar').forEach(b => b.classList.remove('bg-cox-cyan/20', 'border-cox-cyan', 'text-cox-cyan'));
            element.classList.add('bg-cox-cyan/20', 'border-cox-cyan', 'text-cox-cyan');
        }

        async function simpanPesanan() {
            if (!API_URL) { alert('URL Apps Script belum diisi!'); return; }
            const noInv = document.getElementById('noInvoiceDisplay').innerText, nama = document.getElementById('inputNamaPelanggan').value.trim();
            const noHp = document.getElementById('inputNoHP').value.trim(), tglMasuk = document.getElementById('inputTglMasuk').value;
            const tglSelesai = document.getElementById('inputTglSelesai').value, metodeBayar = document.getElementById('inputMetodePembayaran').value;
            if (!nama || !noHp || keranjangItem.length === 0 || !tglSelesai || !metodeBayar) { alert('Mohon lengkapi seluruh data!'); return; }
            
            let valDiskon = parseFloat(document.getElementById('inputDiskon').value) || 0;
            let tipeDiskon = document.getElementById('tipeDiskonVal').value;
            let gabunganLayanan = keranjangItem.map(item => `${item.nama} (${item.qty})`).join(', ');
            
            if (valDiskon > 0) {
                let teksDiskon = tipeDiskon === '%' ? `[Diskon ${valDiskon}%]` : `[Diskon Rp ${valDiskon.toLocaleString('id-ID')}]`;
                gabunganLayanan += ` ${teksDiskon}`;
            }

            // HITUNG TOTAL JUMLAH KG / PCS DARI KERANJANG
            let totalJumlahKiloan = keranjangItem.reduce((sum, item) => sum + parseFloat(item.qty || 0), 0);

            let totalHargaKeseluruhan = parseFloat(document.getElementById('displayTotalHarga').getAttribute('data-total')) || 0;
            const btn = document.getElementById('btnSimpanPesanan'), originalBtnHtml = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; btn.disabled = true;

            const payloadTransaksi = {
                sheetName: "Transaksi", action: "insert",
                rowData: { 
                    "No_Invoice": noInv, 
                    "Tanggal_Masuk": tglMasuk, 
                    "Tanggal_Selesai": tglSelesai, 
                    "Nama_Pelanggan": nama, 
                    "No_HP": noHp, 
                    "Layanan": gabunganLayanan, 
                    "Jumlah_Kiloan": totalJumlahKiloan, 
                    "Total_Harga": totalHargaKeseluruhan, 
                    "Status": "Baru", 
                    "Metode_Pembayaran": metodeBayar 
                }
            };

            let existingPelanggan = masterPelanggan.find(p => String(p.No_HP).trim() === noHp);
            let totalOrderBaru = existingPelanggan ? (parseInt(existingPelanggan.Total_Order || 0) + 1) : 1;
            let idPelanggan = existingPelanggan ? existingPelanggan.ID_Pelanggan : "CUST" + Date.now().toString().slice(-6);

            const payloadPelanggan = {
                sheetName: "Pelanggan", action: "insert",
                rowData: { "ID_Pelanggan": idPelanggan, "Nama": nama, "No_HP": noHp, "Total_Order": totalOrderBaru }
            };

            try {
                // Simpan transaksi dulu -- ini yang paling penting.
                await kirimKeApiScript(payloadTransaksi);
                // Update lokal langsung (bukan sinkronisasi ulang ke 6 sheet)
                // supaya daftar pesanan & dashboard langsung ke-update tanpa
                // menunggu round-trip tambahan ke server -- jauh lebih cepat,
                // dan tetap akurat karena kita sudah tahu persis data barunya.
                masterTransaksi.push({
                    No_Invoice: noInv, Tanggal_Masuk: tglMasuk.replace('T', ' '), Tanggal_Selesai: tglSelesai.replace('T', ' '),
                    Nama_Pelanggan: nama, No_HP: noHp, Layanan: gabunganLayanan, Jumlah_Kiloan: totalJumlahKiloan,
                    Total_Harga: totalHargaKeseluruhan, Status: "Baru", Metode_Pembayaran: metodeBayar
                });

                try {
                    // Update data pelanggan. Kalau ini gagal, transaksi TETAP
                    // sudah tersimpan -- jangan buat kasir mengira transaksinya
                    // hilang, cukup beri tahu bagian mana yang perlu dicek manual.
                    await kirimKeApiScript(payloadPelanggan);
                    if (existingPelanggan) { existingPelanggan.Total_Order = totalOrderBaru; }
                    else { masterPelanggan.push({ ID_Pelanggan: idPelanggan, Nama: nama, No_HP: noHp, Total_Order: totalOrderBaru }); }
                    alert(`Transaksi ${noInv} berhasil disimpan & data pelanggan tercatat!`);
                } catch (errPelanggan) {
                    alert(`Transaksi ${noInv} berhasil disimpan, tapi data pelanggan gagal diperbarui (${errPelanggan.message}). Mohon cek data pelanggan secara manual.`);
                }

                kalkulasiDashboard(masterTransaksi); renderDaftarPesanan(masterTransaksi);
                tutupModalPesanan();
            } catch (error) {
                alert(`Gagal menyimpan transaksi ${noInv}: ${error.message}. Silakan coba lagi.`);
            } finally {
                btn.innerHTML = originalBtnHtml; btn.disabled = false;
            }
        }