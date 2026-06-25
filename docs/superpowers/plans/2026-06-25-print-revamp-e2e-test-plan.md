# Print Revamp — E2E Test Plan

**Tanggal**: 2026-06-25
**Scope**: Verifikasi end-to-end seluruh perubahan Phase 1+2+3 (web + agent).
**Spec referensi**: `docs/superpowers/specs/2026-06-25-print-revamp-design.md`

## Tujuan

Pastikan **semua** flow yang berubah selama refactor jalan benar di production-like setup. Bukan unit test (sudah hijau di repo) — ini end-to-end manual + DB inspection.

## Setup pre-test (lakukan SEKALI di awal)

- [ ] Agent app build terbaru sudah ter-install di Android device target
- [ ] Agent login dengan akun warung
- [ ] Settings agent: IP dapur + IP minuman terisi, port 9100
- [ ] Test koneksi printer dapur & minuman: keduanya balas OK
- [ ] Web app deploy terbaru (atau jalan via `npm run dev`)
- [ ] Login web dengan akun yang sama
- [ ] Buka `/setup/printer/settings`, isi `footer_text` (mis: `Terima kasih atas kunjungan Anda\n~ Pak Pon ~`)
- [ ] Pastikan `header_text` juga terisi (mis: `PECEL LELE PAK PON`)
- [ ] Buat 1 tx baru dengan items: 2 makanan + 1 nasi + 2 minuman (mix) → confirm → SIMPAN tanpa cetak (kalau perlu) — ini jadi tx baseline untuk skenario manual reprint
- [ ] Siapkan SQL access (Supabase Studio atau `psql`) untuk inspect DB

---

## Cara baca scenario

Tiap scenario punya:
- **Precondition**: state yang harus benar SEBELUM steps
- **Steps**: action urut
- **Expected**: yang HARUS terlihat (printer + UI + DB) — kalau salah satu meleset, scenario gagal
- **DB verify**: SQL yang perlu di-cek (kalau ada)
- **Notes**: catatan kalau ada nuance

---

# A. Setup & koneksi agent

## A1. Agent Start → status online

**Precondition:** Agent app installed, login sudah selesai, posisi di tab Home/Status.

**Steps:**
1. Pastikan agent state "Stopped" (kalau lagi running, tekan Stop dulu).
2. Tekan tombol **Start Agent**.
3. Tunggu 2-3 detik.

**Expected:**
- Status di app: "ONLINE" / hijau / "running"
- Notifikasi persistent "Pak Pon Print Agent · Online" muncul di status bar HP
- Buka web `/setup/printer/debug` → row agent muncul dengan badge **Online**
- Banner di home web "Print agent belum jalan" tidak muncul

**DB verify:**
```sql
SELECT agent_label, status, last_seen_at
FROM agent_heartbeats
WHERE last_seen_at > now() - interval '2 minutes'
ORDER BY last_seen_at DESC LIMIT 5;
```
Row terbaru: `status='online'`, `last_seen_at` dalam 30 detik terakhir.

---

## A2. Agent Stop → status offline

**Precondition:** A1 sukses (agent online).

**Steps:**
1. Di app, tekan tombol **Stop Agent**.
2. Tunggu 2-3 detik.

**Expected:**
- Status di app: "STOPPED" / merah / "offline"
- Notifikasi persistent hilang
- Web `/setup/printer/debug` → badge **Offline** (refresh page kalau perlu)
- Banner web "Print agent belum jalan" muncul lagi di home (max 30 detik karena banner polling 30s)

**DB verify:**
```sql
SELECT status, last_seen_at FROM agent_heartbeats
ORDER BY last_seen_at DESC LIMIT 1;
```
Row: `status='offline'`.

---

## A3. Agent app force-killed (no clean stop)

**Precondition:** Agent online (A1 sukses).

**Steps:**
1. Force-kill agent app dari Android system settings (Apps → Pak Pon Agent → Force stop), JANGAN tekan Stop button dulu.
2. Tunggu 100 detik.
3. Buka web `/setup/printer/debug`, refresh.

**Expected:**
- DB: `status` mungkin stuck di `online` (tidak ada clean shutdown)
- Tapi `last_seen_at` STALE (>90 detik lalu)
- Web treat agent sebagai **Offline** karena heartbeat threshold 90s
- Banner web "Print agent belum jalan" muncul

**DB verify:**
```sql
SELECT status, last_seen_at, now() - last_seen_at AS staleness
FROM agent_heartbeats ORDER BY last_seen_at DESC LIMIT 1;
```
`staleness > '00:01:30'`.

**Notes:** Ini test critical untuk verify dual-check (`status='online' AND last_seen_at>now()-90s`) di heartbeat API.

---

## A4. WiFi drop → reconnect → heartbeat resume

**Precondition:** Agent online (A1 sukses), HP terhubung WiFi.

**Steps:**
1. Note `last_seen_at` saat ini di DB.
2. Matikan WiFi HP (Settings → WiFi off, atau airplane mode). Jangan stop agent.
3. Tunggu 60 detik.
4. Nyalakan WiFi lagi, tunggu reconnect (~10 detik).
5. Tunggu 35 detik (1 heartbeat cycle).
6. Re-query DB.

**Expected:**
- Selama WiFi off: heartbeat fail di logcat (log warn "Heartbeat #N FAILED"), `last_seen_at` STALE > 60 detik.
- Setelah WiFi reconnect: heartbeat berikutnya sukses, `last_seen_at` ter-update fresh.
- Tidak ada crash agent app (WiFi lock + try/catch loop preserve).
- Banner web "Print agent belum jalan" sempat muncul selama outage, hilang setelah reconnect.

**DB verify (setelah reconnect):**
```sql
SELECT status, last_seen_at, now() - last_seen_at AS staleness
FROM agent_heartbeats ORDER BY last_seen_at DESC LIMIT 1;
```
`staleness < '00:00:35'`, `status='online'`.

**Notes:** WiFi lock di service prevents radio kill saat layar mati; kalau WiFi user toggle manual, heartbeat akan tetap recovery via try/catch + retry. Test ini juga verify auth session masih valid setelah network gap (SettingsSessionManager persistence).

---

# B. Format kitchen ticket (dapur/minuman)

## B1. Visual: BIG double-size + UPPERCASE qty+name

**Precondition:** Agent online, ada tx baseline dari Setup section.

**Steps:**
1. Buka detail tx baseline yang baru-baru ini disimpan
2. Pastikan items: ada makanan/nasi (kategori dapur) + minuman
3. Tekan **Cetak ulang Dapur** (full reprint)
4. Tunggu print fisik keluar

**Expected (kertas printer dapur):**
- Header warung center bold (mis "PECEL LELE PAK PON")
- Block info: `Date`, `Order Number`, `Customer`, `Meja`
- Items dengan **double-size** (lebar 2x + tinggi 2x), format `2x AYAM GORENG` (qty di depan, nama UPPERCASE)
- Notes per item (kalau ada) di bawah, ukuran **normal** (tidak double-size), format `> note`
- Footer: `Total Item N` (jumlah qty)
- **TIDAK ADA**: harga per item, line total, grand total Rp

**Notes:** Kalau output bukan double-size (cuma huruf normal), berarti ESC/POS bytes `GS ! 0x11` tidak dihormati oleh printer. Cek model printer atau settings paper_width.

---

## B2. Visual: nota minuman terpisah

**Precondition:** B1 sukses (verifikasi printer dapur).

**Steps:**
1. Di detail tx yang sama, tekan **Cetak ulang Minuman**.
2. Cek kertas yang keluar dari printer minuman (bukan dapur).

**Expected:**
- Print di **printer minuman** (LAN IP berbeda dari dapur)
- Format sama dengan B1 (BIG, no price, Total Item N)
- Hanya items kategori minuman yang tampil
- Item makanan/nasi TIDAK tampil di nota minuman

---

## B3. Visual: omit Meja/Customer kalau null

**Steps:**
1. Buat tx baru via scan/POS dengan `customer_name=null` dan `table_no=null` (atau edit existing tx kosongkan)
2. Cetak ulang Dapur

**Expected:**
- Header info block tampil: `Date`, `Order Number`
- Baris `Customer:` TIDAK tampil
- Baris `Meja:` TIDAK tampil
- Items tetap tampil seperti B1

---

# C. Format customer receipt

## C1. Visual: format lengkap dengan harga + total + footer

**Precondition:** `footer_text` non-empty di settings (set saat Setup).

**Steps:**
1. Di detail tx baseline, tekan **Cetak nota customer** (kuning/mustard color)
2. Cek output printer dapur (customer receipt default ke printer dapur per decision spec 2.5.4)

**Expected:**
- Header warung center bold
- Info block: Date, Order Number, Customer, Meja
- Items dengan harga: nama item baris atas, `2x 19.000 ... 38.000` baris bawah (right-aligned)
- Total Item N
- `Total ... Rp 123.456` bold di kanan
- Footer center: `Terima kasih atas kunjungan Anda`, `~ Pak Pon ~` (sesuai footer_text)
- Format **berbeda** dari nota dapur (lebih kecil, more info, no double-size)

---

## C2. Footer kosong → tidak print footer

**Steps:**
1. Buka `/setup/printer/settings`, kosongkan `Footer text`, klik Simpan
2. Refresh detail tx
3. Tekan Cetak nota customer

**Expected:**
- Format sama seperti C1 TAPI tanpa block "Terima kasih..." di bawah Total
- Kertas langsung dipotong setelah Total + feed lines

**Cleanup setelah test:** kembalikan footer_text ke nilai asli.

---

# D. Auto-print behavior (saat save dari /scan)

## D1. First save: pending → confirmed → auto print 2 nota full

**Precondition:** Agent online.

**Steps:**
1. Scan/buat nota baru di `/scan` (atau klik "Tambah manual" kalau ada)
2. Review items: setidaknya 2 makanan + 1 minuman
3. Tekan **✓ Simpan & Cetak**

**Expected:**
- Toast hijau: "Nota tersimpan, 2 print job cetak dikirim ke agent"
- Printer dapur cetak kitchen ticket dengan semua items kategori makanan/nasi
- Printer minuman cetak kitchen ticket dengan semua items kategori minuman
- Redirect ke home `/`
- Di detail tx baru, tombol "Cetak tambahan" **disabled** (semua item sudah ke-flag)

**DB verify:**
```sql
SELECT id, target, trigger, status, item_ids, done_at
FROM print_history
WHERE tx_id = '<id tx baru>'
ORDER BY created_at DESC;
```
- 2 rows: 1 target='dapur', 1 target='minuman', keduanya status='done', trigger='auto'

```sql
SELECT id, menu_name_snapshot, printed_dapur_at, printed_minuman_at
FROM transaction_items WHERE transaction_id='<id>' ORDER BY sort_order;
```
- Items makanan/nasi: `printed_dapur_at NOT NULL`, `printed_minuman_at NULL`
- Items minuman: `printed_minuman_at NOT NULL`, `printed_dapur_at NULL`

---

## D2. Edit save (add 1 item makanan) → auto print TAMBAHAN only

**Precondition:** D1 sukses, tx confirmed.

**Steps:**
1. Buka detail tx D1, klik "Edit transaksi"
2. Tambah 1 item makanan baru
3. Tekan **✓ Simpan & Cetak**

**Expected:**
- Toast hijau: "Nota tersimpan, 1 print job tambahan dikirim ke agent"
- Printer dapur cetak kitchen ticket **HANYA berisi 1 item baru** (item-item lama TIDAK ulang)
- Printer minuman **tidak cetak apapun**
- Redirect ke home `/`

**DB verify:**
```sql
SELECT id, target, trigger, item_ids
FROM print_history WHERE tx_id='<id>' ORDER BY created_at DESC LIMIT 3;
```
- Row terbaru: `trigger='auto_additional'`, `target='dapur'`, `item_ids` = 1 UUID (item baru only)

```sql
SELECT id, menu_name_snapshot, printed_dapur_at
FROM transaction_items WHERE transaction_id='<id>'
ORDER BY sort_order;
```
- Item-item lama: `printed_dapur_at` tetap dengan timestamp lama (D1)
- Item baru: `printed_dapur_at` dengan timestamp baru (D2)

**Notes:** Ini test critical bug fix `replaceItems` preservation (kalau gagal, semua flag akan jadi NULL semua dan re-print full).

---

## D3. Edit save tanpa nambah item (cuma edit qty)

**Steps:**
1. Buka edit detail tx D1
2. Ubah qty salah satu item makanan (mis dari 2 jadi 3) — tanpa tambah item baru
3. Tekan Simpan & Cetak

**Expected:**
- Toast hijau: "Nota tersimpan (tidak ada item baru untuk dicetak)"
- TIDAK ada print job baru
- Printer dapur & minuman diam

**Notes:** Edit qty dianggap "tidak ada item baru" karena flag-nya tetap non-null. Limitasi diketahui (spec section G #3 trade-off).

---

## D4. Edit save tambah item minuman aja → only minuman job

**Steps:**
1. Buka edit detail tx D1
2. Tambah 1 item minuman baru
3. Simpan

**Expected:**
- Toast: "1 print job tambahan dikirim"
- Printer minuman cetak 1 item baru
- Printer dapur diam

---

# E. Manual "Cetak tambahan"

## E1. Disabled saat semua items sudah printed

**Precondition:** Tx sudah confirmed, semua item sudah successfully printed (flag non-null).

**Steps:**
1. Buka detail tx (no edit, just view)
2. Lihat tombol "Cetak tambahan"

**Expected:**
- Tombol disabled (opacity 50%, tidak clickable)
- Label: `⚡ Cetak tambahan (tidak ada)`

---

## E2. Enabled dengan count saat ada NULL items

**Precondition:** Setup tx dengan mixed printed state — bisa dipancing dengan: scan tx baru tapi matikan printer dulu, save → print gagal → flag tetap NULL.

**Steps:**
1. Buka detail tx tsb
2. Lihat tombol "Cetak tambahan"

**Expected:**
- Tombol enabled (warna primary terang)
- Label: `⚡ Cetak tambahan (N item)` — N = jumlah items dengan flag NULL

---

## E3. Klik → fan-out ke 2 target untuk NULL items only

**Precondition:** Tx ada items NULL di dapur DAN minuman.

**Steps:**
1. Klik "Cetak tambahan"

**Expected:**
- Toast: "2 job tambahan dikirim ke agent"
- Printer dapur cetak items dengan `printed_dapur_at IS NULL` (kategori makanan/nasi)
- Printer minuman cetak items dengan `printed_minuman_at IS NULL` (kategori minuman)
- Setelah print sukses, tombol disabled, label "tidak ada"

**DB verify (setelah print sukses):**
```sql
SELECT id, printed_dapur_at, printed_minuman_at
FROM transaction_items WHERE transaction_id='<id>';
```
Tidak ada lagi NULL flag (kecuali yang category mismatch — e.g. item minuman ngga di-update printed_dapur_at).

---

## E4. Single target NULL → 1 job only

**Steps:**
1. Setup: tx dengan items dapur NULL tapi items minuman SEMUANYA non-null (sudah pernah dicetak)
2. Klik "Cetak tambahan"

**Expected:**
- Toast: "1 job tambahan dikirim ke agent"
- Hanya printer dapur cetak
- Printer minuman diam

---

# F. Manual "Cetak ulang" (full reprint)

## F1. Cetak ulang Dapur prints semua item makanan/nasi

**Precondition:** Tx confirmed dengan items mixed dapur+minuman.

**Steps:**
1. Klik "Cetak ulang Dapur"

**Expected:**
- Toast: "Cetak ulang dapur dikirim ke agent"
- Printer dapur cetak SEMUA items makanan/nasi (regardless `printed_dapur_at`)
- Printer minuman diam
- `printed_dapur_at` items dapur ter-refresh ke timestamp terbaru

**DB verify:**
```sql
SELECT trigger FROM print_history
WHERE tx_id='<id>' ORDER BY created_at DESC LIMIT 1;
```
`trigger='reprint'`.

---

## F2. Cetak ulang Minuman

**Steps:**
1. Klik "Cetak ulang Minuman"

**Expected:**
- Toast: "Cetak ulang minuman dikirim ke agent"
- Printer minuman cetak SEMUA items minuman
- Printer dapur diam
- `printed_minuman_at` items minuman refresh

---

## F3. Cetak ulang Keduanya → 2 jobs paralel

**Steps:**
1. Klik "Cetak ulang Keduanya"

**Expected:**
- Toast: "2 job dikirim ke agent"
- Printer dapur + minuman keduanya cetak
- Flags refresh untuk semua items

---

## F4. Disabled state saat tidak ada items category

**Steps:**
1. Buat tx khusus minuman saja (no makanan/nasi)
2. Buka detail tx
3. Lihat tombol Cetak ulang Dapur

**Expected:**
- Tombol "Cetak ulang Dapur" disabled
- Tombol "Cetak ulang Minuman" enabled
- Tombol "Cetak ulang Keduanya" enabled (akan fire 1 job minuman only)

---

## F5. Partial failure: Cetak ulang Keduanya dengan 1 printer mati

**Precondition:** Agent online, printer dapur ON, **printer minuman OFF** (atau IP minuman invalid/unreachable).

**Steps:**
1. Buka detail tx mixed (ada makanan + minuman).
2. Klik "Cetak ulang Keduanya".
3. Tunggu 10-15 detik (TCP timeout 5s × 2 targets).

**Expected (UI):**
- Toast hijau "1 sukses, 1 gagal: minuman=Connection timeout" (atau sejenis)
- Printer dapur cetak normal
- Printer minuman tidak cetak (mati)

**Expected (DB):**
```sql
SELECT target, status, failure_reason FROM print_history
WHERE tx_id='<id>' ORDER BY created_at DESC LIMIT 2;
```
- Row dapur: `status='done'`, `failure_reason IS NULL`
- Row minuman: `status='failed'`, `failure_reason` ada (Connection timeout / refused)

**Expected (items flag):**
```sql
SELECT id, menu_category, printed_dapur_at, printed_minuman_at
FROM transaction_items WHERE transaction_id='<id>';
```
- Items makanan/nasi: `printed_dapur_at` ter-update fresh (dapur sukses → trigger fire)
- Items minuman: `printed_minuman_at` TIDAK berubah (minuman gagal → trigger skip)

**Notes:** Test ini verify partial-failure semantic: per-target independence. Cetak tambahan berikutnya akan re-include minuman items karena flag masih NULL.

---

# G. Manual "Cetak nota customer"

## G1. Klik → 1 job target=customer, item_ids=null

**Steps:**
1. Klik tombol "Cetak nota customer"

**Expected:**
- Toast: "Cetak nota customer dikirim ke agent"
- Printer **DAPUR** cetak (per spec decision — customer route ke dapur printer)
- Format: customer receipt dengan harga + total + footer
- **TIDAK** ada perubahan di `printed_*_at` items (karena item_ids null)

**DB verify:**
```sql
SELECT target, trigger, item_ids FROM print_history
WHERE tx_id='<id>' AND target='customer'
ORDER BY created_at DESC LIMIT 1;
```
`item_ids IS NULL`, `target='customer'`, `trigger='customer'`.

---

## G2. Disabled saat tx 0 items

**Steps:**
1. Setup tx dengan items=0 (atau buat tx baru tanpa items)
2. Buka detail

**Expected:**
- Tombol "Cetak nota customer" disabled
- Semua tombol cetak disabled

---

# H. Agent offline handling

## H1. Save tx confirmed saat agent offline → toast warning

**Precondition:** Agent dalam state STOPPED.

**Steps:**
1. Buka /scan, buat tx baru, review, Simpan & Cetak

**Expected:**
- Toast hijau: "Nota tersimpan"
- Toast warning kuning: "Agent printer offline. Nyalakan agent lalu klik Cetak tambahan dari halaman detail."
- TIDAK ada print job di history (FCM ngga dispatch)
- Tx tetap tersimpan di DB

**DB verify:**
```sql
SELECT COUNT(*) FROM print_history WHERE tx_id='<id baru>';
```
0 rows.

---

## H2. Restart agent → klik Cetak tambahan → semua items printed

**Steps (lanjutan H1):**
1. Tekan Start Agent
2. Tunggu A1 verify online
3. Buka detail tx H1
4. Klik "Cetak tambahan"

**Expected:**
- Tombol label: `Cetak tambahan (N item)` dimana N = total semua items
- Klik → fan-out 2 job
- Printer cetak normal
- Setelah sukses, tombol disabled

---

## H3. Klik cetak ulang saat offline → toast warning

**Precondition:** Agent OFFLINE (Stop).

**Steps:**
1. Buka detail tx existing yang sudah pernah printed
2. Klik "Cetak ulang Dapur"

**Expected:**
- Toast warning: "Agent printer offline"
- TIDAK ada print job
- Setelah Start Agent, tombol bisa retry

---

## H4. Test print dialog saat offline

**Precondition:** Agent OFFLINE.

**Steps:**
1. Buka `/setup/printer` page (atau wherever test print dialog dipanggil)
2. Trigger test print

**Expected:**
- Dialog tampil state baru: "Agent printer offline" (background kuning/mustard)
- Copy actionable: "Buka aplikasi Pak Pon Agent di Android, login, lalu tap Start. Kembali ke sini setelah indikator agent jadi Online."
- 2 tombol: "Coba Lagi" + "Tutup"
- Klik "Coba Lagi" → kembali ke state idle

---

## H5. Test print success path via web Settings

**Precondition:** Agent ONLINE, printer dapur ON.

**Steps:**
1. Buka `/setup/printer` (atau wherever test print dialog dipanggil).
2. Pilih target dapur, klik "Test Print".

**Expected:**
- Dialog tampil progress "Mengirim job test print..." lalu success state hijau.
- Printer dapur cetak bytes test (header pendek, "TEST PRINT" line atau sejenis).
- DB ada row `print_history` baru dengan `trigger='test'`, `tx_id IS NULL`, `item_ids IS NULL`, `status='done'`.

**DB verify:**
```sql
SELECT trigger, tx_id, item_ids, status, target
FROM print_history WHERE trigger='test'
ORDER BY created_at DESC LIMIT 1;
```
`trigger='test'`, `tx_id IS NULL`, `item_ids IS NULL`, `target='dapur'`, `status='done'`.

**Notes:** Test print uses `/api/print/send` endpoint (Phase 2 web Task 10 step 3 changes). Verify request body shape `{ tx_id: null, item_ids: null, target, trigger: 'test', bytes_b64 }` di DevTools Network. Test ini verify route + payload kompat untuk test flow (item_ids null + tx_id null).

---

## H6. Stop button race vs FCM in-flight → recordStoppedAfterDispatch

**Precondition:** Agent ONLINE, printer dapur ON. Susah di-reproduce deterministik, tapi worth dicoba.

**Steps:**
1. Posisi: detail tx dengan beberapa items dapur yang flag-nya NULL.
2. Klik "Cetak tambahan" di web.
3. **Segera** (kurang dari 1 detik setelah klik) tekan **Stop Agent** di app HP.
4. Tunggu 5-10 detik.

**Expected (kalau race kena):**
- Web sudah balas 200 + toast "Cetak tambahan dikirim" (FCM sudah ter-dispatch dari web side).
- Tapi agent stop SEBELUM FCM sampai → `PakPonFcmService.isRunning()` return false → `recordStoppedAfterDispatch` path → DB insert row `failed` dengan reason spesifik.
- Printer dapur TIDAK cetak.
- Items flag tetap NULL (karena trigger DB skip — status='failed').

**Expected (kalau race tidak kena = stop terlalu lambat):**
- Print job ter-proses normal (race window kecil ~500ms).
- Coba ulang 2-3 kali untuk reproduce. Kalau persisten tidak kena, OK skip — Phase 2 code path tested via unit test ParseInlineJobTest.

**DB verify (kalau race kena):**
```sql
SELECT status, failure_reason, target FROM print_history
WHERE tx_id='<id>' ORDER BY created_at DESC LIMIT 1;
```
`status='failed'`, `failure_reason='agent stopped after dispatch'`.

**Notes:** Test ini verify Phase 2 design decision: race antara `web POST → FCM dispatch` dan `user Stop` dibikin audit-friendly (failed row dengan reason spesifik) instead of silent drop. Owner melihat di Tab History → tahu kenapa nota tidak tercetak.

---

# I. Printer offline (physical printer matikan, agent online)

## I1. Print job gagal → status=failed di history

**Precondition:** Agent online, printer dapur fisik dimatikan (atau kabel cabut).

**Steps:**
1. Buka detail tx, klik "Cetak ulang Dapur"
2. Tunggu 5-10 detik

**Expected:**
- Toast (di app/UI): error kemungkinan tidak surface langsung di web (FCM fire-and-forget)
- Di agent app tab History: row baru status `failed`, failure_reason `Connection timeout` atau similar
- Di web `/setup/printer/debug`: row baru status FAILED dengan target=dapur

**DB verify:**
```sql
SELECT status, failure_reason, failed_at FROM print_history
WHERE tx_id='<id>' AND target='dapur'
ORDER BY created_at DESC LIMIT 1;
```
`status='failed'`, `failure_reason` ada isinya.

**Critical:** `printed_dapur_at` items TIDAK ter-update (karena failed, trigger ngga fire).
```sql
SELECT printed_dapur_at FROM transaction_items WHERE id IN (<item_ids>);
```
Flag tetap seperti sebelum percobaan.

---

## I2. Retry dari agent app history

**Precondition:** I1 sukses (ada row failed), nyalain printer fisik dapur.

**Steps:**
1. Di agent app, buka tab **History**
2. Tap row yang failed
3. Tekan tombol **Retry**

**Expected:**
- Agent re-send TCP print → printer cetak
- Row baru di history status='done'
- Row failed yang lama TETAP ada (audit preserved)
- `printed_dapur_at` items ter-update ke timestamp baru (dari row done baru)

**DB verify:**
```sql
SELECT id, status, created_at, done_at, failed_at FROM print_history
WHERE tx_id='<id>' AND target='dapur'
ORDER BY created_at DESC LIMIT 3;
```
- Row 1 (terbaru): `status='done'`, trigger='reprint', `done_at` recent
- Row 2 (lama): `status='failed'`, `failed_at` lama

---

## I3. Cetak tambahan setelah failed → re-includes failed item

**Precondition:** I1 ada (failed), printer masih off. Lakukan retry **TIDAK** dilakukan dulu.

**Steps:**
1. Nyalakan printer dapur
2. Buka detail tx di web
3. Klik "Cetak tambahan"

**Expected:**
- Karena `printed_dapur_at` items masih NULL (failed sebelumnya), items akan re-included
- Job baru fire, printer cetak normal
- Flag ter-update

**Notes:** Ini test important — even kalau owner ngga retry dari agent app, klik tambahan dari web tetap recover.

---

# J. Agent app tab History

## J1. List recent jobs filtered

**Steps (di agent app):**
1. Buka tab History
2. Filter chip: tap "All" → semua row tampil
3. Tap "Today" → hanya hari ini (business day)
4. Tap "Failed" → hanya status=failed

**Expected:**
- Total count sesuai filter
- Tiap row tampil: timestamp, target, trigger, status badge, customer_name/table_no kalau ada
- Row failed punya tombol Retry; row done tidak

---

## J2. Pull-to-refresh atau button refresh

**Steps:**
1. Trigger refresh action

**Expected:**
- List re-fetch dari Supabase
- Loading indicator briefly
- New rows muncul (kalau ada print baru sejak load terakhir)

---

# K. Retention / cleanup

## K1. Cron cleanup hapus print_history >7 hari

**Precondition:** Akses ke production cron run trigger atau manual test via curl ke `/api/cron/cleanup` dengan CRON_SECRET.

**Steps:**
1. Insert manual row print_history dengan `created_at = now() - interval '8 days'`:
   ```sql
   INSERT INTO print_history (tx_id, target, trigger, item_ids, bytes_b64, status, done_at, created_at)
   VALUES (NULL, 'dapur', 'test', NULL, 'dGVzdA==', 'done', now() - interval '8 days', now() - interval '8 days');
   ```
2. Trigger cron manual: `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/cleanup`
3. Verify row terhapus

**Expected:**
```sql
SELECT COUNT(*) FROM print_history WHERE created_at < now() - interval '7 days';
```
0 rows.

Wide event log show `print_history_deleted: 1` (atau lebih).

**Notes:** Test ini optional kalau owner mau verify retention sekarang. Jaman normal kelihatan dari cron log harian.

---

# L. Cleanup verification (Phase 3)

## L1. `print_queue` table tidak ada

**Steps:**
```sql
SELECT EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_name='print_queue') AS still_exists;
```

**Expected:** `still_exists = false`.

---

## L2. /api/print/queue/* routes return 404

**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<host>/api/print/queue
curl -s -o /dev/null -w "%{http_code}\n" https://<host>/api/print/queue/recent
```

**Expected:** Keduanya `404`.

---

## L3. Migration sequence applied benar

**Steps:**
```sql
SELECT version FROM supabase_migrations.schema_migrations
WHERE version LIKE '%print%' OR version LIKE '%history%' OR version LIKE '%agent_uuid%' OR version LIKE '%agent_heartbeats%' OR version LIKE '%printer_settings%' OR version LIKE '%transaction_items_printed%'
ORDER BY version;
```

**Expected:** Daftar mengandung minimal:
- `transaction_items_printed` (0013)
- `printer_settings_footer` (0014)
- `print_queue_item_ids` (0015)
- `mark_items_printed_trigger` (0016)
- `print_queue_constraints` (0017)
- `agent_heartbeats_agent_uuid_retrofit` (0011a — bisa muncul di mana saja)
- `print_history` (0018)
- `agent_heartbeats_status` (0019)
- `mark_items_printed_history_trigger` (0020)
- `drop_print_queue` (0021)

---

## L4. Debug page UI: tidak ada tombol Retry/Cancel lagi

**Precondition:** Phase 2 web Task 11 sudah ship (debug page switched dari `print_queue` ke `print_history`).

**Steps:**
1. Buka `/setup/printer/debug` di web.
2. Inspect row di list (kalau kosong, buat 1-2 jobs dulu lewat reprint test agar ada row).

**Expected:**
- Setiap row hanya tampil: agent_label, target, trigger, status badge, timestamps (created_at + done_at/failed_at), customer_name + table_no (via join transactions).
- Filter buttons: **"All / Done / Failed"** (bukan Pending — `print_history` tidak punya pending state).
- **TIDAK ADA** tombol "Retry" di row status='failed'.
- **TIDAK ADA** tombol "Cancel" (legacy untuk pending).
- Owner workflow change: untuk retry, owner buka agent app tab History → tap Retry (verified di scenario I2).

**Notes:** Verify perubahan UX Phase 2 web. Kalau masih ada tombol retry/cancel di debug page, kemungkinan client component lama belum di-update atau ada code path lama yang masih reachable. Test ini lightweight — visual inspect saja, tidak butuh DB query.

---

# M. Trigger DB

## M1. Trigger fires on kitchen success

**Precondition:** Ada tx confirmed dengan items NULL flag dapur.

**Steps:**
1. Note `printed_dapur_at` items sebelum print
2. Trigger print sukses (cetak ulang Dapur misalnya)
3. Setelah print fisik selesai + agent insert ke print_history dengan status='done'
4. Re-query flag

**Expected:**
- `printed_dapur_at` items berubah dari NULL ke timestamp `done_at` dari print_history row
- Items minuman tidak terpengaruh

---

## M2. Trigger SKIP kalau status=failed

**Precondition:** Printer fisik off (simulate failure).

**Steps:**
1. Note flag sebelum
2. Trigger print → fail
3. Re-query flag

**Expected:**
- Flag TIDAK berubah (tetap NULL kalau sebelumnya NULL)
- Row print_history status='failed'

---

## M3. Trigger SKIP kalau target=customer

**Steps:**
1. Note flag sebelum customer print
2. Klik Cetak nota customer → sukses
3. Re-query flag

**Expected:**
- Flag TIDAK berubah (item_ids null di customer job, trigger skip)
- Row history target='customer' status='done'

---

# N. Multi-printer scenarios (kalau ada >1 device agent)

**Catatan:** Test ini relevan kalau owner punya 2+ HP agent. Kalau cuma 1 device, skip section N.

## N1. Hanya 1 agent online → semua FCM dispatch ke dia

**Setup:** Agent A online, Agent B stopped.

**Steps:**
1. Trigger print dari web

**Expected:**
- Agent A cetak
- Agent B tidak respond (offline)
- 1 row print_history dengan agent_label=A

---

## N2. 2 agent online → first-write wins (unique pk job_id)

**Setup:** Agent A + Agent B keduanya online.

**Steps:**
1. Trigger print dari web

**Expected:**
- FCM dispatched ke keduanya
- Kemungkinan keduanya cetak fisik (printer rule: kalau ke IP sama → double print, kalau IP beda → split)
- Hanya 1 row print_history (unique constraint pada id)
- Agent yang kalah insert akan log warning di logcat

**Notes:** Untuk warung 1 lokasi 1 printer, ini scenario rare. Untuk multi-warung kemudian hari, perlu refine routing logic.

---

# Failure log template

Kalau ada scenario gagal, catat:

```
Scenario ID: [e.g. D2]
Status: FAIL
Expected: <what should happen>
Actual: <what happened>
Reproducibility: 1/1 | 1/3 | flaky
Severity: blocker | major | minor
Reproduction steps:
1. ...
2. ...
Screenshots/logs:
- <attach>
```

---

# Sign-off

- [ ] Section A (setup) — semua scenario PASS
- [ ] Section B (kitchen format) — PASS
- [ ] Section C (customer format) — PASS
- [ ] Section D (auto-print) — PASS
- [ ] Section E (Cetak tambahan) — PASS
- [ ] Section F (Cetak ulang full) — PASS
- [ ] Section G (Cetak nota customer) — PASS
- [ ] Section H (agent offline) — PASS
- [ ] Section I (printer offline) — PASS
- [ ] Section J (agent history) — PASS
- [ ] Section K (cron retention) — PASS atau deferred
- [ ] Section L (cleanup verification) — PASS
- [ ] Section M (DB triggers) — PASS
- [ ] Section N (multi-printer) — N/A atau PASS

**Tester:** _________________
**Tanggal:** _________________
**Catatan:**
