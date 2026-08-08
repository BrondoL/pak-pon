# Umpan Balik Tap di Kartu Menu — Design Spec

**Tanggal:** 2026-08-08
**Status:** Draft
**Terkait:** `docs/superpowers/specs/2026-08-07-unified-tap-to-add-design.md` (perilaku tap-to-add yang jadi dasar)

## Masalah

Owner melapor: di tampilan HP, setelah tap kartu menu tidak ada tanda apa pun bahwa itemnya masuk. Daftar item ada di bawah layar, harus scroll untuk memastikan.

Akar masalahnya bukan tata letak, tapi kartu menunya sendiri. `components/pos/pos-menu-picker.tsx:74`:

```
className="… transition-colors hover:bg-cream"
```

Di layar sentuh **tidak ada `hover`**, dan tidak ada state `active:`. Jadi menekan kartu menu menghasilkan nol perubahan di titik yang disentuh jari. Satu-satunya yang berubah ada di tempat lain: kartu keranjang (di bawah fold pada `/pos` mobile) dan angka total di bar bawah.

Tata letaknya sendiri sudah masuk akal dan tidak diubah:

| Tempat | Letak daftar item |
|---|---|
| `/pos` mobile | kolom tunggal — picker di atas, keranjang di bawahnya (perlu scroll) |
| `AddItemsModal` (monitor `+ Item`, review) | dipatok di footer modal, tapi `max-h-52` dengan scroll sendiri |

## Tujuan

Tap kartu menu memberi tanda seketika **di kartu yang disentuh**, tanpa perlu melihat ke tempat lain.

Karena `PosMenuPicker` dipakai bersama `/pos` dan `AddItemsModal`, satu perubahan menutup ketiga tempat: `/pos`, `+ Item` di monitor, dan tambah item di review.

## Non-tujuan

Sengaja tidak dikerjakan — owner hanya mengeluhkan "tap-nya masuk atau tidak", bukan kehilangan jejak isi keranjang:

- Badge jumlah menetap di kartu menu
- Toast yang menyebut nama item
- Getar (haptic)
- Auto-scroll daftar draft di `AddItemsModal`

Kalau setelah ini masih terasa kurang, masing-masing jadi pekerjaan terpisah.

## Rancangan

### Perilaku

Kartu menyala warna hangat (`--color-mustard-faint`) selama ~400ms **setelah baris benar-benar mendarat di daftar**, lalu memudar kembali ~500ms. Berlaku untuk baris baru maupun qty naik pada baris yang sudah ada.

Kalau tap membuka `PosItemConfigModal` (menu ber-`mutex_group`; di produksi cuma Ayam goreng — Dada/Paha), kartu **tidak** menyala. Modalnya sendiri sudah jadi umpan balik yang jauh lebih kuat, dan kalau dibatalkan memang tidak ada baris yang ditambahkan — menyalakan kartu di situ akan berbohong.

Aturannya satu kalimat: **kilatan menandakan hasil, bukan sentuhan.**

### Kontrak

`onMenuTap` berubah mengembalikan `boolean`:

```ts
export function PosMenuPicker({
  menus,
  onMenuTap,
}: {
  menus: MenuOption[];
  /** `true` = baris mendarat di daftar (picker menyalakan kartu).
   *  `false` = parent membuka modal konfigurasi (tanpa kilatan). */
  onMenuTap: (menu: MenuOption) => boolean;
})
```

Kedua parent sudah punya bentuk yang sama persis (cabang mutex `return` lebih awal, sisanya jatuh ke `addOrIncrementDraft`), jadi perubahannya dua baris di masing-masing: `return false` di cabang mutex, `return true` di akhir.

Alternatif yang ditolak:

- **Prop `justAdded={menuId, nonce}` dari parent** — perlu state baru di dua parent, dan `nonce` cuma ada untuk memaksa animasi mengulang. Lebih banyak bagian bergerak untuk hasil yang sama.
- **Picker memutuskan sendiri lewat `needsChipConfig(menu)`** — nol perubahan parent, tapi keputusan "menu ini masuk langsung atau buka modal" jadi hidup di dua tempat. Kalau aturannya berubah, satu tempat pasti ketinggalan.

Nilai balik `boolean` menjaga keputusan itu tetap di parent; picker cuma menuruti apa yang dilaporkan.

### State di picker

```
flashId: string | null   // id menu yang sedang menyala
```

Tap → `onMenuTap(menu)` → kalau `true`: `setFlashId(menu.id)` + timer 400ms untuk mengosongkannya. Tap berulang pada kartu yang sama cukup me-reset timer — tidak ada animasi yang perlu di-restart.

Timer dibersihkan saat unmount supaya tidak `setState` pada komponen yang sudah dilepas (modal ditutup selagi kilatan jalan).

### Kelas CSS, bukan `@keyframes`

`app/globals.css:171` memasang, untuk pengguna yang mematikan animasi:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; }
}
```

Kilatan berbasis `@keyframes` akan **terhapus total** oleh aturan itu. Umpan balik ini fungsional, bukan hiasan — jadi tidak boleh hilang. Karena itu dipasang sebagai kelas yang di-toggle React, bukan animasi:

```css
/* Umpan balik tap — nyala seketika, padam perlahan lewat transition kartunya. */
.tap-flash,
.tap-flash:hover {
  background-color: var(--color-mustard-faint);
  transition: none;   /* nyala instan; pudarnya diurus transition milik kartu */
}
```

Kartunya sendiri memakai `transition-colors duration-500`, sehingga saat kelas dilepas warnanya memudar kembali.

Dua hal yang perlu diperhatikan implementasi:

1. **`:hover` ikut ditulis** supaya `hover:bg-cream` milik kartu tidak menang saat kursor kebetulan di atasnya (kasus desktop/tablet berpenunjuk). Kelas kustom di `globals.css` berada di luar `@layer`, jadi menang atas utilitas Tailwind yang berlapis — tapi tetap tulis `:hover` eksplisit dan verifikasi di browser.
2. **Di bawah `prefers-reduced-motion`** aturan `transition-duration: 0.01ms !important` membuat warnanya muncul dan hilang seketika tanpa memudar. Itu justru perilaku yang benar: sinyalnya tetap ada, geraknya hilang.

### Berkas yang berubah

| Berkas | Perubahan |
|---|---|
| `components/pos/pos-menu-picker.tsx` | tipe `onMenuTap` → `boolean`, state `flashId` + timer, kelas kondisional, `duration-500` di kartu |
| `app/globals.css` | kelas `.tap-flash` |
| `components/pos/pos-client.tsx` | `return false` / `return true` di `onMenuTap` |
| `components/add-items-modal.tsx` | idem di `handleMenuTap` |

Tanpa migrasi, tanpa dependensi baru, tanpa perubahan API.

## Testing

`pos-menu-picker.tsx` belum punya test — file baru `components/pos/pos-menu-picker.test.tsx`, dengan `onMenuTap` sebagai stub yang nilai baliknya diatur per kasus:

- `onMenuTap` mengembalikan `true` → kartu dapat kelas `tap-flash`; setelah timer maju (`vi.useFakeTimers`) kelasnya hilang
- `onMenuTap` mengembalikan `false` → kartu tidak pernah dapat `tap-flash`
- tap dua kali cepat pada kartu sama → masih menyala setelah tap kedua (timer ter-reset, bukan padam di jadwal tap pertama)
- unmount selagi menyala → tidak ada peringatan `setState` setelah unmount

Kontrak nilai balik di kedua parent diuji di berkas yang sudah ada (`components/add-items-modal.test.tsx` belum ada, dan tidak perlu dibuat — `AddItemsModal` sudah dirender oleh test monitor):

- `components/pos/pos-client.test.tsx` — tap menu biasa → kartunya menyala; tap menu ber-`mutex_group` → tidak menyala, `PosItemConfigModal` terbuka
- `components/monitor-add-item-modal.test.tsx` — hal yang sama lewat `AddItemsModal`

## Risiko

| Risiko | Penanganan |
|---|---|
| `hover:bg-cream` menang atas `.tap-flash` di perangkat berpenunjuk | tulis `.tap-flash:hover` eksplisit; verifikasi manual di browser |
| Warna `mustard-faint` kurang kontras di atas `paper-soft` | dua-duanya sudah ada di `@theme`; cek langsung, ganti ke `cream` kalau terlalu tipis |
| Kilatan terasa mengganggu saat tap beruntun cepat | durasi pendek (400ms tahan + 500ms pudar) dan hanya warna, tanpa gerak |
