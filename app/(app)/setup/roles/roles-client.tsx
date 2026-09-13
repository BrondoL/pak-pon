'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
import { PERMISSIONS, isPermissionKey, type PermissionKey, type PermissionGroup } from '@/lib/permissions';

export type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  user_count: number;
};

const GROUPS: PermissionGroup[] = ['Operasional', 'Transaksi', 'Laporan', 'Menu', 'Setup'];

type ApiErrorBody = { error?: string; detail?: string };

/** Pesan siap-tampil dalam Bahasa Indonesia. `detail` dari server (mis. 409
 * role_in_use) selalu diutamakan karena sudah ditulis untuk owner. */
function errorMessage(body: ApiErrorBody, fallback: string): string {
  if (body.detail) return body.detail;
  switch (body.error) {
    case 'duplicate_name':
      return 'Nama role sudah dipakai, pilih nama lain.';
    case 'invalid_body':
      return 'Data tidak valid. Cek nama dan izin yang dipilih.';
    case 'not_found':
      return 'Role sudah tidak ada. Muat ulang halaman.';
    default:
      return body.error ?? fallback;
  }
}

export function RolesClient({ initialRoles }: { initialRoles: RoleRow[] }) {
  const router = useRouter();
  const roles = initialRoles;

  // null = mode "tambah role baru"; berisi role = mode "ubah".
  const [editingRole, setEditingRole] = useState<RoleRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<PermissionKey>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  // Role mana yang dialog konfirmasi hapusnya sedang terbuka. Dikontrol manual
  // (bukan uncontrolled AlertDialog) karena AlertDialogAction di fork base-ui
  // ini BUKAN Close — lihat handleDelete, pola sama dengan toggle bayar di
  // TransactionDetail.
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  function openCreate() {
    setEditingRole(null);
    setName('');
    setDescription('');
    setSelected(new Set());
    setFormOpen(true);
  }

  function openEdit(role: RoleRow) {
    setEditingRole(role);
    setName(role.name);
    setDescription(role.description ?? '');
    setSelected(new Set(role.permissions.filter(isPermissionKey)));
    setFormOpen(true);
  }

  function toggle(key: PermissionKey, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error('Nama role wajib diisi');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: trimmedName,
        description: description.trim() || null,
        permissions: Array.from(selected),
      };
      const url = editingRole ? `/api/roles/${editingRole.id}` : '/api/roles';
      const method = editingRole ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body: ApiErrorBody = await res.json().catch(() => ({}));
        toast.error(errorMessage(body, 'Gagal menyimpan role'));
        return;
      }
      toast.success(editingRole ? 'Role diperbarui' : 'Role dibuat');
      setFormOpen(false);
      router.refresh();
    } catch {
      toast.error('Gagal menyimpan role. Coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(role: RoleRow) {
    // Tutup dulu, baru proses — dialog ini tidak menutup dirinya sendiri.
    setDeletingId(null);
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/roles/${role.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body: ApiErrorBody = await res.json().catch(() => ({}));
        toast.error(errorMessage(body, 'Gagal menghapus role'));
        return;
      }
      toast.success(`Role "${role.name}" dihapus`);
      router.refresh();
    } catch {
      toast.error('Gagal menghapus role. Coba lagi.');
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-clay-soft bg-cream/40 px-4 py-3 text-xs text-coal-soft">
        Kelola akun dan role hanya bisa dilakukan superadmin, dan itu bukan izin yang bisa
        dicentang di sini.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg text-coal">
          Daftar role{' '}
          <span className="font-body text-sm font-normal text-clay">({roles.length})</span>
        </h2>
        <Button onClick={openCreate} className="max-sm:w-full">+ Tambah role</Button>
      </div>

      {roles.length === 0 ? (
        <Card variant="paper" className="px-6 py-12 text-center">
          <p className="font-display text-xl italic text-coal">Belum ada role.</p>
          <p className="mt-2 text-sm text-coal-soft">
            Buat role dulu, lalu tugaskan ke akun kasir di halaman Akun &amp; Pengguna.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {roles.map((role) => (
            <Card key={role.id} variant="paper" className="px-4 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-display text-base text-coal">{role.name}</p>
                  {role.description && (
                    <p className="mt-0.5 text-sm text-coal-soft">{role.description}</p>
                  )}
                  <p className="mt-1 text-xs text-clay">
                    {role.permissions.length} izin · {role.user_count} pemakai
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2 border-t border-clay-soft/60 pt-3 sm:border-0 sm:pt-0">
                  <Button variant="secondary" size="sm" onClick={() => openEdit(role)}>
                    ✏️ Ubah
                  </Button>
                  <AlertDialog
                    open={deletingId === role.id}
                    onOpenChange={(open) => setDeletingId(open ? role.id : null)}
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
                        <AlertDialogTitle>Hapus role &ldquo;{role.name}&rdquo;?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {role.user_count > 0
                            ? `Role ini masih dipakai ${role.user_count} akun. Pindahkan akunnya ke role lain dulu sebelum bisa dihapus.`
                            : 'Role ini belum dipakai akun mana pun. Aksi ini tidak bisa dibatalkan.'}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleteBusy}>Batal</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDelete(role)}
                          disabled={deleteBusy}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {deleteBusy ? 'Menghapus…' : 'Ya, hapus'}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingRole ? `Ubah role "${editingRole.name}"` : 'Tambah role'}
            </DialogTitle>
            <DialogDescription>
              Tentukan nama, deskripsi, dan izin yang dipegang role ini.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="role-name">Nama role</Label>
              <Input
                id="role-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="mis. Kasir Pagi"
                maxLength={40}
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="role-description">Deskripsi (opsional)</Label>
              <Textarea
                id="role-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Untuk apa role ini dipakai"
                maxLength={160}
                rows={2}
                className="mt-2"
              />
            </div>

            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-clay">
                Izin
              </p>
              {GROUPS.map((g) => {
                const inGroup = PERMISSIONS.filter((p) => p.group === g);
                const ticked = inGroup.filter((p) => selected.has(p.key)).length;
                return (
                  <fieldset key={g} className="rounded-lg border border-clay-soft bg-paper-soft p-3">
                    {/* Hitungan per kelompok: sekali lihat ketahuan "Laporan 1/2" —
                        tanpa ini owner harus menghitung centang satu per satu. */}
                    <legend className="flex items-baseline gap-2 px-1">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-clay">
                        {g}
                      </span>
                      <span
                        className={
                          ticked === 0
                            ? 'font-body text-[11px] tabular-nums text-clay-soft'
                            : 'font-body text-[11px] font-semibold tabular-nums text-gold-dark'
                        }
                      >
                        {ticked}/{inGroup.length}
                      </span>
                    </legend>
                    <div className="divide-y divide-clay-soft/50">
                      {inGroup.map((p) => (
                        // Baris penuh jadi target sentuh, switch di kanan — di HP
                        // switch kecil di kiri teks panjang sulit dikenai jempol.
                        <label
                          key={p.key}
                          className="flex cursor-pointer items-start justify-between gap-4 py-2.5"
                        >
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-coal">{p.label}</span>
                            <span className="block text-xs leading-relaxed text-clay">{p.hint}</span>
                          </span>
                          <Switch
                            className="mt-0.5 shrink-0"
                            checked={selected.has(p.key)}
                            onCheckedChange={(v: boolean) => toggle(p.key, v)}
                          />
                        </label>
                      ))}
                    </div>
                  </fieldset>
                );
              })}
            </div>
          </div>

          {/* Menempel di bawah: dengan 13 izin dalam 5 kelompok, di HP tombol Simpan
              berada jauh di ujung gulungan kalau ikut mengalir bersama isinya. */}
          <DialogFooter className="sticky bottom-0 -mx-4 -mb-4 mt-2 border-t border-clay-soft/60 bg-popover px-4 py-3">
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={submitting}>
              Batal
            </Button>
            <Button onClick={handleSave} disabled={submitting}>
              {submitting ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
