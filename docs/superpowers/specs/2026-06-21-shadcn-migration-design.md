# shadcn Migration — Design Spec

**Date:** 2026-06-21
**Status:** Approved (brainstorming phase complete, pending implementation plan)
**Supersedes:** Section 16 "Open implementation details" → bullet *UI primitives: tulis sendiri vs Shadcn vs Radix. Default: minimal manual primitives* di `2026-06-20-pak-pon-design.md`. Sekarang: **shadcn first**.

## 1. Latar belakang

UI sekarang pakai 4 primitive hand-rolled di `components/ui/` (`button.tsx`, `card.tsx`, `input.tsx`, `label.tsx`) plus beberapa pattern non-primitive (modal, segmented toggle, select native) yang dibuat manual di `components/*.tsx`. Aesthetic paper-stamp (gold/brick/paper/clay tokens di `app/globals.css` `@theme` block) sudah konsisten dan kuat.

Migrating ke shadcn bawa benefit yang nyata untuk pattern yang complex:
- **A11y otomatis** lewat Radix primitives (focus trap, esc-to-close, ARIA, keyboard nav, portal render).
- **Konsistensi ekosistem** — naming dan API standar, gampang adopt component baru dari shadcn registry, copy-paste examples langsung jalan.
- **Less custom code** — modal, alert dialog, radiogroup, select tidak perlu ditulis sendiri.

Migration ini **full primitive replacement + add accessible patterns**, dengan paper-stamp identity di-preserve via CSS variable bridging.

## 2. Tujuan

- Replace 4 primitive di `components/ui/` ke shadcn versi (Button, Card, Input, Label) dengan extensions yang preserve paper-stamp identity.
- Add 5 component baru via shadcn registry: Dialog, AlertDialog, RadioGroup, Select, Sonner.
- Refactor 4 consumer component ke pakai shadcn primitive.
- Mempertahankan paper-stamp aesthetic 100% — tidak ada visual regression.
- Set guideline: **kedepannya prioritas pakai komponen shadcn dulu** sebelum custom.

## 3. Non-goals

- Re-design visual (tetap paper-stamp).
- Bulk migrasi emoji ke lucide icon. Lucide dipakai selective: di shadcn internals (close button, chevron, dll) dan tempat baru. Existing emoji di Home tetap.
- Pakai shadcn `Form` (react-hook-form) — native FormData + Zod sudah cukup.
- Add komponen yang tidak dipakai (Sheet, Tabs, Accordion, Command, Popover, Tooltip).
- Backfill test suite untuk visual components (existing test focus di logic, biarkan).

## 4. Future-component policy (penting)

**Kedepannya, prioritas pakai komponen dari shadcn dulu sebelum nulis custom.**

Checklist saat butuh UI primitive/pattern baru:

1. Cek dulu di [ui.shadcn.com/docs/components](https://ui.shadcn.com/docs/components) — ada komponennya?
   - **Ya** → `npx shadcn add <name>`, customize seperlunya dengan token paper-stamp.
   - **Tidak** → cek alternative di komunitas registry (e.g., shadcn registry compatible registries).
2. Kalau betul-betul tidak ada dan harus custom: tulis di `components/ui/<name>.tsx` mengikuti pattern shadcn (`cva` untuk variant, `cn()` untuk class merge, `data-slot` attribute, Radix kalau ada interaksi).
3. **Hindari** menulis modal/dropdown/popover manual lagi — selalu lewat shadcn/Radix.

## 5. Setup

### Dependencies (ditambah)

| Package | Untuk apa |
|---|---|
| `class-variance-authority` | cva untuk variant logic di primitives |
| `clsx` | Conditional class joiner |
| `tailwind-merge` | Resolve Tailwind class conflicts di `cn()` |
| `lucide-react` | Icon set (clean line icons) |
| `@radix-ui/react-dialog` | Dialog + AlertDialog headless |
| `@radix-ui/react-radio-group` | RadioGroup headless |
| `@radix-ui/react-select` | Select headless |
| `@radix-ui/react-label` | Label headless |
| `sonner` | Toast notifications |
| `tw-animate-css` (kalau shadcn init mintanya) | Animation utility classes untuk Tailwind v4 |

Bundle size impact: ~80–120 kB gzip total. Internal app pakai di tablet sendiri, bukan blocker.

### Init

```bash
npx shadcn@latest init
```

Pilihan saat prompt:
- Framework: Next.js
- Style: New York (lebih kompak, cocok dengan paper-stamp density)
- Base color: zinc (akan di-override semua via token bridging)
- CSS variables: yes
- Tailwind v4: yes
- React Server Components: yes
- Import alias: `@/components`, `@/lib`, `@/components/ui`

`npx shadcn@latest init` akan auto-buat `lib/utils.ts` (dengan `cn()` helper) dan `components.json` (config file shadcn).

### Theme bridging

Paper-stamp tokens tetap di `@theme` block (sumber kebenaran warna). Tambah **alias shadcn semantic tokens** yang point ke paper-stamp:

```css
@theme {
  /* === Paper-stamp tokens (existing, tidak diubah) === */
  --color-gold: #f5a623;
  --color-brick: #d02d1f;
  /* ... dst */

  /* === shadcn semantic aliases (NEW) === */
  --color-background:           var(--color-paper);
  --color-foreground:           var(--color-coal);
  --color-card:                 var(--color-paper-soft);
  --color-card-foreground:      var(--color-coal);
  --color-popover:              var(--color-paper);
  --color-popover-foreground:   var(--color-coal);
  --color-primary:              var(--color-gold);
  --color-primary-foreground:   var(--color-night-deep);
  --color-secondary:            var(--color-paper-soft);
  --color-secondary-foreground: var(--color-coal);
  --color-muted:                var(--color-clay-mist);
  --color-muted-foreground:     var(--color-clay);
  --color-accent:               var(--color-cream);
  --color-accent-foreground:    var(--color-coal);
  --color-destructive:          var(--color-brick);
  --color-destructive-foreground: var(--color-paper);
  --color-border:               var(--color-clay-soft);
  --color-input:                var(--color-clay-soft);
  --color-ring:                 var(--color-brick);
}
```

Dengan ini, default shadcn className (`bg-primary`, `text-destructive`, `border-input`, dll) langsung jadi paper-stamp tanpa override per-component.

## 6. Primitive replacements

### `components/ui/button.tsx`

- Generate via `npx shadcn add button`.
- Extend `cva` variants: tambah `night` (navy chrome, sekarang dipakai di nav/footer).
- Variant naming **adopt shadcn convention**:
  - existing `primary` → `default` (gold style, via `--color-primary`)
  - existing `danger` → `destructive` (brick style, via `--color-destructive`)
  - existing `secondary` → `secondary` (paper-soft, no change)
  - existing `ghost` → `ghost` (cream hover, no change)
  - existing `night` → `night` (custom extension, tetap)

Final variants: `default | secondary | destructive | outline | ghost | link | night`.

Size: `default | sm | lg | icon` (shadcn standar).

### `components/ui/card.tsx`

- Generate via `npx shadcn add card`. Default shadcn Card: flat surface + border, dengan sub-components `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`, `CardAction`.
- Extend `Card` root dengan `cva` variants:
  - `paper` (default) — putih paper-soft + `shadow-[var(--shadow-stamp)]`
  - `receipt` — dashed border (clay-soft), no shadow
  - `inset` — cream nested, no shadow
- Sub-components (Header/Title/etc.) pakai shadcn default tanpa modif — sudah cocok dengan paper-stamp lewat token aliases.

### `components/ui/input.tsx`

- Generate via `npx shadcn add input`. Drop-in replacement. Focus ring otomatis pakai `--color-ring` = brick.
- Tidak perlu extension.

### `components/ui/label.tsx`

- Generate via `npx shadcn add label`.
- Extend dengan `cva` variants:
  - `default` — shadcn standar (text-sm, font-medium)
  - `eyebrow` — `text-[11px] font-semibold uppercase tracking-[0.22em] text-clay` (existing style)
- Default variant: `eyebrow` (preserve existing visual identity).

## 7. New components (added via shadcn)

| Komponen | Command | Pengganti dari | Refactor target |
|---|---|---|---|
| Dialog | `npx shadcn add dialog` | Manual modal di `nota-item-modal.tsx` | `components/nota-item-modal.tsx` |
| AlertDialog | `npx shadcn add alert-dialog` | Inline delete confirmation | `components/transaction-detail.tsx` |
| RadioGroup | `npx shadcn add radio-group` | Custom segmented toggle | `components/menu-form.tsx` |
| Select | `npx shadcn add select` | Native `<select>` quick range | `components/date-filter.tsx` |
| Sonner | `npx shadcn add sonner` | (belum ada toast) | mount `<Toaster />` di `app/(app)/layout.tsx` |

### Dialog refactor (`nota-item-modal.tsx`)

```
<Dialog open={isOpen} onOpenChange={setOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Edit item</DialogTitle>
    </DialogHeader>
    {/* existing form body */}
    <DialogFooter>
      <Button variant="ghost" onClick={onCancel}>Batal</Button>
      <Button onClick={onSave}>Simpan</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

Manual `inset-0 z-50` overlay + `aria-modal` dihapus. Radix handle focus trap, esc, portal, body scroll lock otomatis.

### AlertDialog refactor (`transaction-detail.tsx`)

Untuk delete confirmation:

```
<AlertDialog>
  <AlertDialogTrigger asChild>
    <Button variant="destructive">Hapus</Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Hapus transaksi?</AlertDialogTitle>
      <AlertDialogDescription>
        Transaksi & foto nota akan dihapus permanen setelah 7 hari.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Batal</AlertDialogCancel>
      <AlertDialogAction onClick={handleDelete}>Hapus</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

### RadioGroup refactor (`menu-form.tsx`)

Untuk kategori (Makanan / Nasi / Minuman):

```
<RadioGroup value={category} onValueChange={setCategory} className="flex gap-2">
  {(['makanan', 'nasi', 'minuman'] as const).map(c => (
    <Label key={c} htmlFor={c} className="cursor-pointer">
      <RadioGroupItem id={c} value={c} className="sr-only peer" />
      <span className="rounded-md border px-3 py-2 peer-data-[state=checked]:bg-gold peer-data-[state=checked]:text-night-deep">
        {labelFor(c)}
      </span>
    </Label>
  ))}
</RadioGroup>
```

(Final markup di-finalize saat implement; pattern: pakai `peer` + `data-state=checked` untuk styling segmented toggle.)

### Select refactor (`date-filter.tsx`)

Quick range select (`Hari ini` / `7 hari` / `30 hari` / `Custom`):

```
<Select value={range} onValueChange={setRange}>
  <SelectTrigger><SelectValue /></SelectTrigger>
  <SelectContent>
    <SelectItem value="today">Hari ini</SelectItem>
    <SelectItem value="7d">7 hari terakhir</SelectItem>
    <SelectItem value="30d">30 hari terakhir</SelectItem>
    <SelectItem value="custom">Custom</SelectItem>
  </SelectContent>
</Select>
```

Native `<input type="date">` untuk picker custom tanggal tetap dipertahankan — shadcn `Calendar` + `Popover` adalah out-of-scope (kompleks, native sudah cukup).

### Sonner setup

Mount `<Toaster richColors position="top-center" />` di `app/(app)/layout.tsx`. Belum di-pakai sekarang — siapkan infrastruktur supaya kalau besok mau toast "✓ Tersimpan" setelah konfirmasi nota, tinggal `toast.success(...)`.

## 8. Call-site migration

Setelah primitive di-replace, ada call-site rename:

| Find | Replace |
|---|---|
| `variant="primary"` | (hapus prop, default) |
| `variant="danger"` | `variant="destructive"` |

`variant="secondary"`, `variant="ghost"`, `variant="night"` tidak berubah.

`size="md"` → hapus (`default` di shadcn). `size="sm"`, `size="lg"` tetap.

Grep + replace dilakukan di phase 3.

## 9. Migration sequencing

| Phase | Commits | Isi |
|---|---|---|
| 1 — Setup | 1 | `npx shadcn init`, install deps, add `cn()`, theme bridging di `globals.css` |
| 2 — Primitives | 4 | 1 commit per primitive (button → card → input → label) |
| 3 — Call-site migration | 1 | Grep+replace variant names + size, verify build hijau |
| 4 — New components & refactor | 5 | Dialog, AlertDialog, RadioGroup, Select, Sonner (1 commit per pasangan add+refactor) |
| 5 — Validation | 0 | Smoke test browser (all routes), lint, test, build |

Total: ~11 commits. Tiap phase committable independen — bisa rollback per phase.

## 10. Risk

| Risk | Mitigation |
|---|---|
| Visual regression di paper-stamp | Token bridging di Section 5. Smoke test per phase. |
| Call-site churn | Phase 3 — sekali grep+replace selesai. Internal app, low risk. |
| Bundle size +80–120 kB | Internal tablet pakai, bukan blocker. |
| Tailwind v4 × shadcn incompatibility | shadcn officially support v4. Verify di Phase 1 sebelum commit. Kalau ada issue, escalate. |
| Middle-of-phase break | Tiap phase ada validation. Rollback per-commit. |

## 11. Testing

- Tidak ada visual regression test infrastructure. Smoke test manual per phase.
- `lib/*.test.ts` (logic tests) tidak terpengaruh — tetap hijau.
- `app/api/menus/_schemas.test.ts` tetap hijau.
- Future: kalau besok mau add component test, pattern Testing Library + jsdom sudah ada (`@testing-library/react` di `package.json`).

## 12. Out of scope (defer)

- shadcn Form (react-hook-form).
- shadcn Calendar + Popover untuk date picker.
- shadcn Sheet, Tabs, Accordion, Command, Tooltip, Popover (kecuali yang dibutuhkan internal Select/Dialog).
- Bulk migrasi emoji ke lucide.
- Visual regression test infrastructure.
- Re-style untuk dark mode (project belum support dark mode).

## 13. Update spec utama

Setelah merge, edit `docs/superpowers/specs/2026-06-20-pak-pon-design.md`:

- Section 16 "Open implementation details" → bullet *UI primitives* tandai superseded, link ke spec ini.
- Section 14 "Conventions" → tambah bullet: *UI components: prioritaskan shadcn dulu; lihat `2026-06-21-shadcn-migration-design.md` Section 4 untuk policy*.
