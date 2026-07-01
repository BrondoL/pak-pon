import { describe, it, expect, afterEach } from 'vitest';
import { __readMaxWidthForTest } from './compress';

describe('compressNotaImage max width env var', () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_IMAGE_MAX_WIDTH;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_IMAGE_MAX_WIDTH;
    else process.env.NEXT_PUBLIC_IMAGE_MAX_WIDTH = ORIGINAL;
  });

  it('defaults to 1600 when env var missing', () => {
    delete process.env.NEXT_PUBLIC_IMAGE_MAX_WIDTH;
    expect(__readMaxWidthForTest()).toBe(1600);
  });

  it('parses valid integer within range', () => {
    process.env.NEXT_PUBLIC_IMAGE_MAX_WIDTH = '800';
    expect(__readMaxWidthForTest()).toBe(800);
  });

  it('falls back to default when value out of range (too small)', () => {
    process.env.NEXT_PUBLIC_IMAGE_MAX_WIDTH = '99';
    expect(__readMaxWidthForTest()).toBe(1600);
  });

  it('falls back to default when value out of range (too large)', () => {
    process.env.NEXT_PUBLIC_IMAGE_MAX_WIDTH = '9999';
    expect(__readMaxWidthForTest()).toBe(1600);
  });

  it('falls back to default when value non-numeric', () => {
    process.env.NEXT_PUBLIC_IMAGE_MAX_WIDTH = 'abc';
    expect(__readMaxWidthForTest()).toBe(1600);
  });
});
