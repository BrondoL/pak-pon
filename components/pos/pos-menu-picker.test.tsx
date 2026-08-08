import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { PosMenuPicker } from './pos-menu-picker';
import type { MenuOption } from '@/components/nota-item-modal';

// Semua kategori "makanan" — tab aktif default picker "makanan", jadi tidak
// perlu ganti tab dulu sebelum menekan kartu.
const menus: MenuOption[] = [
  { id: 'menu-tempe', name: 'Tempe Goreng', category: 'makanan', price: 8000, chips: [] },
  { id: 'menu-tahu', name: 'Tahu Goreng', category: 'makanan', price: 7000, chips: [] },
];

// Sengaja fireEvent, bukan userEvent: userEvent menunggu timer internalnya
// sendiri dan menggantung selamanya di bawah vi.useFakeTimers(). Kartu menu
// cuma <button onClick>, jadi klik sintetis sudah memadai.
const card = (name: RegExp) => screen.getByRole('button', { name });
const tap = (name: RegExp) => fireEvent.click(card(name));

function setup(onMenuTap: (m: MenuOption) => boolean) {
  render(<PosMenuPicker menus={menus} onMenuTap={onMenuTap} />);
}

describe('<PosMenuPicker /> — kilatan setelah item mendarat', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('menyalakan kartu saat onMenuTap melaporkan baris mendarat', () => {
    setup(() => true);
    tap(/tempe goreng/i);
    expect(card(/tempe goreng/i)).toHaveClass('tap-flash');
  });

  it('memadamkan kartu setelah 400ms', () => {
    setup(() => true);
    tap(/tempe goreng/i);
    act(() => { vi.advanceTimersByTime(400); });
    expect(card(/tempe goreng/i)).not.toHaveClass('tap-flash');
  });

  it('tidak menyalakan kartu saat onMenuTap melaporkan modal yang terbuka', () => {
    setup(() => false);
    tap(/tempe goreng/i);
    expect(card(/tempe goreng/i)).not.toHaveClass('tap-flash');
  });

  it('tap kedua me-reset timer, bukan padam di jadwal tap pertama', () => {
    setup(() => true);
    tap(/tempe goreng/i);
    act(() => { vi.advanceTimersByTime(300); });
    tap(/tempe goreng/i);
    // 300ms setelah tap kedua = 600ms setelah tap pertama. Kalau timernya tidak
    // di-reset, jadwal tap pertama (400ms) sudah memadamkannya di sini.
    act(() => { vi.advanceTimersByTime(300); });
    expect(card(/tempe goreng/i)).toHaveClass('tap-flash');
  });

  it('cuma satu kartu menyala pada satu waktu', () => {
    setup(() => true);
    tap(/tempe goreng/i);
    tap(/tahu goreng/i);
    expect(card(/tempe goreng/i)).not.toHaveClass('tap-flash');
    expect(card(/tahu goreng/i)).toHaveClass('tap-flash');
  });

  it('membersihkan timer saat unmount', () => {
    const { unmount } = render(
      <PosMenuPicker menus={menus} onMenuTap={() => true} />,
    );
    tap(/tempe goreng/i);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
