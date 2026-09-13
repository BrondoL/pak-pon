import { describe, it, expect } from 'vitest';
import { buildActorTags } from './session';
import { resolveActor, type ProfileRow } from '@/lib/permissions';

const kasir: ProfileRow = {
  user_id: 'u1',
  display_name: 'Kasir 1',
  is_superadmin: false,
  is_active: true,
  role_id: 'r1',
  roles: { name: 'Kasir', role_permissions: [{ permission_key: 'pos.use' }] },
};

describe('buildActorTags', () => {
  it('menandai user_id dan nama role', () => {
    expect(buildActorTags(resolveActor(kasir)!)).toEqual({
      user_id: 'u1',
      actor_role: 'Kasir',
    });
  });

  it('superadmin ditandai "superadmin" walau tanpa role', () => {
    const actor = resolveActor({ ...kasir, is_superadmin: true, role_id: null, roles: null })!;
    expect(buildActorTags(actor)).toEqual({ user_id: 'u1', actor_role: 'superadmin' });
  });

  it('user tanpa role ditandai null, bukan string kosong', () => {
    const actor = resolveActor({ ...kasir, role_id: null, roles: null })!;
    expect(buildActorTags(actor).actor_role).toBeNull();
  });
});
