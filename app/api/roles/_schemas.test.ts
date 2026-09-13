import { describe, it, expect } from 'vitest';
import { RoleWriteSchema } from './_schemas';

describe('RoleWriteSchema', () => {
  it('menerima role dengan izin sah', () => {
    const r = RoleWriteSchema.safeParse({
      name: 'Kasir Senior',
      description: null,
      permissions: ['pos.use', 'reports.daily.view'],
    });
    expect(r.success).toBe(true);
  });

  it('menolak kunci izin yang tidak ada di katalog', () => {
    const r = RoleWriteSchema.safeParse({
      name: 'X', description: null, permissions: ['izin.hantu'],
    });
    expect(r.success).toBe(false);
  });

  it('menolak kunci manajemen user yang diselundupkan', () => {
    const r = RoleWriteSchema.safeParse({
      name: 'X', description: null, permissions: ['users.manage'],
    });
    expect(r.success).toBe(false);
  });

  it('role tanpa izin sama sekali boleh (dibuat dulu, dicentang belakangan)', () => {
    const r = RoleWriteSchema.safeParse({ name: 'Baru', description: null, permissions: [] });
    expect(r.success).toBe(true);
  });

  it('membuang izin duplikat', () => {
    const r = RoleWriteSchema.safeParse({
      name: 'X', description: null, permissions: ['pos.use', 'pos.use'],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.permissions).toEqual(['pos.use']);
  });
});
