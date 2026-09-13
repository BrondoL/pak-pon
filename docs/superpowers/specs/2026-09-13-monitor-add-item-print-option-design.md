# Opsi cetak saat tambah item di monitor

Tanggal: 2026-09-13
Status: disetujui, siap implementasi

## Masalah

`MonitorAddItemModal` **selalu** mencetak. Begitu `POST /api/transactions/[id]/items`
balik 201, item baru dibelah `splitItemsByPrintTarget` lalu `dispatchKitchenPrintJob`
ditembak untuk target `dapur` dan/atau `minuman` (trigger `auto_additional`), tanpa
jalan keluar. Padahal kasir sering menambahkan item yang dapur sudah tahu (diteriakkan
langsung, atau item minuman yang sudah diracik) — kertas yang keluar cuma sampah.

## Keputusan

Satu switch "Cetak tiket dapur" di footer modal, **default mati**. Cetak jadi tindakan
yang dipilih, bukan yang terjadi diam-diam.

Default mati dipilih sadar: kasus umum di warung ini adalah item susulan yang sudah
terkomunikasikan lisan. Kalau default nyala, kasir harus ingat mematikan tiap kali —
lebih sering salah daripada sebaliknya.

## Perubahan

### `components/add-items-modal.tsx`

Prop opsional baru:

```ts
footerToggle?: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
};
```

Kalau ada, render `Switch` + `Label` (`components/ui/switch.tsx`) di baris sendiri
tepat di atas tombol Batal/Simpan. Kalau tidak dikirim, footer identik dengan sekarang —
`nota-review-form` yang memakai modal yang sama tidak ikut berubah.

State switch **tidak** hidup di sini. Komponen ini sengaja tidak tahu apa-apa soal
menyimpan (lihat docstring-nya); cetak urusan parent yang sama. Prop-nya dinamai netral
(`footerToggle`, bukan `printToggle`) supaya batasan itu tetap jujur.

### `components/monitor-add-item-modal.tsx`

- `const [printTicket, setPrintTicket] = useState(false)` — reset tiap modal mount,
  tidak dipersist antar-pembukaan.
- Blok dispatch `dapur`/`minuman` dibungkus `if (printTicket)`.
- `confirmLabel` ikut state: mati → `✓ Simpan Rp …`, nyala → `✓ Simpan & Cetak Rp …`.
- Toast sukses tanpa cetak: `"N item ditambahkan (tanpa cetak)"` — supaya kasir tidak
  menunggu kertas yang tidak akan keluar.
- Switch `disabled` selama `submitting`.

## Yang sengaja tidak disentuh

- `POST /api/transactions/[id]/items` nol perubahan. Cetak memang selalu dikirim dari
  klien, bukan server — tidak ada yang perlu diubah di sisi API.
- Jalur error tetap sama. Guard `saved` (anti dobel-insert saat retry) tetap berlaku;
  cabang "insert commit tapi cetak gagal" sekarang hanya bisa kena kalau switch nyala.
- `/pos` dan `nota-review-form` tetap auto-cetak seperti biasa. Perubahan ini khusus
  item susulan dari monitor.
- Tanpa migrasi.

## Konsekuensi yang disadari

Item yang disimpan tanpa cetak `printed_dapur_at` / `printed_minuman_at`-nya tetap NULL,
jadi masih muncul sebagai bisa dicetak lewat "Cetak tambahan" di detail transaksi —
melewatkan cetak bukan jalan buntu. Tapi tidak ada pengingat di kartu monitor: kalau
dapur ternyata perlu tahu, kasir harus ingat sendiri ke halaman detail.

Catatan: item makanan (`dapur`) toh tidak pernah benar-benar tercetak di produksi karena
IP printer dapur sengaja tidak di-set (lihat CLAUDE.md) — dampak nyata switch ini
terutama di tiket `minuman`.

## Verifikasi

`npm run lint`, `npm run test`, `npm run build`. Tidak ada helper murni baru, jadi tidak
ada unit test tambahan; perubahannya murni perkabelan komponen.
