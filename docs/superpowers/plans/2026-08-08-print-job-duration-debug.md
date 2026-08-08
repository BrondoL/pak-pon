# Durasi Job Cetak di Halaman Debug — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Halaman `/setup/printer/debug` menampilkan durasi tiap job cetak, dipecah jadi ruas "kirim" dan "cetak", supaya delay bisa didiagnosis tanpa membuka SQL.

**Architecture:** Seluruh perhitungan tinggal di fungsi murni `lib/print-duration.ts` yang diuji sendiri. API `/api/print/history` cuma menambah `printing_at` ke `select`, dan halaman debug memasang hasil fungsinya jadi satu kolom baru.

**Tech Stack:** Next.js 16, React, Tailwind v4 (token di `app/globals.css`), Vitest, Supabase PostgREST.

**Spec:** `docs/superpowers/specs/2026-08-08-print-job-duration-debug-design.md`

## Global Constraints

- Kolom `print_history.printing_at` **sudah ada** di DB (migrasi 0039, diterapkan 2026-08-08). Tidak ada migrasi baru di rencana ini.
- **Pada baris `status='failed'`, `done_at` BUKAN waktu selesai** — agent menulis waktu klaim ke sana (`PrintHistoryRepository.claim()`) dan hanya `markDone` yang menimpanya. Durasi baris gagal wajib memakai `failed_at`.
- Ambang lambat: **`SLOW_THRESHOLD_MS = 5000`**, dibandingkan terhadap **total**, bukan per ruas.
- Selisih waktu negatif di-clamp ke 0 per ruas (jam tablet bisa mundur dari jam Postgres). Akibatnya `sendMs + printMs === totalMs` hanya berlaku kalau tidak ada yang ter-clamp.
- Istilah di UI: **"kirim"** dan **"cetak"** — bukan "internet"/"LAN". Owner ikut membaca halaman ini.
- Format durasi: koma desimal, satu angka di belakang, akhiran ` dtk` — mis. `"16,1 dtk"`.
- Styling lewat token (`text-brick`, `text-coal`, `text-coal-soft`), jangan hardcode warna.
- Konvensi repo: logika murni diuji (`lib/*.test.ts`), route handler & page **tidak** punya test — jangan bikin pola baru.
- Test: `npm run test`. Lint: `npm run lint`.

## File Structure

| Berkas | Tanggung jawab | Status |
|---|---|---|
| `lib/print-duration.ts` | hitung durasi + pecahan ruas + ambang lambat + format | Create |
| `lib/print-duration.test.ts` | kunci aturan `failed`/clamp/ambang | Create |
| `app/api/print/history/route.ts` | teruskan `printing_at` ke client | Modify |
| `app/(app)/setup/printer/debug/page.tsx` | tampilkan kolom Durasi (tabel + kartu mobile) | Modify |

---

### Task 1: Fungsi murni `lib/print-duration.ts`

**Files:**
- Create: `lib/print-duration.ts`
- Create: `lib/print-duration.test.ts`

**Interfaces:**
- Produces:
  - `SLOW_THRESHOLD_MS = 5000`
  - `type PrintJobStatus = 'pending' | 'printing' | 'done' | 'failed'`
  - `type PrintJobTimestamps = { status: PrintJobStatus; created_at: string; printing_at: string | null; done_at: string | null; failed_at: string | null }`
  - `type JobDuration = { totalMs: number; sendMs: number | null; printMs: number | null; isSlow: boolean }`
  - `computeJobDuration(job: PrintJobTimestamps): JobDuration | null`
  - `formatDuration(ms: number): string`
- Consumes: tidak ada.

- [ ] **Step 1: Tulis test yang gagal**

Buat `lib/print-duration.test.ts`:

```ts
// lib/print-duration.test.ts
import { describe, expect, it } from 'vitest';
import {
  computeJobDuration,
  formatDuration,
  SLOW_THRESHOLD_MS,
  type PrintJobTimestamps,
} from './print-duration';

const T0 = '2026-08-08T11:48:30.000Z';

/** T0 + n milidetik, sebagai string ISO. */
function at(ms: number): string {
  return new Date(new Date(T0).getTime() + ms).toISOString();
}

function job(over: Partial<PrintJobTimestamps> = {}): PrintJobTimestamps {
  return {
    status: 'done',
    created_at: T0,
    printing_at: null,
    done_at: null,
    failed_at: null,
    ...over,
  };
}

describe('computeJobDuration', () => {
  it('memecah job sukses jadi ruas kirim dan cetak', () => {
    const d = computeJobDuration(
      job({ status: 'done', printing_at: at(900), done_at: at(16100) }),
    )!;
    expect(d.totalMs).toBe(16100);
    expect(d.sendMs).toBe(900);
    expect(d.printMs).toBe(15200);
    // Identitas ini hanya berlaku karena semua selisih di fixture positif.
    expect(d.sendMs! + d.printMs!).toBe(d.totalMs);
  });

  it('baris lama tanpa printing_at tetap punya total, tanpa pecahan', () => {
    const d = computeJobDuration(job({ status: 'done', done_at: at(1200) }))!;
    expect(d.totalMs).toBe(1200);
    expect(d.sendMs).toBeNull();
    expect(d.printMs).toBeNull();
  });

  // Load-bearing: pada baris gagal, done_at berisi stempel KLAIM dari agent,
  // bukan waktu selesai. Fixture sengaja memasang keduanya dengan jarak jauh —
  // rumus yang keliru menghasilkan 900, bukan 5900.
  it('baris gagal memakai failed_at dan mengabaikan stempel klaim di done_at', () => {
    const d = computeJobDuration(
      job({ status: 'failed', done_at: at(900), failed_at: at(5900) }),
    )!;
    expect(d.totalMs).toBe(5900);
    expect(d.totalMs).not.toBe(900);
  });

  it('memecah ruas baris gagal dari printing_at, bukan done_at', () => {
    const d = computeJobDuration(
      job({ status: 'failed', printing_at: at(730), done_at: at(730), failed_at: at(5730) }),
    )!;
    expect(d.sendMs).toBe(730);
    expect(d.printMs).toBe(5000);
  });

  it('job yang belum ada ujungnya mengembalikan null', () => {
    expect(computeJobDuration(job({ status: 'pending' }))).toBeNull();
    expect(computeJobDuration(job({ status: 'printing', printing_at: at(800) }))).toBeNull();
  });

  it('mengembalikan null kalau stempel yang dibutuhkan hilang', () => {
    expect(computeJobDuration(job({ status: 'done', done_at: null }))).toBeNull();
    expect(computeJobDuration(job({ status: 'failed', failed_at: null }))).toBeNull();
  });

  it('mengembalikan null kalau stempelnya tidak bisa dibaca', () => {
    expect(computeJobDuration(job({ status: 'done', done_at: 'bukan tanggal' }))).toBeNull();
  });

  it('isSlow tepat di batas', () => {
    expect(computeJobDuration(job({ done_at: at(SLOW_THRESHOLD_MS - 1) }))!.isSlow).toBe(false);
    expect(computeJobDuration(job({ done_at: at(SLOW_THRESHOLD_MS) }))!.isSlow).toBe(true);
  });

  it('isSlow dihitung dari total, bukan salah satu ruas', () => {
    // Tiap ruas di bawah ambang, totalnya di atas.
    const d = computeJobDuration(
      job({ printing_at: at(3000), done_at: at(6000) }),
    )!;
    expect(d.sendMs).toBe(3000);
    expect(d.printMs).toBe(3000);
    expect(d.isSlow).toBe(true);
  });

  it('meng-clamp selisih negatif ke 0 saat jam tablet mundur', () => {
    const d = computeJobDuration(job({ status: 'done', done_at: at(-400) }))!;
    expect(d.totalMs).toBe(0);
  });
});

describe('formatDuration', () => {
  it('memakai koma desimal dan satu angka di belakang', () => {
    expect(formatDuration(1234)).toBe('1,2 dtk');
    expect(formatDuration(59800)).toBe('59,8 dtk');
    expect(formatDuration(0)).toBe('0,0 dtk');
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npx vitest run lib/print-duration.test.ts`
Expected: gagal karena `lib/print-duration.ts` belum ada (`Failed to resolve import`).

- [ ] **Step 3: Implementasi**

Buat `lib/print-duration.ts`:

```ts
// lib/print-duration.ts

/** Di atas ini ditandai merah di halaman debug. Diambil dari p90 terukur
 *  1-8 Agustus 2026: minuman p90 1,2 dtk, customer p90 5,6 dtk. */
export const SLOW_THRESHOLD_MS = 5000;

export type PrintJobStatus = 'pending' | 'printing' | 'done' | 'failed';

export type PrintJobTimestamps = {
  status: PrintJobStatus;
  created_at: string;
  printing_at: string | null;
  done_at: string | null;
  failed_at: string | null;
};

export type JobDuration = {
  totalMs: number;
  /** created_at → printing_at. null kalau printing_at tidak ada (baris lama). */
  sendMs: number | null;
  /** printing_at → akhir. null kalau printing_at tidak ada. */
  printMs: number | null;
  /** totalMs >= SLOW_THRESHOLD_MS. Dihitung dari total, bukan per ruas. */
  isSlow: boolean;
};

/**
 * Selisih milidetik, di-clamp ke 0. created_at & printing_at dari jam Postgres,
 * done_at & failed_at dari jam tablet — kalau jam tablet mundur, selisihnya bisa
 * negatif. NaN (stempel tak terbaca) dibiarkan lewat supaya pemanggil bisa
 * mendeteksinya.
 */
function diffMs(from: string, to: string): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Number.isNaN(ms) ? NaN : Math.max(0, ms);
}

/**
 * null kalau job belum punya ujung (pending/printing) atau stempelnya hilang /
 * tidak terbaca — sengaja null, bukan 0, supaya UI bisa membedakan "belum
 * selesai" dari "selesai dalam 0 detik".
 */
export function computeJobDuration(job: PrintJobTimestamps): JobDuration | null {
  // Pada baris `failed`, done_at BUKAN waktu selesai: agent menulis waktu klaim
  // ke sana (PrintHistoryRepository.claim) dan hanya markDone yang menimpanya.
  // Memakainya di sini menampilkan ~0,9 detik seolah durasi cetak — menyesatkan
  // justru ketika halaman ini sedang dipakai menyelidiki.
  const endedAt =
    job.status === 'done' ? job.done_at
    : job.status === 'failed' ? job.failed_at
    : null;
  if (endedAt === null) return null;

  const totalMs = diffMs(job.created_at, endedAt);
  if (!Number.isFinite(totalMs)) return null;

  const sendMs = job.printing_at ? diffMs(job.created_at, job.printing_at) : null;
  const printMs = job.printing_at ? diffMs(job.printing_at, endedAt) : null;

  return {
    totalMs,
    sendMs: sendMs !== null && Number.isFinite(sendMs) ? sendMs : null,
    printMs: printMs !== null && Number.isFinite(printMs) ? printMs : null,
    isSlow: totalMs >= SLOW_THRESHOLD_MS,
  };
}

/** 1234 → "1,2 dtk". Koma desimal, satu angka di belakang. */
export function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace('.', ',')} dtk`;
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `npx vitest run lib/print-duration.test.ts`
Expected: 11 test PASS.

- [ ] **Step 5: Lint + typecheck**

Run: `npm run lint`
Run: `npx tsc --noEmit`
Expected: dua-duanya bersih.

- [ ] **Step 6: Commit**

```bash
git add lib/print-duration.ts lib/print-duration.test.ts
git commit -m "feat(print): fungsi murni durasi job cetak + pecahan ruas"
```

---

### Task 2: Sambungkan ke API dan halaman debug

**Files:**
- Modify: `app/api/print/history/route.ts:23` (select), `:40-52` (tipe `Row`), `:57-71` (hasil map)
- Modify: `app/(app)/setup/printer/debug/page.tsx:18-32` (tipe `Job`), tabel desktop `:296-331`, kartu mobile `:254-295`

**Interfaces:**
- Consumes: `computeJobDuration`, `formatDuration` dari `lib/print-duration.ts` (Task 1).

Tidak ada test otomatis di task ini — repo ini tidak punya test untuk route handler maupun page (cek: satu-satunya test di `app/` adalah `_schema*.test.ts`). Penyambungannya diverifikasi manual di Step 5, dan itu memang titik paling mungkin salah: kalau `printing_at` lupa ditambahkan di `select`, halaman diam-diam menampilkan durasi tanpa pecahan, bukan error.

- [ ] **Step 1: Teruskan `printing_at` di API**

Di `app/api/print/history/route.ts`, ganti baris `select` (baris 23):

```ts
      .select('id, tx_id, agent_label, target, trigger, status, failure_reason, created_at, printing_at, done_at, failed_at, transactions(customer_name, table_no, daily_seq)')
```

Tambahkan field di tipe `Row` (setelah `created_at: string;`):

```ts
      printing_at: string | null;
```

Tambahkan di objek hasil map (setelah `created_at: r.created_at,`):

```ts
        printing_at: r.printing_at,
```

- [ ] **Step 2: Tambah `printing_at` ke tipe `Job` di halaman**

Di `app/(app)/setup/printer/debug/page.tsx`, dalam `type Job`, setelah `created_at: string;`:

```ts
  printing_at: string | null;
```

Tambahkan import di dekat import lain paling atas:

```tsx
import { computeJobDuration, formatDuration } from '@/lib/print-duration';
```

- [ ] **Step 3: Tambah komponen tampilan durasi**

Di `app/(app)/setup/printer/debug/page.tsx`, tepat setelah fungsi `formatTxLabel`, tambahkan:

```tsx
/**
 * Durasi job + pecahan ruasnya. "kirim" = sampai tablet mengklaim job,
 * "cetak" = tablet menyambung ke printer sampai selesai. Sengaja bukan
 * istilah teknis — owner ikut membaca halaman ini.
 */
function DurationView({ job }: { job: Job }) {
  const d = computeJobDuration(job);
  if (!d) return <span className="text-coal-soft">—</span>;
  return (
    <div>
      <div className={d.isSlow ? 'font-medium text-brick' : 'text-coal'}>
        {formatDuration(d.totalMs)}
      </div>
      {d.sendMs !== null && d.printMs !== null && (
        <div className="text-[10px] text-coal-soft">
          kirim {formatDuration(d.sendMs)} · cetak {formatDuration(d.printMs)}
        </div>
      )}
    </div>
  );
}
```

`Job` sudah memuat semua field yang diminta `PrintJobTimestamps`, jadi bisa dioper langsung tanpa konversi.

- [ ] **Step 4: Pasang di kartu mobile dan tabel desktop**

Di kartu mobile, tepat **setelah** blok `<div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-coal-soft">…</div>` (yang berisi Target/Trigger/Agent) dan **sebelum** blok `{j.failure_reason && …}`, sisipkan:

```tsx
                  <div className="mt-1 flex items-baseline gap-1 text-coal-soft">
                    <span>Durasi:</span>
                    <DurationView job={j} />
                  </div>
```

Di tabel desktop, tambahkan header di antara `Status` dan `Reason`:

```tsx
                    <th className="p-2 text-left text-coal">Durasi</th>
```

Dan sel yang bersesuaian, di antara `<td>` status dan `<td>` reason:

```tsx
                      <td className="p-2"><DurationView job={j} /></td>
```

Urutan kolom harus tetap cocok antara `<thead>` dan `<tbody>`: Time · Transaksi · Target · Trigger · Agent · Status · **Durasi** · Reason.

- [ ] **Step 5: Verifikasi manual**

Run: `npm run dev`, buka `http://localhost:3000/setup/printer/debug`.

Periksa empat hal:

1. **Baris lama tampil durasi total tanpa pecahan.** Semua 2.964 baris yang ada sekarang `printing_at`-nya NULL, jadi tidak boleh ada baris "kirim … · cetak …" di antaranya. Kalau muncul `—` untuk semua baris `done`, berarti Step 1 atau Step 2 kelewat.
2. **Baris gagal menampilkan durasi yang wajar.** Kegagalan `"IP printer dapur belum di-set"` terjadi hampir seketika, jadi angkanya harus di bawah ~3 detik, bukan angka aneh. Kalau baris gagal menampilkan durasi mirip 0,9 detik seragam, rumusnya salah memakai `done_at` — kembali ke Task 1.
3. **Angka ≥ 5 detik berwarna merah.**
4. **Tabel desktop tidak bergeser kolomnya** — header dan isi masih sejajar.

Untuk melihat baris ber-`printing_at` (yang menampilkan pecahan), tunggu job cetak baru terjadi setelah migrasi 0039 diterapkan. Kalau belum ada satu pun, itu bukan kegagalan implementasi — konfirmasi lewat SQL:

```sql
select count(*) filter (where printing_at is not null) as sudah_ada_pecahan,
       count(*) as total
from print_history;
```

- [ ] **Step 6: Lint + seluruh test**

Run: `npm run lint`
Run: `npx tsc --noEmit`
Run: `npm run test`
Expected: bersih semua; jumlah test bertambah 11 dari Task 1.

- [ ] **Step 7: Commit**

```bash
git add app/api/print/history/route.ts "app/(app)/setup/printer/debug/page.tsx"
git commit -m "feat(debug): kolom durasi job cetak + pecahan kirim/cetak"
```

---

### Task 3: Tutup spec

**Files:**
- Modify: `docs/superpowers/specs/2026-08-08-print-job-duration-debug-design.md` (baris `**Status:**`)
- Modify: `CLAUDE.md`

- [ ] **Step 1: Tandai spec shipped**

```markdown
**Status:** Shipped 2026-08-08 — plan: `docs/superpowers/plans/2026-08-08-print-job-duration-debug.md`
```

- [ ] **Step 2: Catat di CLAUDE.md**

Di bagian **Print system**, tepat di bawah butir `printing_at`, tambahkan:

```markdown
- **Durasi job di `/setup/printer/debug` (2026-08-08)**: kolom Durasi + pecahan "kirim" (`created_at→printing_at`) dan "cetak" (`printing_at→selesai`), merah kalau total ≥5 dtk. Hitungannya di fungsi murni `lib/print-duration.ts` (`computeJobDuration`, `formatDuration`) + test. ⚠️ Baris `status='failed'` **wajib** pakai `failed_at`, bukan `done_at` — `done_at` di baris gagal berisi stempel klaim dari agent, jadi rumus yang salah menampilkan ~0,9 dtk seolah durasi cetak. Baris sebelum migrasi 0039 `printing_at`-nya NULL → tampil total saja tanpa pecahan, tidak bisa di-backfill. Spec `docs/superpowers/specs/2026-08-08-print-job-duration-debug-design.md`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-08-print-job-duration-debug-design.md CLAUDE.md
git commit -m "docs: tandai kolom durasi job debug sudah shipped"
```

---

## Self-Review

**Cakupan spec:**

| Bagian spec | Task |
|---|---|
| Jebakan `done_at` bermakna ganda | Task 1 Step 3, dikunci 2 test di Step 1 |
| Pecahan dua ruas (kirim/cetak) | Task 1 Step 3; ditampilkan Task 2 Step 3 |
| Clamp negatif | Task 1 Step 3 (`diffMs`), diuji Step 1 |
| Ambang 5 dtk dari total | Task 1 Step 3, dua test batas + test "dari total" |
| Baris lama tanpa `printing_at` | Task 1 Step 1 (test), Task 2 Step 5 butir 1 |
| Istilah "kirim"/"cetak" | Task 2 Step 3 |
| `null` bukan `0` untuk job belum selesai | Task 1 Step 3, dua test |
| Format `"16,1 dtk"` | Task 1, `formatDuration` + test |
| `printing_at` di `select` API | Task 2 Step 1 |
| Kolom di tabel + kartu mobile | Task 2 Step 4 |
| Catatan skew jam tablet | Task 1 Step 3 (komentar `diffMs`), Task 3 Step 2 |

Tidak ada bagian spec tanpa task.

**Placeholder:** tidak ada TBD/TODO; tiap langkah kode memuat kode utuh.

**Konsistensi tipe:** `computeJobDuration(job: PrintJobTimestamps): JobDuration | null` dan `formatDuration(ms: number): string` dipakai identik di test, implementasi, dan `DurationView`. Nama field `totalMs`/`sendMs`/`printMs`/`isSlow` sama di tipe, test, dan JSX. `SLOW_THRESHOLD_MS` dipakai di implementasi dan dua test batas. Nama kolom `printing_at` sama di SQL, API, tipe `Row`, tipe `Job`, dan `PrintJobTimestamps`.
