-- 0048_last_superadmin_guard.sql
-- Pindahkan invarian "minimal satu superadmin aktif harus tersisa" dari JS ke DB.
--
-- Sebelum ini penjagaannya cuma di `app/api/users/[id]/route.ts`: baca daftar
-- superadmin aktif → putuskan di JS (`canDemoteSuperadmin`) → tulis. Tiga langkah
-- terpisah tanpa transaksi, tanpa lock, tanpa constraint — TOCTOU klasik. Dua
-- request bersamaan yang menurunkan DUA superadmin BERBEDA sama-sama membaca
-- `[A, B]`, sama-sama menyimpulkan "masih ada satu yang tersisa", sama-sama
-- commit → nol superadmin aktif. Pemulihannya butuh SQL console Supabase, karena
-- /setup/users dan /setup/roles dua-duanya eksklusif superadmin dan tidak ada
-- key yang bisa diberikan ke siapa pun untuk membatalkannya.
--
-- Ini juga menutup lubang yang lebih kecil: superadmin yang menurunkan dirinya
-- sendiri lewat PostgREST langsung, melewati route handler sepenuhnya.
--
-- Cek JS di route handler SENGAJA DIPERTAHANKAN. Dia yang memberi pesan ramah
-- `409 last_superadmin` di jalur umum (satu-satunya superadmin menurunkan dirinya
-- sendiri) tanpa pernah menyentuh DB. Trigger ini backstop untuk jalur balapan
-- yang lolos cek itu.

CREATE OR REPLACE FUNCTION public.assert_superadmin_remains()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- ⚠️ Lock dulu, baru hitung. Tanpa ini trigger-nya MASIH bisa dibalap:
  -- dua transaksi yang commit hampir bersamaan sama-sama menjalankan trigger
  -- sebelum yang lain commit, jadi keduanya masih melihat superadmin milik
  -- lawannya dan keduanya lolos. Advisory lock transaksional menyerialkan
  -- pemeriksaannya — yang kedua menunggu sampai yang pertama commit, lalu
  -- menghitung ulang dan melihat kenyataan barunya. Lock dilepas otomatis di
  -- akhir transaksi; karena trigger ini DEFERRED, lock cuma dipegang sesaat
  -- saat commit.
  PERFORM pg_advisory_xact_lock(hashtext('profiles_last_superadmin_guard'));

  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE is_superadmin AND is_active
  ) THEN
    -- Pesan sengaja diawali token `last_superadmin` yang gampang dikenali:
    -- jalur DELETE di aplikasi lewat GoTrue (`auth.admin.deleteUser`), bukan
    -- PostgREST, dan GoTrue tidak selalu meneruskan SQLSTATE-nya utuh. Route
    -- handler mencocokkan SQLSTATE **atau** token ini, lalu memetakannya ke
    -- respons 409 `last_superadmin` yang sudah ada.
    RAISE EXCEPTION 'last_superadmin: minimal satu superadmin aktif harus tersisa'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

-- ⚠️ CONSTRAINT TRIGGER di Postgres WAJIB `AFTER ... FOR EACH ROW` — tidak ada
-- varian statement-level. Jadi fungsinya yang ditulis idempoten & statement-ish:
-- dia tidak melihat NEW/OLD sama sekali, cuma menghitung keadaan akhir tabel.
-- Dipanggil berkali-kali dalam satu statement multi-baris tetap benar dan murah
-- (idx_profiles_superadmin menjawabnya).
--
-- DEFERRABLE INITIALLY DEFERRED supaya pemeriksaannya di akhir transaksi, bukan
-- per-baris: swap superadmin dalam satu transaksi (turunkan A, angkat B) tetap
-- sah walau ada titik di tengah transaksi yang nol superadmin.
--
-- INSERT sengaja tidak ikut dijaga — INSERT tidak pernah bisa mengurangi jumlah
-- superadmin, dan tabel kosong di instalasi baru harus boleh ada sebelum backfill.
DROP TRIGGER IF EXISTS profiles_last_superadmin_guard ON profiles;
CREATE CONSTRAINT TRIGGER profiles_last_superadmin_guard
  AFTER UPDATE OR DELETE ON profiles
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_superadmin_remains();
