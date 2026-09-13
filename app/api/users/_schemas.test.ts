import { describe, it, expect } from 'vitest';
import { CreateUserSchema, UpdateUserSchema } from './_schemas';

describe('CreateUserSchema', () => {
  it('menerima akun kasir yang wajar', () => {
    const r = CreateUserSchema.safeParse({
      email: 'kasir1@pakpon.local',
      password: 'rahasia123',
      display_name: 'Kasir 1',
      role_id: '11111111-1111-1111-1111-111111111111',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.is_superadmin).toBe(false);
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
