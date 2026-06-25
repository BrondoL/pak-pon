# Pak Pon — Product Brief

## What

Internal web app untuk warung **Pecel Lele Pak Pon** (Bandar Lampung). Bukan public-facing. Dipakai kasir untuk input nota harian via foto → OCR → review → simpan; owner untuk reporting harian (closingan) dan bulanan (pemasukan + menu terlaris).

## Users

**1 akun share** — owner, kasir, siapapun login dengan kredensial yang sama. Akun dibuat 1x via Supabase Dashboard. No signup public.

## Devices

Tablet primer (di meja kasir), responsive ke HP.

## Core flow

1. Kasir foto nota di tablet → upload → Gemini OCR ekstrak item & total handwritten
2. Kasir review hasil OCR di list editable (edit/tambah/hapus item) → konfirmasi
3. **Auto-print 2 nota kitchen** (header + order number + items qty BIG, tanpa harga) — dapur (makanan/nasi) + minuman, lewat LAN thermal printer ESC/POS via Android print-agent app. Nota customer dengan harga + total + footer "Terima kasih" tersedia manual by request dari halaman detail transaksi.
4. Owner lihat report harian (angka pemasukan untuk samakan dengan uang fisik) & bulanan (chart + top menu)
5. Owner kelola menu master (CRUD, soft-deactivate)
6. History transaksi: list, edit, soft-delete; cron cleanup hard-delete >7 hari

## Business rules

- Cut-off harian: midnight-to-midnight (00:00–23:59 WIB)
- Harga: snapshot saat transaksi (transaksi historis aman dari perubahan menu master)
- Pembayaran: TIDAK di-track (mirror nota fisik, hindari input manual)
- Soft delete transaksi 7 hari, lalu cron hapus permanen termasuk foto nota
- Menu yang sudah dipakai transaksi: `is_active=false` (tidak ada hard delete)

## Out of scope (MVP)

Payment method tracking, tax/service charge/discount, menu variants berharga beda, multi-user role, signup public, inventory, user-facing push notifications, export CSV. Lihat spec §15.

> **Catatan:** print struk awalnya out-of-scope MVP, sekarang sudah live via print-agent Android app. Arsitektur terkini FCM-only dengan format kitchen (BIG) vs customer (dengan harga) — lihat `docs/superpowers/specs/2026-06-25-print-revamp-design.md`.
