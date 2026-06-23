# Logging — Wide-Event Pattern

Inspired by [loggingsucks.com](https://loggingsucks.com/). Inti: **satu JSON event per
request, di-emit sekali di `finally{}`, berisi semua konteks yang dibutuhkan untuk
debug**. Bukan banyak `console.log` yang scattered.

## Kenapa pattern ini

Anti-pattern lama: scattered `console.log("[scan] uploading...")` di seluruh handler.
Saat debug, perlu grep manual + correlate antar baris berdasarkan timestamp. Repot.

Wide-event pattern:
- 1 baris JSON per request — gampang di-grep, gampang di-filter, gampang di-import ke
  spreadsheet / log aggregator
- Semua konteks ada di satu tempat — `request_id`, `user_id`, `duration_ms`, plus
  field domain-specific (`tx_id`, `ocr_attempts`, `mismatch`, dll)
- Function library (`lib/gemini.ts`) **tidak log sendiri** — return data, caller yang
  decide apa yang masuk event

## API

`lib/logger.ts` exports:

- `newEvent(route, extra?)` → `RequestEvent`. Buat di awal handler.
- `evt.set(key, value)` — set 1 field
- `evt.merge(obj)` — set banyak field sekaligus
- `evt.warn(message)` — append warning (tidak error-level, tapi worth noting)
- `evt.error(err)` — attach error sebagai structured object (name, message, stack)
- `evt.emit()` — print JSON ke stdout. Panggil di `finally{}`.
- `tagStatus(evt, status)` — set HTTP status. Helper biar konsisten.

`request_id` (UUID), `ts` (ISO timestamp), dan `duration_ms` auto-attached oleh logger.

## Pattern untuk route handler

```ts
import { newEvent, tagStatus } from '@/lib/logger';

export async function POST(request: NextRequest) {
  const evt = newEvent('POST /api/foo');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    // ... do work, set fields along the way ...
    evt.merge({ thing_id: '...', items_count: 5 });

    tagStatus(evt, 200);
    return NextResponse.json({ ok: true });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
```

**Wajib:**
- `try / catch / finally` — emit di finally, jadi event tetap log walaupun handler throw
- `tagStatus(evt, N)` sebelum setiap `return NextResponse.json(...)` — biar tau hasil
  HTTP-nya tanpa tebak-tebakan
- `evt.error(err)` di catch — supaya structured error info masuk

## Pattern untuk library function (bukan handler)

Library function (cth `scanNota` di `lib/gemini.ts`) **tidak boleh log sendiri**.
Return data yang caller butuh untuk decide apa yang masuk event.

Contoh `scanNota`:

```ts
export async function scanNota(...): Promise<{ result: ScanResult; meta: ScanMeta }> {
  // ... try primary model, try fallback ...
  return {
    result,
    meta: { attempts, final_model, fell_back },
  };
}
```

Caller (route handler) menarik meta ke event:

```ts
const { result: ocr, meta: ocrMeta } = await scanNota(...);
evt.merge({
  ocr_attempts: ocrMeta.attempts,
  ocr_final_model: ocrMeta.final_model,
  ocr_fell_back: ocrMeta.fell_back,
});
```

**Kenapa**: function library bisa dipanggil dari context manapun (handler, cron, test).
Kalau dia log sendiri, output-nya pollute test runner, atau worse — log dengan
context yang salah. Return data → biar caller yang punya context yang decide.

## Field naming conventions

- `snake_case` untuk semua field
- `*_id` untuk identifiers (`user_id`, `tx_id`, `menu_id`)
- `*_count` untuk jumlah (`items_count`, `menus_count`)
- `*_bytes` untuk ukuran (`image_bytes`, `compressed_bytes`)
- `*_ms` untuk durasi (`duration_ms`)
- `outcome` / `reject_reason` — kategori hasil
- `error` — structured object (auto-format by `evt.error(...)`)
- Domain-specific fields bebas (`ocr_attempts`, `mismatch`, `computed_sum`, dll)

## High cardinality is OK

Jangan takut masukin user_id, tx_id, menu nama, model ID, error code. Modern log
aggregator (Vercel, Better Stack, Axiom) handle high-cardinality fine.

## Apa yang TIDAK di-log

- Image bytes (base64 raw) — terlalu besar
- API keys, password, JWT — sensitive
- Foto nota itu sendiri — udah di Supabase Storage, log path-nya cukup
  (`storage_path: "2026-06/abc.jpg"`)

## Anti-patterns yang dihindari

1. **`console.log("foo")` di sembarang tempat** — gunakan `evt.set('foo', value)`
2. **Library function log sendiri** — return data ke caller
3. **String interpolation di log** (`` `user ${id} did X` ``) — pisahkan jadi field:
   `evt.merge({ user_id: id, action: 'did X' })`. Lebih mudah di-grep.
4. **Catch error tanpa emit** — selalu pakai `try/finally` agar event tetap dimit
5. **Log message yang menjelaskan "what the code is doing"** — sebaliknya, log "what
   happened to this request" (loggingsucks.com prinsip utama)

## Membaca log

Di dev:

```bash
npm run dev | jq -r 'select(.route)'    # filter baris JSON event
npm run dev | jq -r 'select(.status >= 400)'   # cuma yang error
```

Di Vercel: log otomatis ter-parse sebagai JSON di dashboard Functions → Logs.

## File map

- `lib/logger.ts` — `RequestEvent`, `newEvent`, `tagStatus`
- Route handlers (`app/api/**/route.ts`) — semua wrapped pakai pattern di atas
- `components/photo-uploader.tsx` — frontend version (build event object, log di akhir)

## Future work

- Kalau volume request tumbuh, tambah tail sampling (skip 1-5% success cepat, keep semua
  error & slow request)
- Kalau perlu trace antar request (cth: scan → review → confirm sebagai 1 flow),
  tambah `trace_id` yang dibawa di header `X-Trace-Id`

## Print events

Endpoint `POST /api/print/log` (client-triggered) menerima payload print event dan emit wide-event. Selain itu juga di-persist ke tabel `print_events` untuk diagnostic page.

### Event fields (selain field standar request)

- `tx_id` (uuid \| null) — transaksi terkait; null untuk test print.
- `daily_seq` (int \| null) — nomor antrian saat dicetak; null kalau test print.
- `target` (`dapur` \| `minuman`) — printer mana
- `trigger` (`auto` \| `reprint` \| `test`) — sumber print
- `outcome` (`dispatched` \| `reported_success` \| `reported_failed`) — status
  - `dispatched`: intent URL sukses di-fire (gak ada error JS, bukan bukti printer cetak)
  - `reported_success`: user manual lapor "Berhasil" di modal
  - `reported_failed`: user manual lapor "Gagal"
- `failure_note` (string?) — catatan user kalau gagal
- `url_scheme_variant` (string?) — variant URL scheme (mis. `rawbt-intent-v1`), berguna kalau ada migrasi format intent
- `user_agent` (string?) — UA browser HP kasir untuk diagnose compat issues

### Diagnose flow

Dev cek Vercel logs untuk pattern:
- Tidak ada `print.dispatched` → JS error di client; minta owner buka Chrome DevTools console screenshot
- `print.dispatched` tapi `reported_failed` → bridge/printer issue; cek `failure_note`, minta IP profile RawBT screenshot
- `print.dispatched` dan `reported_success` → working ✅
