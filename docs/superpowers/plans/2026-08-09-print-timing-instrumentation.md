# Instrumentasi Waktu Cetak — Sisi Web & DB — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Halaman debug bisa membedakan job yang datang lewat FCM dari yang diselamatkan poller, dan memisahkan waktu perjalanan FCM dari waktu pemrosesan di agent.

**Architecture:** Dua kolom nullable baru di `print_history` yang diisi agent saat klaim. Perhitungan tetap di fungsi murni `lib/print-duration.ts`; API cuma meneruskan kolom, halaman debug cuma menampilkan.

**Tech Stack:** Next.js 16, Supabase/PostgREST, Vitest, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-08-09-print-timing-instrumentation-design.md`
**Spec sisi agent (repo lain, jangan diedit dari sini):** `pak-pon-print-agent/docs/2026-08-09-timing-instrumentation-and-fixes.md`

## Global Constraints

- Kedua kolom baru **nullable**, tanpa default, tanpa backfill. Baris lama dan APK lama harus tetap jalan.
- `claimed_via` hanya boleh `'fcm'` atau `'poll'` (CHECK constraint).
- `receive_to_claim_ms` integer ≥ 0.
- **`isSlow` tidak berubah**: `totalMs >= SLOW_THRESHOLD_MS` (5000), dihitung dari total.
- **Baris `failed` tetap memakai `failed_at`**, bukan `done_at`. Aturan lama tidak boleh ikut diubah.
- `deliverMs` = `sendMs − agentMs`, di-clamp ke 0; **null** (bukan 0) kalau salah satu tidak ada.
- Istilah UI: `fcm`, `agent`, `cetak`, badge `poll`. Warna lewat token (`text-brick`, `text-coal`, `text-coal-soft`).
- Konvensi repo: `lib/*` diuji; route handler & page **tidak** punya test.
- Test: `npx vitest run`. Lint: `npm run lint`. Typecheck: `npx tsc --noEmit`.

## File Structure

| Berkas | Tanggung jawab | Status |
|---|---|---|
| `supabase/migrations/0040_print_history_claim_source.sql` | dua kolom + CHECK | Create |
| `lib/print-duration.ts` | hitung `agentMs`/`deliverMs`, teruskan `claimedVia` | Modify |
| `lib/print-duration.test.ts` | kunci clamp + null-handling | Modify |
| `app/api/print/history/route.ts` | teruskan dua kolom | Modify |
| `app/(app)/setup/printer/debug/page.tsx` | tampilkan pecahan + badge `poll` | Modify |
| `CLAUDE.md` | catat kolom + arti badge | Modify |

---

### Task 1: Migrasi 0040

**Files:**
- Create: `supabase/migrations/0040_print_history_claim_source.sql`

**Interfaces:**
- Produces: kolom `print_history.claimed_via text NULL`, `print_history.receive_to_claim_ms integer NULL`.

- [ ] **Step 1: Tulis migrasi**

```sql
-- 0040_print_history_claim_source.sql
-- Pecah ruas "kirim" (created_at → printing_at) jadi dua bagian yang beda
-- sifatnya, dan tandai job yang FCM-nya tidak pernah sampai.
--
--   claimed_via         : 'fcm'  = agent menerima push dan langsung memproses
--                         'poll' = FCM TIDAK sampai; PendingJobPoller yang
--                                  memungutnya (sampai 60 detik kemudian)
--   receive_to_claim_ms : lama agent memproses sejak pesan/baris diterima
--                         sampai UPDATE klaim mendarat di Postgres
--
-- receive_to_claim_ms sengaja DURASI, bukan timestamp: agent mengukurnya
-- dengan jam monotonik (SystemClock.elapsedRealtime), jadi kebal dari jam
-- dinding tablet yang bisa melenceng dari jam server. Menambah stempel waktu
-- dari sisi agent akan mengulang jebakan done_at (lihat migrasi 0039).
--
-- Turunannya: FCM sampai = (printing_at - created_at) - receive_to_claim_ms.
--
-- Dua-duanya NULLABLE dan tanpa default. Baris lama memang tidak punya
-- nilainya, dan APK lama yang belum di-update harus tetap bisa mengklaim.
-- Menebak 'fcm' sebagai default akan mencemari statistik dengan tebakan yang
-- tidak bisa dibedakan dari pengukuran.

ALTER TABLE print_history ADD COLUMN claimed_via text
  CHECK (claimed_via IN ('fcm', 'poll'));

ALTER TABLE print_history ADD COLUMN receive_to_claim_ms integer
  CHECK (receive_to_claim_ms >= 0);
```

- [ ] **Step 2: Terapkan ke DB**

Terapkan lewat MCP Supabase `apply_migration` (project id ada di `.env.local` → `NEXT_PUBLIC_SUPABASE_URL`), nama migrasi `print_history_claim_source`, isi query = dua statement `ALTER TABLE` di atas (tanpa blok komentar).

- [ ] **Step 3: Verifikasi kolom + constraint benar-benar ada**

Jalankan SQL:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_name='print_history' and column_name in ('claimed_via','receive_to_claim_ms')
order by column_name;
```

Expected: dua baris, `is_nullable = YES`.

Lalu uji CHECK-nya benar-benar menolak nilai ngawur — ini yang membuktikan constraint terpasang, bukan sekadar kolomnya ada:

```sql
do $$
begin
  begin
    insert into print_history (tx_id, agent_label, target, trigger, item_ids, bytes_b64, status, claimed_via)
    values (null,'SMOKE 0040','customer','test',null,'AA==','pending','ngawur');
    raise exception 'GAGAL: claimed_via ngawur seharusnya ditolak';
  exception when check_violation then
    raise notice 'OK: check constraint claimed_via bekerja';
  end;
end $$;
```

Expected: selesai tanpa error (artinya CHECK menolak seperti yang diharapkan). Kalau muncul `GAGAL:`, constraint-nya tidak terpasang.

- [ ] **Step 4: Pastikan tidak ada baris uji tersisa**

```sql
select count(*) from print_history where agent_label like 'SMOKE%';
```

Expected: `0`. (Blok di Step 3 melakukan rollback otomatis karena exception di-handle di dalam sub-block; kalau hasilnya bukan 0, hapus manual dengan `delete from print_history where agent_label like 'SMOKE%';`)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0040_print_history_claim_source.sql
git commit -m "migrate: kolom claimed_via + receive_to_claim_ms di print_history"
```

---

### Task 2: Perluas `lib/print-duration.ts`

**Files:**
- Modify: `lib/print-duration.ts`
- Modify: `lib/print-duration.test.ts`

**Interfaces:**
- Consumes: nama kolom `claimed_via`, `receive_to_claim_ms` dari Task 1.
- Produces:
  - `export type ClaimedVia = 'fcm' | 'poll'`
  - `PrintJobTimestamps` bertambah `claimed_via: ClaimedVia | null` dan `receive_to_claim_ms: number | null`
  - `JobDuration` bertambah `agentMs: number | null`, `deliverMs: number | null`, `claimedVia: ClaimedVia | null`

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `lib/print-duration.test.ts`, di dalam `describe('computeJobDuration', …)` yang sudah ada. Perbarui juga helper `job()` yang sudah ada supaya memuat dua field baru (defaultnya null):

```ts
function job(over: Partial<PrintJobTimestamps> = {}): PrintJobTimestamps {
  return {
    status: 'done',
    created_at: T0,
    printing_at: null,
    done_at: null,
    failed_at: null,
    claimed_via: null,
    receive_to_claim_ms: null,
    ...over,
  };
}
```

Test baru:

```ts
  it('memecah ruas kirim jadi fcm dan agent', () => {
    const d = computeJobDuration(
      job({
        status: 'done',
        printing_at: at(2000),
        done_at: at(2200),
        claimed_via: 'fcm',
        receive_to_claim_ms: 300,
      }),
    )!;
    expect(d.sendMs).toBe(2000);
    expect(d.agentMs).toBe(300);
    expect(d.deliverMs).toBe(1700);
    expect(d.claimedVia).toBe('fcm');
  });

  it('meng-clamp deliverMs ke 0 kalau agentMs melebihi sendMs', () => {
    // Bisa terjadi: sendMs dari jam Postgres, agentMs dari jam monotonik
    // tablet. Pembulatan & jitter bikin agentMs sesekali sedikit lebih besar.
    const d = computeJobDuration(
      job({ printing_at: at(500), done_at: at(700), receive_to_claim_ms: 900 }),
    )!;
    expect(d.deliverMs).toBe(0);
  });

  it('baris lama tanpa kolom klaim: agentMs & deliverMs null', () => {
    const d = computeJobDuration(job({ printing_at: at(900), done_at: at(1200) }))!;
    expect(d.sendMs).toBe(900);
    expect(d.agentMs).toBeNull();
    expect(d.deliverMs).toBeNull();
    expect(d.claimedVia).toBeNull();
  });

  it('deliverMs null kalau printing_at tidak ada meski receive_to_claim_ms ada', () => {
    const d = computeJobDuration(job({ done_at: at(1200), receive_to_claim_ms: 300 }))!;
    expect(d.sendMs).toBeNull();
    expect(d.agentMs).toBe(300);
    expect(d.deliverMs).toBeNull();
  });

  it('meneruskan claimed_via poll apa adanya', () => {
    const d = computeJobDuration(
      job({ printing_at: at(60000), done_at: at(60200), claimed_via: 'poll', receive_to_claim_ms: 400 }),
    )!;
    expect(d.claimedVia).toBe('poll');
    expect(d.agentMs).toBe(400);
  });
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npx vitest run lib/print-duration.test.ts`
Expected: gagal — properti `agentMs`/`deliverMs`/`claimedVia` belum ada, dan TypeScript menolak field baru di fixture.

- [ ] **Step 3: Implementasi**

Di `lib/print-duration.ts`, tambahkan tipe dan perluas dua tipe yang ada:

```ts
export type ClaimedVia = 'fcm' | 'poll';
```

Tambahkan dua field di `PrintJobTimestamps`:

```ts
  claimed_via: ClaimedVia | null;
  receive_to_claim_ms: number | null;
```

Tambahkan tiga field di `JobDuration`:

```ts
  /** receive_to_claim_ms — lama agent memproses sebelum klaim mendarat. */
  agentMs: number | null;
  /** sendMs − agentMs, clamp 0. null kalau salah satunya tidak ada. */
  deliverMs: number | null;
  claimedVia: ClaimedVia | null;
```

Di akhir `computeJobDuration`, ganti objek return jadi:

```ts
  const agentMs =
    job.receive_to_claim_ms !== null && Number.isFinite(job.receive_to_claim_ms)
      ? Math.max(0, job.receive_to_claim_ms)
      : null;

  // Sisa waktu setelah pemrosesan agent dikeluarkan = perjalanan FCM.
  // Dua sumber waktu berbeda (Postgres vs jam monotonik tablet), jadi
  // selisihnya bisa sedikit negatif karena pembulatan — clamp ke 0.
  const deliverMs =
    sendMs !== null && agentMs !== null ? Math.max(0, sendMs - agentMs) : null;

  return {
    totalMs,
    sendMs: sendMs !== null && Number.isFinite(sendMs) ? sendMs : null,
    printMs: printMs !== null && Number.isFinite(printMs) ? printMs : null,
    agentMs,
    deliverMs,
    claimedVia: job.claimed_via,
    isSlow: totalMs >= SLOW_THRESHOLD_MS,
  };
```

⚠️ `sendMs` dipakai untuk menghitung `deliverMs` **sebelum** difilter `Number.isFinite`. Pastikan variabel `sendMs` yang dipakai di perhitungan `deliverMs` adalah nilai yang sudah bersih — kalau di implementasi sekarang `sendMs` bisa `NaN`, filter dulu ke variabel lokal dan pakai variabel itu di dua tempat, jangan menghitung `deliverMs` dari nilai mentah.

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `npx vitest run lib/print-duration.test.ts`
Expected: seluruh test di berkas itu PASS (12 lama + 5 baru = 17).

- [ ] **Step 5: Seluruh suite + lint + typecheck**

Run: `npx vitest run` → semua hijau
Run: `npm run lint` → bersih
Run: `npx tsc --noEmit` → bersih

Kalau ada berkas lain yang gagal ketik karena `PrintJobTimestamps` bertambah field, perbaiki di sana dengan menambahkan field-nya — jangan bikin field baru opsional untuk menghindari error.

- [ ] **Step 6: Commit**

```bash
git add lib/print-duration.ts lib/print-duration.test.ts
git commit -m "feat(print): hitung pecahan fcm/agent dari receive_to_claim_ms"
```

---

### Task 3: Teruskan kolom di API + tampilkan di halaman debug

**Files:**
- Modify: `app/api/print/history/route.ts`
- Modify: `app/(app)/setup/printer/debug/page.tsx`

**Interfaces:**
- Consumes: `computeJobDuration`, `formatDuration`, tipe `ClaimedVia` dari Task 2.

Tanpa test otomatis — repo ini tidak punya test untuk route handler maupun page (satu-satunya test di `app/` adalah `_schema*.test.ts`). Verifikasi manual di Step 4.

- [ ] **Step 1: API meneruskan dua kolom**

Di `app/api/print/history/route.ts`:

Tambahkan ke string `select` (setelah `printing_at`):

```
claimed_via, receive_to_claim_ms,
```

Tambahkan ke tipe `Row`:

```ts
      claimed_via: 'fcm' | 'poll' | null;
      receive_to_claim_ms: number | null;
```

Tambahkan ke objek hasil map:

```ts
        claimed_via: r.claimed_via,
        receive_to_claim_ms: r.receive_to_claim_ms,
```

- [ ] **Step 2: Tipe `Job` di halaman**

Di `app/(app)/setup/printer/debug/page.tsx`, tambahkan dua field di `type Job`:

```ts
  claimed_via: 'fcm' | 'poll' | null;
  receive_to_claim_ms: number | null;
```

- [ ] **Step 3: Ganti `DurationView`**

Ganti seluruh isi komponen `DurationView` yang sudah ada dengan:

```tsx
/**
 * Durasi job + pecahan ruasnya.
 * - `fcm`   = pesan berjalan dari server ke tablet
 * - `agent` = tablet memproses (cek sesi + klaim ke Supabase)
 * - `cetak` = socket ke printer sampai selesai
 *
 * Badge `poll` berarti FCM TIDAK pernah sampai dan job dipungut poller 60
 * detik — kehadirannya sendiri adalah gejala, bukan sekadar info. Untuk baris
 * itu ruas `fcm` tidak ditampilkan: tidak ada perjalanan yang bisa diukur.
 */
function DurationView({ job }: { job: Job }) {
  const d = computeJobDuration(job);
  if (!d) return <span className="text-coal-soft">—</span>;

  const parts: string[] = [];
  if (d.claimedVia !== 'poll' && d.deliverMs !== null) {
    parts.push(`fcm ${formatDuration(d.deliverMs)}`);
  }
  if (d.agentMs !== null) parts.push(`agent ${formatDuration(d.agentMs)}`);
  // Baris lama (belum punya kolom klaim) tetap tampil seperti sebelumnya.
  if (d.agentMs === null && d.sendMs !== null) parts.push(`kirim ${formatDuration(d.sendMs)}`);
  if (d.printMs !== null) parts.push(`cetak ${formatDuration(d.printMs)}`);

  return (
    <div>
      <div className="flex items-baseline gap-1">
        <span className={d.isSlow ? 'font-medium text-brick' : 'text-coal'}>
          {formatDuration(d.totalMs)}
        </span>
        {d.claimedVia === 'poll' && (
          <span className="rounded-full bg-brick/15 px-1.5 text-[10px] font-medium uppercase tracking-wide text-brick">
            poll
          </span>
        )}
      </div>
      {parts.length > 0 && (
        <div className="text-[10px] text-coal-soft">{parts.join(' · ')}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verifikasi manual**

Run: `npm run dev`, buka `http://localhost:3000/setup/printer/debug`.

Periksa:
1. Baris lama (mayoritas) tetap menampilkan `kirim … · cetak …` — belum ada kolom klaim, jadi bentuk lamanya harus utuh.
2. Tidak ada badge `poll` pada baris lama (kolomnya null, bukan `'poll'`).
3. Tabel desktop tidak bergeser kolomnya.

Baris ber-`fcm`/`agent` baru muncul setelah APK 1.2.0 terpasang — **bukan kegagalan implementasi kalau belum ada**. Konfirmasi lewat SQL:

```sql
select count(*) filter (where claimed_via is not null) as sudah_terisi, count(*) as total
from print_history;
```

- [ ] **Step 5: Lint + typecheck + suite**

Run: `npm run lint`, `npx tsc --noEmit`, `npx vitest run` — semuanya bersih.

- [ ] **Step 6: Commit**

```bash
git add app/api/print/history/route.ts "app/(app)/setup/printer/debug/page.tsx"
git commit -m "feat(debug): tampilkan pecahan fcm/agent + badge poll"
```

---

### Task 4: Catat di CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Tambah butir**

Di bagian **Print system**, tepat di bawah butir yang dimulai `- **Durasi job di \`/setup/printer/debug\``, sisipkan:

```markdown
- **`claimed_via` + `receive_to_claim_ms` (migrasi 0040, 2026-08-09)**: dua kolom nullable yang diisi agent saat klaim. `claimed_via='poll'` berarti **FCM tidak pernah sampai** dan job dipungut `PendingJobPoller` (badge merah `poll` di halaman debug — kehadirannya sendiri gejala, bukan info). `receive_to_claim_ms` adalah **durasi**, bukan timestamp, diukur agent dengan jam monotonik (`SystemClock.elapsedRealtime`) supaya kebal selisih jam tablet — jangan pernah menggantinya dengan stempel waktu dari sisi agent, itu mengulang jebakan `done_at`. Turunannya: `fcm = (printing_at − created_at) − receive_to_claim_ms`, di-clamp ke 0 karena dua sumber waktu berbeda. Butuh APK ≥1.2.0; baris lama & APK lama tetap jalan karena kedua kolom nullable. Spec `docs/superpowers/specs/2026-08-09-print-timing-instrumentation-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: catat kolom claimed_via + receive_to_claim_ms"
```

---

## Self-Review

**Cakupan spec:**

| Bagian spec | Task |
|---|---|
| Migrasi 0040, dua kolom nullable + CHECK | Task 1 |
| Tanpa backfill, tanpa default | Task 1 Step 1 (komentar) |
| Model pengukuran kebal skew | Task 1 komentar + Task 2 Step 3 komentar |
| `deliverMs` clamp 0, null kalau salah satu null | Task 2 Step 1 (2 test) + Step 3 |
| `isSlow` & aturan `failed` tidak berubah | Global Constraints; Task 2 Step 3 mempertahankannya |
| API meneruskan dua kolom | Task 3 Step 1 |
| Tiga bentuk tampilan (fcm / poll / baris lama) | Task 3 Step 3 |
| Badge `poll` warna peringatan | Task 3 Step 3 |
| Testing `lib/print-duration` | Task 2 Step 1 |
| Risiko APK lama + DB baru | Task 1 (nullable), Task 3 Step 4 butir 1–2 |

Tidak ada bagian spec tanpa task.

**Placeholder:** tidak ada TBD/TODO; tiap langkah kode memuat kode utuh.

**Konsistensi tipe:** `ClaimedVia = 'fcm' | 'poll'` dipakai identik di `lib`, tipe `Row` API, tipe `Job` halaman, dan test. Nama kolom `claimed_via` / `receive_to_claim_ms` sama di SQL, `select`, `Row`, `Job`, `PrintJobTimestamps`. Nama field hasil `agentMs`/`deliverMs`/`claimedVia` sama di tipe, test, dan JSX.
