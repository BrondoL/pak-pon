import { describe, it, expect } from 'vitest';
import { CreateUserSchema, UpdateUserSchema } from './_schemas';

describe('CreateUserSchema', () => {
  it('menerima akun kasir yang wajar', () => {
    const r = CreateUserSchema.safeParse({
      email: 'kasir1@pakpon.local',
      password: 'rahasia123',
      display_name: 'Kasir 1',
      role_id: '11111111-1111-4111-8111-111111111111',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.is_superadmin).toBe(false);
  });

  it('menolak role_id yang bukan format UUID', () => {
    const r = CreateUserSchema.safeParse({
      email: 'a@b.local', password: 'rahasia123', display_name: 'X', role_id: 'not-a-uuid',
    });
    expect(r.success).toBe(false);
  });

  // Regresi: string ini pernah jadi fixture "valid" di test lain sebelum diperbaiki
  // (nibble varian '1', bukan salah satu dari 8/9/a/b — bukan UUID v4 asli seperti
  // yang dihasilkan Postgres gen_random_uuid()). z.string().guid() meloloskannya
  // (tanpa cek versi/varian sama sekali); .uuid() wajib menolaknya. Kalau test ini
  // gagal, seseorang mengganti .uuid() jadi .guid() lagi — jangan, perbaiki fixturenya.
  //
  // Catatan: nil UUID ('00000000-...-000000000000') SENGAJA tidak dipakai di sini —
  // zod v4 men-special-case nil UUID (dan max UUID 'ffffffff-...') sebagai valid di
  // .uuid() juga (lihat node_modules/zod/v4/core/regexes.js), jadi itu bukan test
  // yang membedakan .uuid() dari .guid().
  it('menolak role_id dengan nibble varian yang tidak RFC4122 (bukan v4 asli)', () => {
    const r = CreateUserSchema.safeParse({
      email: 'a@b.local',
      password: 'rahasia123',
      display_name: 'X',
      role_id: '11111111-1111-1111-1111-111111111111',
    });
    expect(r.success).toBe(false);
  });

  it('menolak password pendek', () => {
    const r = CreateUserSchema.safeParse({
      email: 'a@b.local', password: '12345', display_name: 'X', role_id: null,
    });
    expect(r.success).toBe(false);
  });

  it('menolak nama kosong', () => {
    const r = CreateUserSchema.safeParse({
      email: 'a@b.local', password: 'rahasia123', display_name: '   ', role_id: null,
    });
    expect(r.success).toBe(false);
  });

  it('email domain .local diterima (kasir sering tidak punya email asli)', () => {
    const r = CreateUserSchema.safeParse({
      email: 'kasir2@pakpon.local', password: 'rahasia123', display_name: 'Kasir 2', role_id: null,
    });
    expect(r.success).toBe(true);
  });
});

describe('UpdateUserSchema', () => {
  it('menerima patch sebagian', () => {
    expect(UpdateUserSchema.safeParse({ is_active: false }).success).toBe(true);
    expect(UpdateUserSchema.safeParse({ role_id: null }).success).toBe(true);
  });

  it('menolak body kosong', () => {
    expect(UpdateUserSchema.safeParse({}).success).toBe(false);
  });

  it('menolak password pendek', () => {
    expect(UpdateUserSchema.safeParse({ password: 'abc' }).success).toBe(false);
  });
});
