# Pak Pon — Web (POS + Reporting)

Internal web app untuk **warung Pecel Lele Pak Pon** (Bandar Lampung). Kasir foto nota → OCR Gemini → review editable → simpan + auto-print ke printer LAN dapur/minuman. Owner reporting harian & bulanan + kelola menu master. Bukan public-facing, 1 akun share.

Companion Android app (print agent) di repo terpisah: **[pak-pon-print-agent](https://github.com/BrondoL/pak-pon-print-agent)** (atau lokal `/home/brondol/Downloads/pak-pon-print-agent`).

---

## Status

- ✅ **MVP live in production** — kasir + owner workflow end-to-end
- ✅ **Print system** shipped 2026-06-25 (FCM-only), primary-agent + pending state 2026-06-26
- ✅ **OCR optimization** shipped 2026-06-30 (single-model no-retry) + 2026-07-01 (responseSchema migration)
- 📊 Volume: ~150 tx/hari. OCR bill ~540k IDR/bulan post-optimization.

---

## Tech stack

- **Framework**: Next.js 16.2 App Router + React 19.2 + TypeScript 5 strict
- **DB / Auth / Storage**: Supabase (Postgres + email/password + private bucket `notas`)
- **OCR**: Gemini `gemini-3.5-flash` via `@google/genai` (single model, `responseSchema` enum constraint)
- **Push (print dispatch)**: Firebase Cloud Messaging → Android agent app
- **UI**: shadcn/ui + Tailwind CSS 4 + Sonner toasts
- **Deploy**: Vercel (region `sin1` Singapore) + Vercel Cron
- **Test**: Vitest (unit + integration) + Testing Library React

---

## Getting started

### 1. Prerequisites

- Node.js 20+ (Node 24 LTS recommended)
- Supabase project (see access info di `pak-pon-print-agent/README.md` atau spec docs)
- Gemini API key (`gemini-3.5-flash` accessible)
- Firebase project + service account JSON (for FCM print dispatch)

### 2. Install

```bash
git clone <repo>
cd pak-pon
npm install
```

### 3. Env vars

Copy `.env.example` → `.env.local` dan isi:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable_key>
SUPABASE_SECRET_KEY=<secret_key>

# Gemini
GEMINI_API_KEY=<api_key>
# GEMINI_FAST_MODEL=gemini-3.5-flash        # default (optional override)
# NEXT_PUBLIC_IMAGE_MAX_WIDTH=1600          # client compress max dim (256-4096)

# Business
CRON_SECRET=<random_string>
NEXT_PUBLIC_BUSINESS_DAY_CUTOFF_HOURS=12

# Firebase (print dispatch)
FIREBASE_SERVICE_ACCOUNT_B64=<base64_json>
GOOGLE_APPLICATION_CREDENTIALS=/path/to/firebase-admin.json  # dev only
```

### 4. Migrations

Apply Supabase migrations (see `supabase/migrations/*.sql`) via CLI atau dashboard.

### 5. Run

```bash
npm run dev            # http://localhost:3000
npm run build          # production build
npm run start          # serve production
npm run lint           # ESLint
npm run test           # Vitest run-once
npm run test:watch     # watch mode
```

### 6. Local printer testing (optional)

```bash
npm run emulator:dapur     # TCP listener :9100
npm run emulator:minuman   # TCP listener :9101
```

Agent app kirim ESC/POS bytes ke IP:port ini, dump ke stdout untuk verify format.

---

## Core flow

1. **Kasir foto nota** di tablet → client-side compress (`lib/compress.ts`) → upload
2. **OCR**: `POST /api/scan` → Gemini extract items (menu + qty + notes) + total handwritten
3. **Review**: kasir edit/tambah/hapus item, konfirmasi
4. **Save**: `PATCH /api/transactions/[id]` → confirmed + trigger print
5. **Print dispatch**: `POST /api/print/send` → INSERT `print_history(pending)` → FCM ke primary agent → agent TCP ke thermal printer → UPDATE `pending → done`
6. **Owner**: `/reports/daily` closingan, `/reports/monthly` chart + top menu, `/menu` master CRUD

---

## Key architecture

### OCR pipeline (single-model, post 2026-07-01)

- **Model**: `gemini-3.5-flash` only, no fallback. Kalau gagal → `EMPTY_RESULT`, kasir input manual.
- **Menu enum via `responseSchema`**: menu names constraint di Gemini native structured output config, tidak di prompt text. **Enum values = free input tokens** (verified empirically).
- **Short-key JSON output** (m/q/n/c/a/t/cn/tn) + Zod `.transform()` re-expand ke long-key untuk consumer code.
- **Wide-event log**: `ocr_attempts[].input_tokens/output_tokens/total_tokens` per attempt untuk cost monitoring.
- **Image tok quirk**: Gemini 3.5 Flash charge ~1089 hard min tok untuk **apapun** inline image (bahkan 192×256 thumbnail). Kompresi/crop **tidak** turunkan bill di model ini.

Detail: `docs/superpowers/specs/2026-07-01-ocr-image-schema-optimization-design.md`.

### Print system (FCM-only, post 2026-06-26)

- **Dispatch**: `/api/print/send` cek primary agent (`is_primary=true AND status='online' AND last_seen_at > now()-24h AND fcm_token IS NOT NULL`) → INSERT `print_history(pending)` → FCM ke 1 device (no fan-out, no race).
- **Agent**: Android Kotlin app (`pak-pon-print-agent` repo) — terima FCM atau polling 60s (fallback saat FCM freeze), UPDATE row jadi `done`/`failed`, kirim ESC/POS bytes ke thermal printer LAN port 9100.
- **Stale sweep**: cron `/api/cron/print-sweep` (*/5 min) mark pending >5min jadi `failed` reason `'timeout: agent did not ack'`.
- **Format**: kitchen ticket (dapur/minuman) double-size ESC/POS no-price. Customer receipt full format + footer.

Detail: `docs/superpowers/specs/2026-06-25-print-revamp-design.md`.

### Wide-event logging

`try/catch/finally` di semua route handler — `newEvent()` di awal, `evt.emit()` di finally. Domain-specific fields (`tx_id`, `ocr_attempts`, `computed_sum`, `mismatch`, dll). Library function tidak log sendiri, return data ke caller.

Pattern: `docs/logging.md`.

---

## Documentation

**Product & spec:**
- [`docs/brief.md`](docs/brief.md) — product brief + user stories
- [`docs/spec.md`](docs/spec.md) — pointer ke spec lengkap
- [`docs/tasks.md`](docs/tasks.md) — progress tracker per plan
- [`docs/logging.md`](docs/logging.md) — wide-event logging pattern

**Design specs (sumber kebenaran):**
- [`docs/superpowers/specs/2026-06-20-pak-pon-design.md`](docs/superpowers/specs/2026-06-20-pak-pon-design.md) — main design (data model, API contract, auth, UI)
- [`docs/superpowers/specs/2026-06-25-print-revamp-design.md`](docs/superpowers/specs/2026-06-25-print-revamp-design.md) — print arch (FCM-only, kitchen vs customer format)
- [`docs/superpowers/specs/2026-07-01-ocr-image-schema-optimization-design.md`](docs/superpowers/specs/2026-07-01-ocr-image-schema-optimization-design.md) — OCR arch + Gemini token findings

**Implementation plans (history):**
- `docs/superpowers/plans/*.md` — per-feature bite-sized task lists

**Agent AI guidance:**
- [`CLAUDE.md`](CLAUDE.md) — instructions untuk Claude Code + Codex sessions
- [`AGENTS.md`](AGENTS.md) — Next.js 16 breaking-change warning

---

## Deployment (Vercel)

Auto-deploy on push ke `master`. Env vars di-set via Vercel Dashboard → Settings → Environment Variables (mirror `.env.example`). Cron jobs via `vercel.json`:
- `/api/cron/cleanup` — hard-delete soft-deleted transaksi >7 hari + foto storage (planned data retention)
- `/api/cron/print-sweep` (*/5 min) — mark stale pending print jobs failed

---

## Repo companion

| Repo | Purpose |
|---|---|
| **this (`pak-pon`)** | Web app (Next.js) — kasir + owner UI, OCR pipeline, print dispatch, reporting |
| [`pak-pon-print-agent`](../pak-pon-print-agent) | Android Kotlin app — receive FCM/poll, TCP send ESC/POS ke LAN printer, UPDATE `print_history` |

Both share:
- Supabase project `nqptpijfrccjuytrslwc`
- Firebase project untuk FCM
- Wide-event log pattern (agent logs local, web logs to Vercel)
- Auth: same Supabase user across web + agent
