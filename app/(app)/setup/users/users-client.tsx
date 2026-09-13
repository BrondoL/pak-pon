'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
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

export type UserRow = {
  user_id: string;
  email: string;
  display_name: string;
  role_id: string | null;
  role_name: string | null;
  is_superadmin: boolean;
  is_active: boolean;
};

export type RoleOption = { id: string; name: string };

// Sentinel value untuk pilihan "Tanpa role" di <Select> — base-ui Select tidak
// menerima value string kosong.
const NO_ROLE = '__none__';

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
      setCreateOpen(false);
      setDisplayName('');
      setEmail('');
      setPassword('');
      setRoleId(NO_ROLE);
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

  function handleSuperadminChange(row: UserRow, checked: boolean) {
    void withBusy(row.user_id, async () => {
      await patchUser(
        row.user_id,
        { is_superadmin: checked },
        checked ? 'Dijadikan superadmin' : 'Superadmin dicabut',
      );
    });
  }

  // ---------- Reset password ----------
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  function openReset(row: UserRow) {
    setResetPassword('');
    setResetTarget(row);
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
        setResetTarget(null);
      }
    } finally {
      // Jangan pernah menyisakan password di state setelah dialog ini selesai.
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

      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg text-coal">Daftar akun</h2>
        <Button onClick={openCreate}>+ Tambah akun</Button>
      </div>

      {users.length === 0 ? (
        <Card variant="paper" className="px-4 py-8 text-center text-sm text-clay">
          Belum ada akun.
        </Card>
      ) : (
        <Card variant="paper" className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-cream/60 text-xs uppercase tracking-wide text-coal-soft">
                <tr className="border-b border-clay-soft">
                  <th className="px-3 py-2 text-left font-medium">Nama</th>
                  <th className="px-3 py-2 text-left font-medium">Email</th>
                  <th className="px-3 py-2 text-left font-medium">Role</th>
                  <th className="px-3 py-2 text-left font-medium">Superadmin</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {users.map((row) => {
                  const isOrphan = row.display_name === '(tanpa profil)';
                  const isSelf = row.user_id === currentUserId;
                  const busy = busyIds.has(row.user_id);

                  if (isOrphan) {
                    return (
                      <tr key={row.user_id} className="border-b border-clay-soft/60 last:border-0">
                        <td className="px-3 py-2">
                          <span className="rounded-full bg-brick-faint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brick-dark">
                            (tanpa profil)
                          </span>
                        </td>
                        <td className="px-3 py-2 text-coal-soft">{row.email}</td>
                        <td className="px-3 py-2 text-clay">—</td>
                        <td className="px-3 py-2 text-clay">—</td>
                        <td className="px-3 py-2 text-clay">—</td>
                        <td className="px-3 py-2">
                          <AlertDialog
                            open={deletingId === row.user_id}
                            onOpenChange={(open) => setDeletingId(open ? row.user_id : null)}
                          >
                            <AlertDialogTrigger
                              disabled={deleteBusy}
                              render={
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-brick-dark hover:bg-brick-faint"
                                />
                              }
                            >
                              🗑️ Hapus
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Hapus akun yatim ini?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Akun {row.email} tidak punya data profil — kemungkinan pembuatan
                                  akun yang putus di tengah. Bisa login tapi tidak bisa apa-apa.
                                  Menghapusnya menghilangkan akun ini sepenuhnya.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel disabled={deleteBusy}>Batal</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDelete(row)}
                                  disabled={deleteBusy}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  {deleteBusy ? 'Menghapus…' : 'Ya, hapus'}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={row.user_id} className="border-b border-clay-soft/60 last:border-0">
                      <td className="px-3 py-2 text-coal">{row.display_name}</td>
                      <td className="px-3 py-2 text-coal-soft">{row.email}</td>
                      <td className="px-3 py-2">
                        <Select
                          value={row.role_id ?? NO_ROLE}
                          onValueChange={(v) => handleRoleChange(row, String(v))}
                          disabled={busy}
                        >
                          <SelectTrigger className="w-full min-w-32">
                            <SelectValue placeholder="Tanpa role" />
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
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={row.is_superadmin}
                            onCheckedChange={(v: boolean) => handleSuperadminChange(row, v)}
                            disabled={busy}
                          />
                          {row.is_superadmin && (
                            <span className="rounded-full bg-gold-faint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold-dark">
                              Superadmin
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={row.is_active}
                            onCheckedChange={(v: boolean) => handleActiveChange(row, v)}
                            disabled={busy || isSelf}
                            title={isSelf ? 'Tidak bisa menonaktifkan akun sendiri' : undefined}
                          />
                          <span className="text-xs text-coal-soft">
                            {row.is_active ? 'Aktif' : 'Nonaktif'}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button variant="secondary" size="sm" onClick={() => openReset(row)}>
                            🔑 Reset password
                          </Button>
                          <AlertDialog
                            open={deletingId === row.user_id}
                            onOpenChange={(open) => setDeletingId(open ? row.user_id : null)}
                          >
                            <AlertDialogTrigger
                              disabled={deleteBusy || isSelf}
                              render={
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-brick-dark hover:bg-brick-faint"
                                  title={isSelf ? 'Tidak bisa menghapus akun sendiri' : undefined}
                                />
                              }
                            >
                              🗑️ Hapus
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  Hapus akun &ldquo;{row.display_name}&rdquo;?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  Akun {row.email} akan dihapus sepenuhnya dan tidak bisa login
                                  lagi. Aksi ini tidak bisa dibatalkan.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel disabled={deleteBusy}>Batal</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDelete(row)}
                                  disabled={deleteBusy}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  {deleteBusy ? 'Menghapus…' : 'Ya, hapus'}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Tambah akun */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
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
                  <SelectValue placeholder="Tanpa role" />
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
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
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
          if (!open) {
            setResetTarget(null);
            setResetPassword('');
          }
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
            <Button
              variant="outline"
              onClick={() => setResetTarget(null)}
              disabled={resetBusy}
            >
              Batal
            </Button>
            <Button onClick={handleResetPassword} disabled={resetBusy}>
              {resetBusy ? 'Menyimpan…' : 'Simpan password baru'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
