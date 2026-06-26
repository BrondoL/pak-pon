import { describe, it, expect } from 'vitest';
import { AgentPatchSchema } from './_schema';

describe('AgentPatchSchema', () => {
  it('accepts { is_primary: true }', () => {
    expect(AgentPatchSchema.safeParse({ is_primary: true }).success).toBe(true);
  });

  it('rejects { is_primary: false } — demote tidak diizinkan', () => {
    expect(AgentPatchSchema.safeParse({ is_primary: false }).success).toBe(false);
  });

  it('rejects empty object', () => {
    expect(AgentPatchSchema.safeParse({}).success).toBe(false);
  });

  it('rejects extra fields (strict)', () => {
    expect(AgentPatchSchema.safeParse({ is_primary: true, extra: 'foo' }).success).toBe(false);
  });

  it('rejects non-boolean', () => {
    expect(AgentPatchSchema.safeParse({ is_primary: 'true' }).success).toBe(false);
  });
});
