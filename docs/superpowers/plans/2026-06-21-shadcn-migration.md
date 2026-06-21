# shadcn Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate semua UI primitive ke shadcn, add accessible patterns (Dialog, AlertDialog, RadioGroup, Select, Sonner), preserve paper-stamp aesthetic via CSS variable bridging.

**Architecture:** shadcn primitives di `components/ui/` jadi sumber utama. Paper-stamp tokens existing tetap di `@theme` block; tambah alias shadcn semantic tokens (`--color-primary` = `--color-gold`, dll) supaya shadcn defaults otomatis paper-stamp. Variant naming adopt shadcn convention (`default`/`destructive`/`secondary`/`ghost`), `night` di-extend sebagai custom.

**Tech Stack:** Next.js 16 App Router, React 19.2, TypeScript strict, Tailwind v4, shadcn (latest), Radix UI primitives, lucide-react icons.

**Spec reference:** `docs/superpowers/specs/2026-06-21-shadcn-migration-design.md`

---

## File structure (cumulative changes)

| File | Action | Tasks |
|---|---|---|
| `components.json` | Create (via shadcn init) | 1 |
| `lib/utils.ts` | Create (via shadcn init) | 1 |
| `app/globals.css` | Modify (add shadcn token aliases) | 1 |
| `package.json` | Modify (deps added by shadcn add) | 1, 2, 7, 8, 9, 10, 11 |
| `components/ui/button.tsx` | Rewrite (shadcn + night ext) | 2 |
| `components/ui/card.tsx` | Rewrite (shadcn + paper/receipt/inset) | 3 |
| `components/ui/input.tsx` | Rewrite (shadcn drop-in) | 4 |
| `components/ui/label.tsx` | Rewrite (shadcn + eyebrow ext) | 5 |
| `components/ui/dialog.tsx` | Create (via shadcn add) | 7 |
| `components/ui/alert-dialog.tsx` | Create | 8 |
| `components/ui/radio-group.tsx` | Create | 9 |
| `components/ui/select.tsx` | Create | 10 |
| `components/ui/sonner.tsx` | Create | 11 |
| `components/nota-item-modal.tsx` | Refactor (use Dialog) | 7 |
| `components/transaction-detail.tsx` | Refactor (use AlertDialog) + call-site rename | 6, 8 |
| `components/menu-form.tsx` | Refactor (use RadioGroup) | 9 |
| `components/date-filter.tsx` | Refactor (use Select) | 10 |
| `app/(app)/layout.tsx` | Modify (mount `<Toaster />`) | 11 |
| `app/(app)/menu/menu-list-client.tsx` | Modify (call-site rename) | 6 |
| `docs/superpowers/specs/2026-06-20-pak-pon-design.md` | Modify (note migration) | 12 |

---

## Task 1: shadcn init + theme bridging

**Files:**
- Create: `components.json`, `lib/utils.ts`
- Modify: `app/globals.css`, `package.json` (deps)

- [ ] **Step 1: Run shadcn init**

```bash
npx shadcn@latest init
```

Saat prompted, jawab:
- Which style? → **New York**
- Which base color? → **Zinc** (akan kita override semua)
- Use CSS variables? → **Yes**

Init akan:
- Create `components.json` di project root
- Create `lib/utils.ts` dengan `cn()` helper (clsx + tailwind-merge)
- Modify `app/globals.css` — add base layer + `@theme inline` block + raw color CSS vars di `:root`
- Add deps: `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `tw-animate-css` (kalau v4 mode)

Kalau ada error compatibility dengan Tailwind v4, run dengan `--legacy-peer-deps`:
```bash
npx shadcn@latest init --legacy-peer-deps
```

- [ ] **Step 2: Verify generated files**

```bash
cat components.json
cat lib/utils.ts
```

Expected `lib/utils.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Expected `components.json` punya `tailwind.css = "app/globals.css"`, `aliases.ui = "@/components/ui"`, `aliases.utils = "@/lib/utils"`, dst.

- [ ] **Step 3: Override shadcn token defaults to paper-stamp aliases**

`app/globals.css` sekarang punya tambahan dari shadcn (raw CSS vars di `:root` + `@theme inline` mapping). Goal: replace shadcn default values dengan paper-stamp tokens existing.

Open `app/globals.css`. Setelah block `@theme { ... }` existing (yang berisi paper-stamp tokens), shadcn akan tambah sesuatu seperti `:root { --background: oklch(...); ... }`. **Hapus** seluruh isi `:root { ... }` yang ditambah shadcn, ganti dengan alias yang point ke paper-stamp tokens. Jadi block-nya jadi:

```css
:root {
  /* shadcn semantic tokens → alias ke paper-stamp */
  --background:           var(--color-paper);
  --foreground:           var(--color-coal);
  --card:                 var(--color-paper-soft);
  --card-foreground:      var(--color-coal);
  --popover:              var(--color-paper);
  --popover-foreground:   var(--color-coal);
  --primary:              var(--color-gold);
  --primary-foreground:   var(--color-night-deep);
  --secondary:            var(--color-paper-soft);
  --secondary-foreground: var(--color-coal);
  --muted:                var(--color-clay-mist);
  --muted-foreground:     var(--color-clay);
  --accent:               var(--color-cream);
  --accent-foreground:    var(--color-coal);
  --destructive:          var(--color-brick);
  --destructive-foreground: var(--color-paper);
  --border:               var(--color-clay-soft);
  --input:                var(--color-clay-soft);
  --ring:                 var(--color-brick);
  --radius: 0.5rem;
}
```

Note: shadcn `@theme inline { --color-primary: var(--primary); ... }` block tetap dipertahankan apa adanya — itu yang map dari raw `:root` var ke Tailwind theme. Kita cuma replace nilai raw.

Hapus juga `.dark { ... }` block kalau ada — project belum support dark mode (out-of-scope per spec).

- [ ] **Step 4: Verify build hijau**

```bash
npm run lint && npm run test && npm run build
```

Expected: PASS. Existing pages tetap render seperti semula (belum ada call-site shadcn).

- [ ] **Step 5: Commit**

```bash
git add components.json lib/utils.ts app/globals.css package.json package-lock.json
git commit -m "feat(ui): init shadcn + bridge paper-stamp tokens"
```

---

## Task 2: Replace Button primitive

**Files:**
- Modify: `components/ui/button.tsx`

- [ ] **Step 1: Backup existing button.tsx**

```bash
cp components/ui/button.tsx /tmp/button.tsx.bak
```

(Untuk reference variant logic existing — `night` styling.)

- [ ] **Step 2: Generate shadcn Button**

```bash
npx shadcn@latest add button
```

Saat prompt overwrite existing → **Yes**.

Expected: `components/ui/button.tsx` di-rewrite dengan shadcn pattern (cva + asChild support + slot).

- [ ] **Step 3: Extend cva dengan `night` variant + `danger` transitional alias**

Open `components/ui/button.tsx`. Cari block `buttonVariants = cva(...)`. Dalam `variants: { variant: { ... } }`, **tambah** dua entry:

```ts
night: 'bg-night text-ink hover:bg-night-soft active:bg-night-deep',
danger: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm',
```

`danger` di sini adalah **transitional alias** yang map ke styling destructive — supaya state codebase tetap buildable di antara Task 2 dan Task 6. `danger` akan dihapus di Task 6 setelah call site di-rename.

`cva` otomatis infer TypeScript type dari object keys — `Variant` jadi `default | secondary | destructive | outline | ghost | link | night | danger`.

- [ ] **Step 4: Verify build hijau**

```bash
npm run lint && npm run test && npm run build
```

Expected: PASS. Semua existing call site (`variant="danger"`, `variant="secondary"`, dll) compile bersih lewat alias `danger` + variant lain yang nama-nya tidak berubah.

- [ ] **Step 5: Commit**

```bash
git add components/ui/button.tsx
git commit -m "feat(ui): replace Button with shadcn + night variant ext"
```

---

## Task 3: Replace Card primitive

**Files:**
- Modify: `components/ui/card.tsx`

- [ ] **Step 1: Backup existing**

```bash
cp components/ui/card.tsx /tmp/card.tsx.bak
```

- [ ] **Step 2: Generate shadcn Card**

```bash
npx shadcn@latest add card
```

Saat prompt overwrite → **Yes**.

- [ ] **Step 3: Extend Card root dengan paper/receipt/inset variants**

Open `components/ui/card.tsx`. shadcn-generated Card biasanya berbentuk:

```ts
const Card = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)} {...props} />
  )
);
```

Refactor menjadi:

```ts
import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const cardVariants = cva(
  "rounded-lg text-card-foreground",
  {
    variants: {
      variant: {
        paper:   "border border-clay-soft bg-paper-soft shadow-[var(--shadow-stamp)]",
        receipt: "border border-dashed border-clay-soft bg-paper-soft",
        inset:   "border border-clay-soft bg-cream",
      },
    },
    defaultVariants: { variant: "paper" },
  }
);

export type CardProps = React.ComponentProps<"div"> & VariantProps<typeof cardVariants>;

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ variant }), className)} {...props} />
  )
);
Card.displayName = "Card";
```

Keep semua sub-components (`CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`, `CardAction`) **tanpa perubahan** — defaults sudah cocok via token aliases.

- [ ] **Step 4: Verify build**

```bash
npm run lint && npm run test && npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ui/card.tsx
git commit -m "feat(ui): replace Card with shadcn + paper/receipt/inset variants"
```

---

## Task 4: Replace Input primitive

**Files:**
- Modify: `components/ui/input.tsx`

- [ ] **Step 1: Generate shadcn Input**

```bash
npx shadcn@latest add input
```

Saat prompt overwrite → **Yes**.

- [ ] **Step 2: Verify no extension needed**

Inspect `components/ui/input.tsx` — default shadcn Input cukup. Focus ring otomatis pakai `--color-ring` = brick lewat token alias.

- [ ] **Step 3: Verify build hijau**

```bash
npm run lint && npm run test && npm run build
```

Expected: PASS. Semua Input call site (di nota-item-modal, menu-form, date-filter, dll) compatible — props utama (`className`, native input attrs, `id`, `type`, `value`, `onChange`) tidak berubah.

- [ ] **Step 4: Commit**

```bash
git add components/ui/input.tsx
git commit -m "feat(ui): replace Input with shadcn drop-in"
```

---

## Task 5: Replace Label primitive

**Files:**
- Modify: `components/ui/label.tsx`

- [ ] **Step 1: Generate shadcn Label**

```bash
npx shadcn@latest add label
```

Saat prompt overwrite → **Yes**.

- [ ] **Step 2: Extend dengan `eyebrow` variant (default)**

Open `components/ui/label.tsx`. shadcn-generated Label biasanya:

```ts
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/lib/utils";

const Label = React.forwardRef<...>(
  ({ className, ...props }, ref) => (
    <LabelPrimitive.Root ref={ref} className={cn("text-sm font-medium leading-none ...", className)} {...props} />
  )
);
```

Refactor pakai cva:

```ts
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const labelVariants = cva("peer-disabled:cursor-not-allowed peer-disabled:opacity-70", {
  variants: {
    variant: {
      eyebrow: "text-[11px] font-semibold uppercase tracking-[0.22em] text-clay",
      default: "text-sm font-medium leading-none",
    },
  },
  defaultVariants: { variant: "eyebrow" },
});

export type LabelProps = React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> &
  VariantProps<typeof labelVariants>;

const Label = React.forwardRef<React.ElementRef<typeof LabelPrimitive.Root>, LabelProps>(
  ({ className, variant, ...props }, ref) => (
    <LabelPrimitive.Root ref={ref} className={cn(labelVariants({ variant }), className)} {...props} />
  )
);
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };
```

Default `variant="eyebrow"` preserve existing visual (semua existing `<Label>` look identical). Untuk text-sm style baru, pakai `<Label variant="default">`.

- [ ] **Step 3: Verify build hijau**

```bash
npm run lint && npm run test && npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/ui/label.tsx
git commit -m "feat(ui): replace Label with shadcn + eyebrow variant (default)"
```

---

## Task 6: Call-site migration (variant rename)

**Files:**
- Modify: `components/nota-item-modal.tsx`, `components/transaction-detail.tsx`, `app/(app)/menu/menu-list-client.tsx`

- [ ] **Step 1: Replace `variant="danger"` → `variant="destructive"`**

3 call sites teridentifikasi via grep:
- `components/nota-item-modal.tsx:163` → `<Button type="button" variant="danger" onClick={onDelete}>` → `variant="destructive"`
- `components/transaction-detail.tsx:241` → `<Button variant="danger" onClick={handleDelete} disabled={pending}>` → `variant="destructive"`
- `app/(app)/menu/menu-list-client.tsx:175` → `variant="danger"` → `variant="destructive"`

Run replace:

```bash
sed -i 's/variant="danger"/variant="destructive"/g' \
  components/nota-item-modal.tsx \
  components/transaction-detail.tsx \
  'app/(app)/menu/menu-list-client.tsx'
```

(Atau edit manual kalau lebih aman.)

- [ ] **Step 2: Remove `danger` transitional alias dari button.tsx**

Open `components/ui/button.tsx`. Cari entry `danger:` di `buttonVariants` (ditambah saat Task 2 Step 3 sebagai transitional alias). Hapus baris itu.

Final variant list jadi: `default | secondary | destructive | outline | ghost | link | night`.

- [ ] **Step 3: Verify build hijau**

```bash
npm run lint && npm run test && npm run build
```

Expected: PASS, tidak ada error TypeScript dari `variant="danger"` lagi.

- [ ] **Step 4: Commit**

```bash
git add components/nota-item-modal.tsx components/transaction-detail.tsx 'app/(app)/menu/menu-list-client.tsx' components/ui/button.tsx
git commit -m "refactor(ui): rename variant=\"danger\" → \"destructive\" at call sites"
```

---

## Task 7: Add Dialog + refactor nota-item-modal

**Files:**
- Create: `components/ui/dialog.tsx`
- Modify: `components/nota-item-modal.tsx`

- [ ] **Step 1: Generate shadcn Dialog**

```bash
npx shadcn@latest add dialog
```

Expected: `components/ui/dialog.tsx` created. Deps `@radix-ui/react-dialog` added to package.json.

- [ ] **Step 2: Refactor `nota-item-modal.tsx`**

Open `components/nota-item-modal.tsx`. Strukturnya:
1. Outer wrapper: `<div className="fixed inset-0 z-50 flex items-center justify-center bg-night-deep/60" onClick={onClose}>`
2. Inner card: `<div className="w-full max-w-md rounded-lg bg-paper-soft p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>`
3. Content (form body)

Refactor: drop manual overlay, gunakan `Dialog` Radix-based.

Replace import block (top of file) — add Dialog imports:

```ts
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
```

Replace function signature & body root:

```tsx
export function NotaItemModal({
  initial,
  menus,
  onSave,
  onClose,
  onDelete,
}: {
  initial?: NotaItem;
  menus: MenuOption[];
  onSave: (item: NotaItem) => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  // ... (existing state hooks: menuId, qty, notes, search, etc.)

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial?.id ? 'Edit item' : 'Tambah item'}</DialogTitle>
        </DialogHeader>

        {/* === existing form body (menu search, menu list, qty, notes) === */}
        {/* WRAP semua existing children dari `<div className="space-y-4">...</div>` (inner card) ke sini. JANGAN keep manual overlay. */}

        <DialogFooter className="flex gap-2 pt-2">
          {onDelete && initial?.id && (
            <Button type="button" variant="destructive" onClick={onDelete}>
              🗑️ Hapus
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={onClose} className="ml-auto">
            Batal
          </Button>
          <Button type="button" onClick={handleSave} disabled={!selectedMenu || qty < 1}>
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Hapus:
- Outer `<div className="fixed inset-0 z-50 flex items-center justify-center bg-night-deep/60" onClick={onClose}>`
- Inner card wrapper `<div className="w-full max-w-md ...">`
- `onClick={(e) => e.stopPropagation()}` propagation logic
- Manual `aria-modal`, `role="dialog"` — Dialog handle ini

Keep semua form content (menu list, qty input, notes input) — wrap di dalam `<DialogContent>` di antara `<DialogHeader>` dan `<DialogFooter>`.

- [ ] **Step 3: Verify dev render**

```bash
npm run lint && npm run test && npm run build
```

Expected: PASS.

(Manual smoke test optional: `npm run dev`, buka `/scan`, scan dummy → /review → click ✏️ icon → modal harus muncul lewat portal, esc close, focus trap.)

- [ ] **Step 4: Commit**

```bash
git add components/ui/dialog.tsx components/nota-item-modal.tsx package.json package-lock.json
git commit -m "feat(ui): add Dialog + refactor nota-item-modal"
```

---

## Task 8: Add AlertDialog + refactor transaction-detail

**Files:**
- Create: `components/ui/alert-dialog.tsx`
- Modify: `components/transaction-detail.tsx`

- [ ] **Step 1: Generate shadcn AlertDialog**

```bash
npx shadcn@latest add alert-dialog
```

- [ ] **Step 2: Refactor delete confirmation**

Open `components/transaction-detail.tsx`. Cari block conditional `{!confirmDelete ? (...) : (<Card variant="paper" ...>...)}` sekitar line 210-247.

Replace dengan AlertDialog.

Tambah import:

```ts
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
```

Hapus state `const [confirmDelete, setConfirmDelete] = useState(false);` (tidak perlu lagi — AlertDialog handle open state internal).

Replace block conditional dengan single inline:

```tsx
<div className="flex flex-wrap items-center gap-2">
  <Link href={`/transactions/${transaction.id}/review`} className="flex-1 sm:flex-none">
    <Button disabled={pending} className="w-full sm:w-auto">
      ✏️ {isDraft ? 'Lanjutkan edit' : 'Edit transaksi'}
    </Button>
  </Link>

  <AlertDialog>
    <AlertDialogTrigger asChild>
      <Button
        variant="ghost"
        disabled={pending}
        className="ml-auto text-brick-dark hover:bg-brick-faint"
      >
        🗑️ Hapus
      </Button>
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Hapus transaksi ini?</AlertDialogTitle>
        <AlertDialogDescription>
          Transaksi disimpan sebagai soft-delete selama 7 hari. Setelah itu cron menghapus permanen (termasuk foto nota).
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>Batal</AlertDialogCancel>
        <AlertDialogAction
          onClick={handleDelete}
          disabled={pending}
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        >
          {pending ? 'Menghapus…' : 'Ya, hapus'}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</div>
```

- [ ] **Step 3: Verify build**

```bash
npm run lint && npm run test && npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/ui/alert-dialog.tsx components/transaction-detail.tsx package.json package-lock.json
git commit -m "feat(ui): add AlertDialog + refactor delete confirmation"
```

---

## Task 9: Add RadioGroup + refactor menu-form

**Files:**
- Create: `components/ui/radio-group.tsx`
- Modify: `components/menu-form.tsx`

- [ ] **Step 1: Generate shadcn RadioGroup**

```bash
npx shadcn@latest add radio-group
```

- [ ] **Step 2: Refactor category toggle**

Open `components/menu-form.tsx`. Cari block `<div role="radiogroup" aria-label="Kategori menu" className="mt-2 inline-flex rounded-lg bg-cream p-1">` (~line 100-130).

Tambah import:

```ts
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
```

Replace block dengan segmented-style RadioGroup pakai `peer` trick (karena RadioGroupItem default render sebagai bullet radio; kita styling sebagai pill):

```tsx
<div>
  <Label>Kategori</Label>
  <RadioGroup
    value={category}
    onValueChange={(v) => setCategory(v as MenuFormValues['category'])}
    aria-label="Kategori menu"
    className="mt-2 inline-flex rounded-lg bg-cream p-1"
  >
    {categoryOptions.map((opt) => (
      <div key={opt.value} className="flex">
        <RadioGroupItem value={opt.value} id={`cat-${opt.value}`} className="peer sr-only" />
        <Label
          htmlFor={`cat-${opt.value}`}
          variant="default"
          className={[
            'cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-all',
            'duration-[var(--duration-fast)]',
            'peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-brick peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-cream',
            'peer-data-[state=checked]:bg-paper-soft peer-data-[state=checked]:text-coal peer-data-[state=checked]:shadow-[var(--shadow-paper)]',
            'text-coal-soft hover:text-coal',
          ].join(' ')}
        >
          {opt.label}
        </Label>
      </div>
    ))}
  </RadioGroup>
</div>
```

Note: `variant="default"` di Label penting karena default-nya `eyebrow` (uppercase tiny) — di sini kita mau text normal.

- [ ] **Step 3: Verify build**

```bash
npm run lint && npm run test && npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/ui/radio-group.tsx components/menu-form.tsx package.json package-lock.json
git commit -m "feat(ui): add RadioGroup + refactor menu-form category toggle"
```

---

## Task 10: Add Select + refactor date-filter

**Files:**
- Create: `components/ui/select.tsx`
- Modify: `components/date-filter.tsx`

- [ ] **Step 1: Generate shadcn Select**

```bash
npx shadcn@latest add select
```

- [ ] **Step 2: Refactor status select di date-filter.tsx**

Open `components/date-filter.tsx`. Cari block `<select id="status" ...>` (sekitar line 70-84).

Tambah import:

```ts
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
```

Replace block:

```tsx
<div>
  <Label htmlFor="status">Status</Label>
  <Select value={status || 'all'} onValueChange={(v) => update('status', v === 'all' ? '' : v)}>
    <SelectTrigger id="status" className="mt-2">
      <SelectValue placeholder="Semua" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="all">Semua</SelectItem>
      <SelectItem value="confirmed">Confirmed</SelectItem>
      <SelectItem value="pending_review">Pending Review</SelectItem>
    </SelectContent>
  </Select>
</div>
```

(Note: shadcn Select tidak boleh punya `value=""`. Kita pakai `"all"` sebagai sentinel + map back ke `""` di `onValueChange`.)

- [ ] **Step 3: Verify build**

```bash
npm run lint && npm run test && npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/ui/select.tsx components/date-filter.tsx package.json package-lock.json
git commit -m "feat(ui): add Select + refactor date-filter status filter"
```

---

## Task 11: Add Sonner + mount Toaster

**Files:**
- Create: `components/ui/sonner.tsx`
- Modify: `app/(app)/layout.tsx`

- [ ] **Step 1: Generate shadcn Sonner**

```bash
npx shadcn@latest add sonner
```

Expected: `components/ui/sonner.tsx` created (re-exports `Toaster` dari `sonner` package dengan theming).

- [ ] **Step 2: Mount Toaster di app layout**

Open `app/(app)/layout.tsx`. Tambah import:

```ts
import { Toaster } from '@/components/ui/sonner';
```

Tambah `<Toaster richColors position="top-center" />` di sebelum `</body>` atau di akhir return JSX (paling bawah, sibling dari children):

```tsx
return (
  <div className="..."> {/* existing wrapper */}
    {/* existing nav, children, dll */}
    <Toaster richColors position="top-center" />
  </div>
);
```

(Jangan dalam main scroll container — Sonner pakai fixed positioning.)

- [ ] **Step 3: Verify build**

```bash
npm run lint && npm run test && npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/ui/sonner.tsx 'app/(app)/layout.tsx' package.json package-lock.json
git commit -m "feat(ui): add Sonner + mount Toaster in app layout"
```

---

## Task 12: Update main design spec + final smoke

**Files:**
- Modify: `docs/superpowers/specs/2026-06-20-pak-pon-design.md`

- [ ] **Step 1: Update Section 16 bullet (UI primitives)**

Open `docs/superpowers/specs/2026-06-20-pak-pon-design.md`. Cari Section 16 "Open implementation details" bullet:

```
- UI primitives: tulis sendiri (button, input, modal) vs Shadcn vs Radix. Default: minimal manual primitives di `components/ui/` mengikuti Tailwind v4.
```

Replace dengan:

```
- ~~UI primitives: tulis sendiri vs Shadcn vs Radix.~~ **Decided** — sekarang shadcn first; lihat `2026-06-21-shadcn-migration-design.md`.
```

- [ ] **Step 2: Update Section 14 Conventions**

Tambah bullet di akhir Section 14:

```
- **UI components**: prioritaskan komponen shadcn dulu sebelum nulis custom. Lihat `2026-06-21-shadcn-migration-design.md` Section 4 untuk policy lengkap.
```

- [ ] **Step 3: Final full verification**

```bash
npm run lint && npm run test && npm run build
```

Expected: ALL PASS.

Optional manual smoke test:

```bash
npm run dev
```

Browse routes dan verifikasi visual identik dengan sebelum migrasi:
- `/` Home
- `/login` (logged out)
- `/scan`
- `/transactions` (list + DateFilter pakai shadcn Select)
- `/transactions/[id]` (detail + AlertDialog delete)
- `/transactions/[id]/review` (Dialog buat item edit)
- `/menu` (MenuForm + RadioGroup kategori)
- `/reports/daily`, `/reports/monthly`

Cek:
- Paper-stamp aesthetic (gold, brick, cream, paper) preserved
- Dialog/AlertDialog: esc close, click overlay close, focus trap, ARIA
- RadioGroup: arrow keys nav antar kategori
- Select: keyboard nav

- [ ] **Step 4: Stage spec + plan files dan commit**

```bash
git add docs/superpowers/specs/2026-06-20-pak-pon-design.md \
        docs/superpowers/specs/2026-06-21-shadcn-migration-design.md \
        docs/superpowers/plans/2026-06-21-shadcn-migration.md
git commit -m "docs: shadcn-first policy + migration spec/plan

Updates main spec: Section 16 decided, Section 14 convention.
Adds shadcn migration design spec and implementation plan."
```

---

## Self-Review

### Spec coverage

- §1 Latar belakang → context only, no task needed
- §2 Tujuan → Tasks 1-11
- §3 Non-goals → enforced by exclusion (no Form/Calendar/etc.)
- §4 Future-component policy → Task 12 (added to main spec)
- §5 Setup → Task 1
- §6 Primitive replacements → Tasks 2-5
- §7 New components (Dialog/AlertDialog/RadioGroup/Select/Sonner) + refactor consumers → Tasks 7-11
- §8 Call-site migration → Task 6
- §9 Migration sequencing → matches Tasks 1-12 layout
- §10 Risk → mitigations baked into per-task verify steps (lint/test/build)
- §11 Testing → no new tests (per spec); per-task verify covers regression
- §12 Out of scope → enforced by exclusion
- §13 Update main spec → Task 12

✅ Full coverage.

### Placeholder scan

- ❌ Tidak ada "TBD" / "TODO" / "implement later"
- ✅ Setiap step yang ubah kode kasih full code block
- ✅ Setiap step command punya exact command + expected
- Note: Task 1 Step 3 instructs to "Hapus seluruh isi `:root { ... }` yang ditambah shadcn" — itu reference ke konten yang akan ditulis shadcn init, bukan placeholder

### Type consistency

- Variants Button: `default | secondary | destructive | outline | ghost | link | night` — konsisten Task 2 (extend), Task 6 (rename callers), Task 7-10 (consumers).
- Variants Card: `paper | receipt | inset` — konsisten Task 3 (define) + 9 (consumer keeps `variant="receipt"`).
- Variants Label: `eyebrow | default` — konsisten Task 5 (define), Task 9 (consumer uses `variant="default"` di RadioGroupItem label).
- shadcn semantic tokens (`--background`, `--foreground`, `--primary`, dll) — konsisten Task 1 (define aliases) + downstream (autospread via cn).
