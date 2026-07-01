# OCR Image + Schema Optimization Design

**Date:** 2026-07-01
**Status:** Approved, ready for implementation plan
**Prior context:** `docs/superpowers/plans/2026-06-30-ocr-token-reduction.md` (single-model + prompt trim, shipped)

## Motivation

Post prev optimization, per-scan cost ~1900 tok di Gemini 3.5 Flash. Volume produksi 150 tx/hari → console AI Studio menunjukkan bill lumayan (est. ~600k IDR/bulan). Target: turunin lagi ~30-40% dengan risk terkendali.

Prev round sudah pangkas prompt + output. Sisa lever besar: **image (58% dari total tok)** belum disentuh.

## Goals

- Turunkan input tokens per scan dari ~1691 → **~1000-1200**
- Turunkan monthly bill dari ~600k IDR → **~350-400k IDR**
- Zero regression accuracy (`items_count`, `handwritten_total`, low-conf rate stable)
- Configurable via env var — owner bisa tweak tanpa deploy

## Non-Goals

- Vision OCR hybrid (user sudah test, miss handwriting)
- Batch multi-nota per Gemini call (kasir workflow real-time review)
- Drop `alternatives` field (UX loss > token saving)
- Client-side template crop (Phase 2, out of scope untuk plan ini)
- Model switch (Flash sudah proven, ganti model = risk lain)

## Architecture

Dua perubahan independen yang bisa di-ship terpisah:

1. **A1 — Image compression**: turunkan `IMAGE_MAX_WIDTH` (via env var) → hit lower Gemini image tile count
2. **A2 — `responseSchema` migration**: pindahin menu enum dari prompt text ke Gemini native structured output

Keduanya tidak sentuh consumer code (`/api/scan/route.ts`, Zod validation, `EMPTY_RESULT` shape). Rollback per-change via `git revert`.

## Design

### A1: Image compression

**Current**: `lib/compress.ts` pakai `browser-image-compression`, config 1600px + JPEG q0.8. Hardcoded.

**Gemini tokenization (Flash)** — image di-scale ke tile 768×768, tiap tile = 258 tok:

| Longest dim | Est tile count | Est image tok |
|---|---|---|
| 1600px | 2×2 | ~1032 |
| 1024px | 2×2 (aspek "kurus") | masih ~1032 |
| 800px | 2×1 | ~516 (-50%) |
| 512px | 1×1 | ~258 (-75%) |

Log actual observation: image ~1100 tok pada 1600px setting → konfirmasi ~2×2 tile.

**Target awal**: 800px = -30% total token dari 1900. Bisa turunkan ke 512px kalau accuracy hold.

**Env var**: `IMAGE_MAX_WIDTH` di `.env` — default 1600 untuk backward compat, override ke 800 initially. Client-side (`lib/compress.ts`) reads via `process.env.NEXT_PUBLIC_IMAGE_MAX_WIDTH` karena compress terjadi di browser sebelum upload.

**Risk mitigation**:
- Pak Pon nota qty ditulis dengan pensil tipis kadang — sub-1024px berpotensi blur
- Test: script offline A/B `scripts/token-diff.ts` — download 10-20 nota dari `notas` bucket, run scan tiap resolution, compare `items_count`, `handwritten_total`, `ocr_conf_min`
- Rollback: change env var → redeploy (0 code change)

### A2: `responseSchema` migration

**Current flow**:
```
prompt: "OCR nota... [rules]... Daftar menu master: - Pecel Lele - Ayam bakar ..."
                                                      ~180 tok menu list
Gemini: generate JSON free-form
Zod:    validate menu_name ∈ enum(names)
```

**Proposed flow**:
```
prompt: "OCR nota... [rules]"  (menu list dihapus)
Gemini API config: responseSchema = { properties: { i: { items: { m: { enum: [names] } } } } }
Gemini: generate JSON constrained by schema (native)
Zod:    validate (defense in depth, tetap ada)
```

**Estimated saving**: prompt -180 tok.

**BLOCKING VERIFICATION** — sebelum implement, cek `@google/genai` v6:
1. Apakah `responseSchema` accept JSON schema dengan `enum`?
2. Apakah enum values di-count sebagai input tokens?

Verifikasi via smoke test di dev:
- Baseline scan → log `input_tokens`
- Add `responseSchema` dengan enum 31 menu → log `input_tokens`
- Diff = savings actual

Kalau ternyata enum di-count juga → saving 0 → **skip A2**, keep A1 aja. Bukan disaster, cuma miss opportunity.

**Fallback design** kalau A2 tidak feasible: keep menu di prompt text, tapi shorthand indexed — kirim mapping `0: Pecel Lele\n1: Ayam bakar\n...`, model output `m: 0`. Not recommended (brittle to menu reorder), catat saja sebagai fallback.

### Consumer code impact

None. `scanNota()` output shape tidak berubah (Zod transform tetap re-expand ke `menu_name`/`qty`/etc). Route handler `/api/scan/route.ts` untouched.

## Testing

### Unit tests (`lib/prompts.test.ts`)

- Existing 23 tests tetap valid — mereka test schema parse behavior, bukan text prompt content
- **Update**: existing test `mentions menu master text` kalau ada — hapus atau flip assertion ke "does NOT contain menu list"
- **New**: `buildScanSchemaJSON(menus)` function returns valid Gemini responseSchema shape
- **New**: assert prompt bebas dari menu names (regex check)

### Integration test

- Script `scripts/token-diff.ts`:
  1. Baca sample images dari `notas/` bucket (download 5-10 via Supabase Storage API)
  2. Run scan di variasi resolution (1600/1024/800/512) × variasi schema mode (text vs responseSchema)
  3. Log `input_tokens`, `output_tokens`, `items_count`, `handwritten_total` per combo
  4. Print comparison table

Tidak commit script ini ke default test suite — offline tool untuk manual A/B, bisa di-drop kalau uda ga dipakai.

### Production monitoring

Post-deploy, cek 20-30 scan pertama di Vercel log:
- `ocr_attempts[0].input_tokens` — target ~1000-1200 (baseline 1691)
- `ocr_conf_min` distribution — target stable, tidak melorot
- `items_resolved` avg — target stable
- `mismatch: true` rate — target stable (5-10% acceptable)

## Rollout

**Sequenced ship** — bisa halt setelah step manapun kalau ada masalah:

1. **A2 ship first** (lower risk — pure API refactor):
   - Verify `responseSchema` behavior via dev smoke test
   - Implement + unit tests
   - Deploy, observe 24 jam
   - Kalau `input_tokens` ga turun → revert commit A2

2. **A1 ship second** (with feature flag):
   - Add `NEXT_PUBLIC_IMAGE_MAX_WIDTH` env var
   - Deploy dengan default masih 1600 (no behavior change)
   - Owner flip env → 1024 → observe → 800 → observe
   - Kalau accuracy drop → flip balik ke 1600 (or intermediate)

**Rollback**: `git revert <commit>` + redeploy. Env var: flip value. Zero data migration.

## File impact

**Modified**:
- `lib/compress.ts` — read env var `NEXT_PUBLIC_IMAGE_MAX_WIDTH`, default 1600
- `lib/prompts.ts` — hapus menu list dari `OCR_SYSTEM_PROMPT`, tambah `buildScanSchemaJSON()` builder untuk Gemini
- `lib/gemini.ts` — pakai `responseSchema` config di `generateContent()`
- `lib/prompts.test.ts` — update assertions, add new tests
- `.env.example` — document `NEXT_PUBLIC_IMAGE_MAX_WIDTH`

**Created**:
- `scripts/token-diff.ts` — offline A/B tool (optional)

**No DB changes**. No API contract changes.

## Success criteria

- ✅ Input tokens avg drop from 1691 → **1000-1200** across sampled scans
- ✅ Monthly bill drop from ~600k IDR → **~350-400k IDR**
- ✅ `items_count` regression <5% pada A/B sample
- ✅ `handwritten_total` correctness (=0 saat kasir ga nulis) hold
- ✅ Low-conf rate not spike (>20% jump = red flag)

## Open questions / verification needed

1. **`responseSchema` billing** — enum values counted as input? (verify via dev smoke test before implement)
2. **Mobile browser canvas resize @ 800px** — `browser-image-compression` support di HP kasir (Android)? (test on target device)
3. **Optimal resolution** — 800 atau 512? Depends on A/B result. Default plan ke 800.

## Out of scope (future plans)

- **Phase 2: Template-aware client crop** — kalau A ternyata insufficient (-30% ga cukup), plan lanjutan crop image ke region "items grid" saja. Est additional -20% total.
- **Phase 3: Gemini context caching** — kalau volume 500+ scan/hari, warm cache jadi viable. Sekarang belum urgent.
