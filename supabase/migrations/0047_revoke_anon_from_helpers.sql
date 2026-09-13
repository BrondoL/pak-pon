-- 0047_revoke_anon_from_helpers.sql
-- Jebakan yang PERSIS SAMA dengan yang dicatat migrasi 0044, terulang tiga file
-- lebih awal di branch yang sama.
--
-- Migrasi 0042 menulis `REVOKE ... FROM public; GRANT ... TO authenticated;` dengan
-- maksud "cuma yang login boleh panggil". Itu TIDAK cukup. Supabase memasang
-- DEFAULT PRIVILEGES yang memberi `anon`, `authenticated`, dan `service_role`
-- EXECUTE otomatis pada tiap fungsi baru di schema public — grant PER-ROLE, bukan
-- lewat PUBLIC. `REVOKE ... FROM PUBLIC` hanya mencabut grant ke pseudo-role
-- PUBLIC; grant per-role `anon=X/postgres` tidak tersentuh dan tetap menempel.
--
-- Diverifikasi live di pg_proc.proacl sebelum migrasi ini (2026-09-13):
--   has_permission        {postgres=X,anon=X,authenticated=X,service_role=X}
--   is_superadmin         {postgres=X,anon=X,authenticated=X,service_role=X}
--   set_role_permissions  {postgres=X,anon=X,authenticated=X,service_role=X}
--   report_monthly        {=X,postgres=X,anon=X,authenticated=X,service_role=X}
--
-- Kenapa berbahaya: `has_permission` dan `is_superadmin` SECURITY DEFINER, dan
-- PostgREST otomatis mengekspos fungsi apa pun yang role pemanggilnya punya
-- EXECUTE di `/rest/v1/rpc/<name>`. Artinya pemanggil TANPA login sama sekali —
-- cuma pegang publishable key yang memang ada di bundle browser — bisa POST
-- `rpc/is_superadmin` atau `rpc/has_permission` dengan `user_id` siapa pun dan
-- dapat jawaban boolean yang JUJUR. Itu oracle izin: melewati RLS bukan karena
-- bug, tapi karena memang itu gunanya SECURITY DEFINER. `set_role_permissions`
-- SECURITY INVOKER sehingga panggilan `anon` mandul (RLS rp_insert/rp_delete
-- menolak), tapi grant-nya tetap tidak boleh ada — pintunya yang salah terbuka,
-- bukan cuma isinya yang kebetulan kosong.
--
-- `report_monthly` (pembungkus izin dari 0043) ikut dibereskan: hari ini tidak
-- bisa dieksploitasi hanya karena `has_permission(auth.uid(), ...)` di dalam
-- body-nya menolak uid NULL. Itu mekanisme kedua; grant yang seharusnya tidak
-- ada tidak boleh disandarkan padanya. Perhatikan ACL-nya juga punya `=X`
-- (PUBLIC) karena default Postgres memberi EXECUTE ke PUBLIC untuk fungsi baru,
-- jadi di sini REVOKE FROM PUBLIC dan FROM anon dua-duanya diperlukan.
--
-- ⚠️ `service_role` SENGAJA TIDAK DISENTUH (putusan yang sama dengan 0044): itu
-- secret key sisi server yang memang melewati RLS di mana-mana, jadi mencabutnya
-- tidak menambah keamanan tapi berisiko mematahkan cron job / skrip admin.
-- ⚠️ `authenticated` juga TIDAK disentuh — aplikasinya butuh keempat fungsi ini.

REVOKE EXECUTE ON FUNCTION public.is_superadmin(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_superadmin(uuid) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.has_permission(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_permission(uuid, text) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.set_role_permissions(uuid, text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_role_permissions(uuid, text[]) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.report_monthly(timestamptz, timestamptz, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.report_monthly(timestamptz, timestamptz, int) FROM PUBLIC;
