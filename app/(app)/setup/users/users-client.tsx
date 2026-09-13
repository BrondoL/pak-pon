'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { NO_ROLE, roleLabel, type RoleOption } from '@/lib/select-labels';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

export type { RoleOption };

export type UserRow = {
  user_id: string;
  email: string;
  display_name: string;
  role_id: string | null;
  role_name: string | null;
  is_superadmin: boolean;
  is_active: boolean;
};


type ApiErrorBody = { error?: string; detail?: string };

/** Pesan siap-tampil dalam Bahasa Indonesia. `detail` dari server (mis. 409
 * last_superadmin) selalu diutamakan karena sudah ditulis untuk owner. */
function errorMessage(body: ApiErrorBody, fallback: string): string {
  if (body.detail) return body.detail;
  if (body.error === 'invalid_body') return 'Data tidak valid. Cek isian dan coba lagi.';
  return body.error ?? fallback;
}

export function UsersClient({
  initialUsers,
  roles,
  currentUserId,
}: {
  initialUsers: UserRow[];
  roles: RoleOption[];
  currentUserId: string;
}) {
  const router = useRouter();
  const users = initialUsers;

  // Baris yang sedang punya aksi berjalan (select/switch/reset/hapus) — dicegah
  // dobel-klik sambil menunggu router.refresh().
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  function setBusy(id: string, busy: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // ---------- Tambah akun ----------
  const [createOpen, setCreateOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState<string>(NO_ROLE);
  const [creating, setCreating] = useState(false);

  function openCreate() {
    setDisplayName('');
    setEmail('');
    setPassword('');
    setRoleId(NO_ROLE);
    setCreateOpen(true);
  }

  // Satu jalur tutup untuk SEMUA cara dialog ini bisa tertutup — tombol Batal,
  // Escape, klik di luar (backdrop), dan sesudah sukses simpan — supaya password
  // yang sempat diketik tidak pernah nyangkut di state kalau ada jalur keempat
  // di masa depan yang lupa membersihkannya.
  function closeCreate() {
    setCreateOpen(false);
    setDisplayName('');
    setEmail('');
    setPassword('');
    setRoleId(NO_ROLE);
  }

  async function handleCreate() {
    const trimmedName = displayName.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName) {
      toast.error('Nama wajib diisi');
      return;
    }
    if (!trimmedEmail) {
      toast.error('Email wajib diisi');
      return;
    }
    if (password.length < 8) {
      toast.error('Password minimal 8 karakter');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: trimmedEmail,
          password,
          display_name: trimmedName,
          role_id: roleId === NO_ROLE ? null : roleId,
        }),
      });
      if (!res.ok) {
        const body: ApiErrorBody = await res.json().catch(() => ({}));
        toast.error(errorMessage(body, 'Gagal membuat akun'));
        return;
      }
      // Kredensial ditampilkan SEKALI di sini lewat toast, lalu langsung dilupakan —
      // tidak disimpan di state, tidak ditampilkan lagi setelah dialog ditutup.
      toast.success(`Akun ${trimmedEmail} dibuat`, {
        description: `Password: ${password} — catat sekarang, tidak akan ditampilkan lagi.`,
        duration: 30000,
      });
      closeCreate();
      router.refresh();
    } catch {
      toast.error('Gagal membuat akun. Coba lagi.');
    } finally {
      setCreating(false);
    }
  }

  // ---------- Aksi per baris (role, aktif/nonaktif, superadmin) ----------
  async function patchUser(userId: string, patch: Record<string, unknown>, sukses: string) {
    const res = await fetch(`/api/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const body: ApiErrorBody = await res.json().catch(() => ({}));
      // 409 last_superadmin membawa `detail` berbahasa Indonesia yang sudah siap tampil.
      toast.error(errorMessage(body, 'Gagal menyimpan perubahan.'));
      return false;
    }
    toast.success(sukses);
    router.refresh();
    return true;
  }

  async function withBusy(id: string, fn: () => Promise<void>) {
    setBusy(id, true);
    try {
      await fn();
    } catch {
      toast.error('Gagal menyimpan perubahan. Coba lagi.');
    } finally {
      setBusy(id, false);
    }
  }

  function handleRoleChange(row: UserRow, value: string) {
    void withBusy(row.user_id, async () => {
      await patchUser(row.user_id, { role_id: value === NO_ROLE ? null : value }, 'Role diperbarui');
    });
  }

  function handleActiveChange(row: UserRow, checked: boolean) {
    void withBusy(row.user_id, async () => {
      await patchUser(
        row.user_id,
        { is_active: checked },
        checked ? 'Akun diaktifkan' : 'Akun dinonaktifkan',
      );
    });
  }

  // Superadmin mengubah apa yang BISA dilakukan sebuah login di seluruh aplikasi —
  // konsekuensinya lebih besar dari sekadar aktif/nonaktif, jadi selalu lewat
  // AlertDialog konfirmasi (termasuk untuk baris milik diri sendiri: switch-nya
  // TIDAK di-disable di sana, karena itu cuma kesopanan UI dan bisa membuat
  // owner mengira UI-lah yang mencegah dia mendemosi diri sendiri — penjaga
  // sebenarnya ada di server (409 last_superadmin), dan dialog ini tetap wajib
  // mengirim PATCH-nya supaya penjaga itu sempat menyala).
  const [superadminTarget, setSuperadminTarget] = useState<{
    row: UserRow;
    nextValue: boolean;
  } | null>(null);
  const [superadminBusy, setSuperadminBusy] = useState(false);

  function requestSuperadminChange(row: UserRow, nextValue: boolean) {
    setSuperadminTarget({ row, nextValue });
  }

  function superadminDialogCopy(target: { row: UserRow; nextValue: boolean }) {
    const isSelfRow = target.row.user_id === currentUserId;
    if (target.nextValue) {
      return {
        title: `Jadikan "${target.row.display_name}" superadmin?`,
        description:
          'Akun ini akan bisa melakukan apa saja di aplikasi ini, termasuk mengelola akun dan role — dan tidak bisa dibatasi lewat role apa pun.',
      };
    }
    if (isSelfRow) {
      return {
        title: 'Cabut superadmin dari akun sendiri?',
        description:
          'Begitu disimpan, Anda akan langsung kehilangan akses ke halaman Akun & Pengguna dan Role & Izin.',
      };
    }
    return {
      title: `Cabut superadmin dari "${target.row.display_name}"?`,
      description: 'Akun ini akan kehilangan akses ke pengelolaan akun dan role.',
    };
  }

  async function confirmSuperadminChange() {
    if (!superadminTarget) return;
    const { row, nextValue } = superadminTarget;
    setSuperadminBusy(true);
    try {
      await patchUser(
        row.user_id,
        { is_superadmin: nextValue },
        nextValue ? 'Dijadikan superadmin' : 'Superadmin dicabut',
      );
    } finally {
      setSuperadminBusy(false);
      setSuperadminTarget(null);
    }
  }

  // ---------- Reset password ----------
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  function openReset(row: UserRow) {
    setResetPassword('');
    setResetTarget(row);
  }

  // Satu jalur tutup untuk SEMUA cara dialog ini bisa tertutup — tombol Batal,
  // Escape, klik di luar (backdrop), dan sesudah sukses reset — supaya password
  // yang sempat diketik tidak pernah nyangkut di state.
  function closeReset() {
    setResetTarget(null);
    setResetPassword('');
  }

  async function handleResetPassword() {
    if (!resetTarget) return;
    if (resetPassword.length < 8) {
      toast.error('Password minimal 8 karakter');
      return;
    }
    setResetBusy(true);
    try {
      const ok = await patchUser(resetTarget.user_id, { password: resetPassword }, 'Password direset');
      if (ok) {
        closeReset();
      }
    } finally {
      // Jangan pernah menyisakan password di state setelah dialog ini selesai —
      // termasuk saat gagal dan dialognya tetap terbuka untuk dicoba ulang.
      setResetPassword('');
      setResetBusy(false);
    }
  }

  // ---------- Hapus akun ----------
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function handleDelete(row: UserRow) {
    // Tutup dulu, baru proses — AlertDialogAction di fork base-ui ini bukan Close.
    setDeletingId(null);
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/users/${row.user_id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body: ApiErrorBody = await res.json().catch(() => ({}));
        toast.error(errorMessage(body, 'Gagal menghapus akun'));
        return;
      }
      toast.success(`Akun "${row.display_name || row.email}" dihapus`);
      router.refresh();
    } catch {
      toast.error('Gagal menghapus akun. Coba lagi.');
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-clay-soft bg-cream/40 px-4 py-3 text-xs text-coal-soft">
        Password akun cuma ditampilkan sekali saat dibuat atau direset — catat langsung, tidak
        bisa dilihat lagi sesudahnya.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg text-coal">
          Daftar akun{' '}
          <span className="font-body text-sm font-normal text-clay">({users.length})</span>
        </h2>
        <Button onClick={openCreate} className="max-sm:w-full">+ Tambah akun</Button>
      </div>

      {users.length === 0 ? (
        <Card variant="paper" className="px-6 py-12 text-center">
          <p className="font-display text-xl italic text-coal">Belum ada akun lain.</p>
          <p className="mt-2 text-sm text-coal-soft">
            Tambah akun untuk kasir supaya dia bisa masuk dengan loginnya sendiri.
          </p>
        </Card>
      ) : (
        // Kartu, bukan tabel: baris akun berisi dropdown + switch + tombol, dan tabel
        // enam kolom mustahil dipakai di HP. Satu tata letak untuk semua ukuran —
        // tidak ada versi mobile dan desktop terpisah yang harus dijaga selaras.
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {users.map((row) => {
            const isOrphan = row.display_name === '(tanpa profil)';
            const isSelf = row.user_id === currentUserId;
            const busy = busyIds.has(row.user_id);

            const deleteDialog = (
              <AlertDialog
                open={deletingId === row.user_id}
                onOpenChange={(open) => setDeletingId(open ? row.user_id : null)}
              >
                <AlertDialogTrigger
                  disabled={deleteBusy || (!isOrphan && isSelf)}
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-brick-dark hover:bg-brick-faint"
                      title={!isOrphan && isSelf ? 'Tidak bisa menghapus akun sendiri' : undefined}
                    />
                  }
                >
                  🗑️ Hapus
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {isOrphan
                        ? 'Hapus akun yatim ini?'
                        : `Hapus akun \u201C${row.display_name}\u201D?`}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {isOrphan
                        ? `Akun ${row.email} tidak punya data profil — kemungkinan pembuatan akun yang putus di tengah. Bisa login tapi tidak bisa apa-apa. Menghapusnya menghilangkan akun ini sepenuhnya.`
                        : `Akun ${row.email} akan dihapus sepenuhnya dan tidak bisa login lagi. Aksi ini tidak bisa dibatalkan.`}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={deleteBusy}>Batal</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => handleDelete(row)}
                      disabled={deleteBusy}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {deleteBusy ? 'Menghapus\u2026' : 'Ya, hapus'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            );

            if (isOrphan) {
              return (
                <Card
                  key={row.user_id}
                  variant="paper"
                  className="flex flex-col gap-3 border-brick-soft/40 p-4"
                >
                  <div className="min-w-0">
                    <span className="inline-block rounded-full bg-brick-faint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brick-dark">
                      Tanpa profil
                    </span>
                    <p className="mt-2 truncate text-sm text-coal-soft">{row.email}</p>
                  </div>
                  <p className="text-xs leading-relaxed text-clay">
                    Bisa login tapi tidak bisa apa-apa. Kemungkinan pembuatan akun yang putus di
                    tengah.
                  </p>
                  <div className="flex justify-end border-t border-clay-soft/60 pt-3">
                    {deleteDialog}
                  </div>
                </Card>
              );
            }

            return (
              <Card
                key={row.user_id}
                variant="paper"
                className={cn(
                  'flex flex-col gap-4 p-4 transition-opacity',
                  !row.is_active && 'opacity-60',
                )}
              >
                {/* Identitas */}
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-display text-xl leading-tight text-coal">
                      {row.display_name}
                    </p>
                    <p className="mt-0.5 truncate text-sm text-coal-soft">{row.email}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {row.is_superadmin && (
                      <span className="rounded-full border border-gold/40 bg-gold-faint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold-dark">
                        Superadmin
                      </span>
                    )}
                    {!row.is_active && (
                      <span className="rounded-full bg-clay-mist px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-coal-soft">
                        Nonaktif
                      </span>
                    )}
                    {isSelf && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-clay">
                        Anda
                      </span>
                    )}
                  </div>
                </div>

                {/* Kemampuan & status */}
                <div className="space-y-3 border-t border-clay-soft/60 pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-clay">
                      Role
                    </span>
                    <Select
                      value={row.role_id ?? NO_ROLE}
                      onValueChange={(v) => handleRoleChange(row, String(v))}
                      disabled={busy}
                    >
                      <SelectTrigger className="h-9 w-44 max-w-[60%]">
                        <SelectValue>{(v) => roleLabel(v as string | null, roles)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_ROLE}>Tanpa role</SelectItem>
                        {roles.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium uppercase tracking-wide text-clay">
                      Superadmin
                    </span>
                    <Switch
                      checked={row.is_superadmin}
                      onCheckedChange={(v: boolean) => requestSuperadminChange(row, v)}
                      disabled={busy}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium uppercase tracking-wide text-clay">
                      {row.is_active ? 'Aktif' : 'Nonaktif'}
                    </span>
                    <Switch
                      checked={row.is_active}
                      onCheckedChange={(v: boolean) => handleActiveChange(row, v)}
                      disabled={busy || isSelf}
                      title={isSelf ? 'Tidak bisa menonaktifkan akun sendiri' : undefined}
                    />
                  </div>
                </div>

                {/* Aksi */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-clay-soft/60 pt-3">
                  <Button variant="secondary" size="sm" onClick={() => openReset(row)}>
                    🔑 Reset password
                  </Button>
                  {deleteDialog}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Tambah akun */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open) closeCreate();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tambah akun</DialogTitle>
            <DialogDescription>
              Buat akun baru untuk kasir atau owner lain. Kredensialnya cuma ditampilkan sekali
              setelah disimpan.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="user-name">Nama</Label>
              <Input
                id="user-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="mis. Kasir Sore"
                maxLength={60}
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="user-email">Email</Label>
              <Input
                id="user-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="kasir1@pakpon.local"
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="user-password">Password</Label>
              {/* Sengaja type="text", bukan "password" — owner biasanya membacakan atau
                  menuliskan tangan password ini untuk diserahkan ke kasir, jadi
                  menyamarkannya justru menyulitkan alur kerja nyata. */}
              <Input
                id="user-password"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="minimal 8 karakter"
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="user-role">Role</Label>
              <Select value={roleId} onValueChange={(v) => setRoleId(String(v))}>
                <SelectTrigger id="user-role" className="mt-2 w-full">
                  <SelectValue>{(v) => roleLabel(v as string | null, roles)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ROLE}>Tanpa role</SelectItem>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeCreate} disabled={creating}>
              Batal
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password */}
      <Dialog
        open={resetTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeReset();
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset password {resetTarget?.display_name}</DialogTitle>
            <DialogDescription>
              Password baru cuma ditampilkan sekali lewat notifikasi setelah disimpan.
            </DialogDescription>
          </DialogHeader>

          <div>
            <Label htmlFor="reset-password">Password baru</Label>
            {/* Sengaja type="text", bukan "password" — sama seperti dialog Tambah akun:
                owner butuh membaca/menuliskan tangan password ini untuk kasir. */}
            <Input
              id="reset-password"
              type="text"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              placeholder="minimal 8 karakter"
              className="mt-2"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeReset} disabled={resetBusy}>
              Batal
            </Button>
            <Button onClick={handleResetPassword} disabled={resetBusy}>
              {resetBusy ? 'Menyimpan…' : 'Simpan password baru'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ubah status superadmin — selalu lewat konfirmasi, termasuk baris sendiri. */}
      <AlertDialog
        open={superadminTarget !== null}
        onOpenChange={(open) => {
          if (!open) setSuperadminTarget(null);
        }}
      >
        <AlertDialogContent>
          {superadminTarget && (
            <AlertDialogHeader>
              <AlertDialogTitle>{superadminDialogCopy(superadminTarget).title}</AlertDialogTitle>
              <AlertDialogDescription>
                {superadminDialogCopy(superadminTarget).description}
              </AlertDialogDescription>
            </AlertDialogHeader>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={superadminBusy}>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSuperadminChange} disabled={superadminBusy}>
              {superadminBusy ? 'Menyimpan…' : 'Ya, lanjutkan'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
