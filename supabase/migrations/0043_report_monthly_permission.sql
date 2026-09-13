-- 0043_report_monthly_permission.sql
-- Menutup jalur PostgREST langsung: tanpa ini, kasir yang izin bulanannya dicabut
-- masih bisa memanggil rpc/report_monthly dari browser memakai publishable key
-- dan mendapat omzet sebulan.
--
-- Agregasinya TIDAK diubah — fungsi lama dipindah jadi report_monthly_data,
-- lalu dibungkus penjaga izin. Memakai plpgsql karena RAISE tidak ada di LANGUAGE sql,
-- dan menaruh penjaga sebagai predikat WHERE di dalam SQL body TIDAK aman:
-- bulan tanpa transaksi menghasilkan nol baris, predikatnya tidak pernah dievaluasi,
-- dan penjagaannya lolos diam-diam.

ALTER FUNCTION report_monthly(timestamptz, timestamptz, int) RENAME TO report_monthly_data;
REVOKE EXECUTE ON FUNCTION report_monthly_data(timestamptz, timestamptz, int) FROM authenticated;

-- ⚠️ Pembungkusnya SECURITY DEFINER supaya bisa memanggil fungsi dalam yang sudah
-- di-REVOKE. Konsekuensinya agregasi berjalan sebagai owner sehingga RLS tabel
-- transactions dilewati. Hari ini tidak mengubah perilaku apa pun — RLS transactions
-- masih "authenticated boleh ALL" — tapi kalau kelak RLS itu diperketat, fungsi ini
-- harus ditinjau ulang.
CREATE OR REPLACE FUNCTION report_monthly(
  p_start        timestamptz,
  p_end          timestamptz,
  p_cutoff_hours int
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_permission(auth.uid(), 'reports.monthly.view') THEN
    RAISE EXCEPTION 'forbidden: reports.monthly.view required' USING ERRCODE = '42501';
  END IF;
  RETURN report_monthly_data(p_start, p_end, p_cutoff_hours);
END;
$$;

GRANT EXECUTE ON FUNCTION report_monthly(timestamptz, timestamptz, int) TO authenticated;
