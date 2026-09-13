-- 0045_set_role_permissions.sql
-- Ganti-seluruh-set izin role dalam SATU transaksi, biar tidak ada jendela
-- di antara DELETE dan INSERT yang bisa membuat role kehilangan semua izinnya
-- kalau langkah kedua gagal (network blip, error DB sesaat, dst).
--
-- Body plpgsql berjalan sebagai satu transaksi implisit: DELETE + INSERT
-- sama-sama masuk atau sama-sama batal. Tidak ada compensating write, tidak
-- ada jendela race antar dua panggilan network terpisah dari route handler.

CREATE OR REPLACE FUNCTION public.set_role_permissions(p_role_id uuid, p_keys text[])
RETURNS void
LANGUAGE plpgsql
-- SECURITY INVOKER (BUKAN DEFINER) dengan sengaja: fungsi ini harus tetap
-- tunduk pada policy RLS rp_insert/rp_delete (migrasi 0042), yang mensyaratkan
-- is_superadmin(auth.uid()). Kalau DEFINER, fungsi ini jalan dengan hak owner
-- tabel dan melewati pengecekan itu — jadi jalan eskalasi buat non-superadmin
-- yang entah bagaimana bisa memanggil RPC ini.
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  DELETE FROM role_permissions WHERE role_id = p_role_id;

  IF array_length(p_keys, 1) IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_key)
    SELECT p_role_id, unnest(p_keys);
  END IF;
END;
$$;

-- RLS pada role_permissions yang benar-benar menjaga; GRANT EXECUTE cuma
-- membuka pintu masuknya (sama seperti has_permission/is_superadmin di 0042,
-- kecuali fungsi-fungsi itu DEFINER karena harus baca profiles tanpa rekursi).
REVOKE EXECUTE ON FUNCTION public.set_role_permissions(uuid, text[]) FROM public;
GRANT EXECUTE ON FUNCTION public.set_role_permissions(uuid, text[]) TO authenticated;
