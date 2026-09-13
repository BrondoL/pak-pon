import { describe, it, expect } from 'vitest';
import { NO_ROLE, roleLabel, labelFrom } from './select-labels';

const roles = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Kasir' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Kasir Senior' },
];

describe('roleLabel', () => {
  it('menampilkan nama role, bukan uuid-nya', () => {
    expect(roleLabel('11111111-1111-4111-8111-111111111111', roles)).toBe('Kasir');
  });

  it('sentinel NO_ROLE tampil sebagai "Tanpa role", bukan __none__', () => {
    expect(roleLabel(NO_ROLE, roles)).toBe('Tanpa role');
    expect(roleLabel(NO_ROLE, roles)).not.toContain('none');
  });

  it('null dan string kosong juga "Tanpa role"', () => {
    expect(roleLabel(null, roles)).toBe('Tanpa role');
    expect(roleLabel('', roles)).toBe('Tanpa role');
  });

  it('uuid yang rolenya sudah dihapus tidak bocor ke layar', () => {
    // Role dihapus di tab lain sementara halaman ini masih terbuka.
    expect(roleLabel('99999999-9999-4999-8999-999999999999', roles)).toBe('Tanpa role');
  });

  it('daftar role kosong tidak melempar', () => {
    expect(roleLabel('11111111-1111-4111-8111-111111111111', [])).toBe('Tanpa role');
  });
});

describe('labelFrom', () => {
  const STATUS = { all: 'Semua', confirmed: 'Confirmed', pending_review: 'Pending Review' };

  it('memetakan nilai ke labelnya', () => {
    expect(labelFrom(STATUS, 'pending_review', 'Semua')).toBe('Pending Review');
  });

  it('nilai tak dikenal jatuh ke fallback, bukan tampil mentah', () => {
    expect(labelFrom(STATUS, 'entah', 'Semua')).toBe('Semua');
    expect(labelFrom(STATUS, null, 'Semua')).toBe('Semua');
  });
});
