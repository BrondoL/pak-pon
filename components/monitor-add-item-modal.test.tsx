import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { MonitorAddItemModal } from './monitor-add-item-modal';
import type { MonitorRow } from '@/lib/monitor';
import type { MenuOption } from '@/components/nota-item-modal';
import { DEFAULT_PRINTER_SETTINGS } from '@/lib/printer-settings';

// Dua menu tanpa chip mutex supaya tap langsung masuk daftar (tanpa modal
// konfigurasi) — sama seperti pola pos-client.test.tsx. Kategori "makanan"
// karena tab aktif default PosMenuPicker "makanan", jadi tidak perlu ganti tab.
const menus: MenuOption[] = [
  { id: 'menu-ayam', name: 'Ayam Goreng', category: 'makanan', price: 20000, chips: [] },
  { id: 'menu-tempe', name: 'Tempe Goreng', category: 'makanan', price: 8000, chips: [] },
  // Fixture minuman: tab aktif default picker "makanan", jadi tidak
  // mengganggu tes lain yang tidak menyentuh tab minuman secara eksplisit.
  { id: 'menu-es-teh', name: 'Es Teh', category: 'minuman', price: 5000, chips: [] },
];

const ROW_ID = '22222222-2222-4222-8222-222222222222';
const ITEMS_URL = `/api/transactions/${ROW_ID}/items`;

function mkRow(override: Partial<MonitorRow> = {}): MonitorRow {
  return {
    id: ROW_ID,
    created_at: '2026-08-08T05:00:00.000Z',
    customer_name: 'Warto',
    table_no: '3',
    is_takeaway: false,
    total: 0,
    item_count: 0,
    ...override,
  };
}

function txResponse(row: MonitorRow) {
  return {
    id: row.id,
    daily_seq: 9,
    created_at: row.created_at,
    customer_name: row.customer_name,
    table_no: row.table_no,
    is_takeaway: row.is_takeaway,
  };
}

/** Router fetch mock: cocokkan berdasarkan URL + method, seperti sibling test files. */
function mockFetch(opts: {
  itemsStatus?: number;
  itemsBody?: unknown;
  itemsRaw?: string;
  printStatus?: number;
}) {
  const { itemsStatus = 201, itemsBody, itemsRaw, printStatus = 201 } = opts;
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === ITEMS_URL && init?.method === 'POST') {
      const body = itemsRaw ?? JSON.stringify(itemsBody ?? {});
      return Promise.resolve(new Response(body, { status: itemsStatus }));
    }
    if (url === '/api/print/send') {
      return Promise.resolve(new Response('{}', { status: printStatus }));
    }
    return Promise.resolve(new Response('{}', { status: 200 }));
  });
}

async function tapMenu(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(screen.getByRole('button', { name }));
}

function confirmButton() {
  return screen.getByRole('button', { name: /simpan & cetak/i });
}

describe('<MonitorAddItemModal /> — handleConfirm', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Behaviour 1: submitLock double-tap guard.
  it('dua tap cepat pada tombol Simpan cuma kirim satu POST item', async () => {
    let resolveItems!: () => void;
    const itemsGate = new Promise<void>((resolve) => {
      resolveItems = resolve;
    });
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === ITEMS_URL && init?.method === 'POST') {
        // Gated: baru resolve setelah test mengizinkan — supaya dua tap
        // benar-benar landing sebelum POST pertama selesai (race asli),
        // bukan cuma dua await user.click() berurutan yang lolos karena
        // tombol sempat ke-disable di antaranya.
        return itemsGate.then(
          () =>
            new Response(
              JSON.stringify({
                transaction: txResponse(mkRow()),
                items: [{ id: 'item-ayam', sort_order: 0 }],
              }),
              { status: 201 },
            ),
        );
      }
      if (url === '/api/print/send') {
        return Promise.resolve(new Response('{}', { status: 201 }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <MonitorAddItemModal
        row={mkRow()}
        menus={menus}
        printerSettings={DEFAULT_PRINTER_SETTINGS}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    await tapMenu(user, /ayam goreng/i);
    const btn = confirmButton();

    // Dua fireEvent.click dalam SATU act(): React belum sempat commit
    // setSubmitting(true) di antara keduanya, jadi kedua onClick handler
    // jalan sampai await pertama sebelum salah satu POST selesai — ini yang
    // membuat guard (ref sinkron), bukan atribut disabled, yang diuji.
    act(() => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });

    const postsWhileGated = fetchMock.mock.calls.filter(
      (c) => String(c[0]) === ITEMS_URL && (c[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(postsWhileGated).toHaveLength(1);

    resolveItems();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    const postsAfter = fetchMock.mock.calls.filter(
      (c) => String(c[0]) === ITEMS_URL && (c[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(postsAfter).toHaveLength(1);
  });

  // Behaviour 2 + 6 (overlap): 201 tapi body gagal diparse — saved harus
  // sudah true SEBELUM parsing, sehingga catch mengambil jalur "sudah commit"
  // (tutup via onSaved, lock tetap terkunci) bukan jalur retry.
  it('body 201 gagal diparse: ditutup lewat onSaved (bukan toast retry), dan lock tetap terkunci', async () => {
    const fetchMock = mockFetch({ itemsRaw: 'not-json{{{', itemsStatus: 201 });
    vi.stubGlobal('fetch', fetchMock);
    const errorSpy = vi.spyOn(toast, 'error');
    const successSpy = vi.spyOn(toast, 'success');
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <MonitorAddItemModal
        row={mkRow()}
        menus={menus}
        printerSettings={DEFAULT_PRINTER_SETTINGS}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    await tapMenu(user, /ayam goreng/i);
    await user.click(confirmButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    // Jalur "sudah commit" di catch: toast sukses + toast gagal cetak, BUKAN
    // toast retry "Gagal menambah item".
    expect(successSpy).toHaveBeenCalledWith('Item tersimpan');
    expect(errorSpy).toHaveBeenCalledWith('Gagal cetak tiket. Cetak manual dari detail transaksi.');
    expect(errorSpy).not.toHaveBeenCalledWith('Gagal menambah item', expect.anything());

    // Lock tetap terkunci: klik Simpan lagi tidak boleh kirim POST baru.
    const postsBefore = fetchMock.mock.calls.filter((c) => String(c[0]) === ITEMS_URL).length;
    await user.click(confirmButton());
    const postsAfter = fetchMock.mock.calls.filter((c) => String(c[0]) === ITEMS_URL).length;
    expect(postsAfter).toBe(postsBefore);
  });

  // Behaviour 6, sisi lain: insert BELUM commit (network error sebelum ada
  // response) — modal tetap terbuka, lock dilepas, retry benar-benar mengirim
  // POST baru.
  it('fetch gagal total sebelum ada response: toast retry, lock dilepas, percobaan kedua mengirim POST baru', async () => {
    let attempt = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === ITEMS_URL && init?.method === 'POST') {
        attempt += 1;
        if (attempt === 1) return Promise.reject(new Error('network down'));
        return Promise.resolve(
          new Response(
            JSON.stringify({
              transaction: txResponse(mkRow()),
              items: [{ id: 'item-ayam', sort_order: 0 }],
            }),
            { status: 201 },
          ),
        );
      }
      if (url === '/api/print/send') {
        return Promise.resolve(new Response('{}', { status: 201 }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const errorSpy = vi.spyOn(toast, 'error');
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <MonitorAddItemModal
        row={mkRow()}
        menus={menus}
        printerSettings={DEFAULT_PRINTER_SETTINGS}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    await tapMenu(user, /ayam goreng/i);
    await user.click(confirmButton());

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        'Gagal menambah item',
        expect.objectContaining({ description: 'network down' }),
      );
    });
    expect(onSaved).not.toHaveBeenCalled();

    // Draft masih ada (modal tidak ditutup) → klik Simpan lagi harus benar-
    // benar mengirim POST kedua, bukan no-op karena lock masih nyangkut.
    await user.click(confirmButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const posts = fetchMock.mock.calls.filter(
      (c) => String(c[0]) === ITEMS_URL && (c[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(posts).toHaveLength(2);
  });

  // Behaviour 3: 404 → tutup via onSaved dengan toast spesifik.
  it('404: transaksi sudah tidak ada → toast spesifik, modal ditutup via onSaved', async () => {
    const fetchMock = mockFetch({ itemsStatus: 404 });
    vi.stubGlobal('fetch', fetchMock);
    const errorSpy = vi.spyOn(toast, 'error');
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <MonitorAddItemModal
        row={mkRow()}
        menus={menus}
        printerSettings={DEFAULT_PRINTER_SETTINGS}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    await tapMenu(user, /ayam goreng/i);
    await user.click(confirmButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(errorSpy).toHaveBeenCalledWith('Transaksi sudah tidak ada');
  });

  // Behaviour 3: 409 → tutup via onSaved dengan toast spesifik.
  it('409: transaksi sudah tidak aktif → toast spesifik, modal ditutup via onSaved', async () => {
    const fetchMock = mockFetch({ itemsStatus: 409 });
    vi.stubGlobal('fetch', fetchMock);
    const errorSpy = vi.spyOn(toast, 'error');
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <MonitorAddItemModal
        row={mkRow()}
        menus={menus}
        printerSettings={DEFAULT_PRINTER_SETTINGS}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    await tapMenu(user, /ayam goreng/i);
    await user.click(confirmButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(errorSpy).toHaveBeenCalledWith('Transaksi sudah tidak aktif');
  });

  // Behaviour 3: 400 → modal tetap terbuka, lock dilepas, retry beneran kirim POST baru.
  it('400: menu berubah → modal tetap terbuka, lock dilepas sehingga retry mengirim POST baru', async () => {
    let attempt = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === ITEMS_URL && init?.method === 'POST') {
        attempt += 1;
        if (attempt === 1) return Promise.resolve(new Response('{}', { status: 400 }));
        return Promise.resolve(
          new Response(
            JSON.stringify({
              transaction: txResponse(mkRow()),
              items: [{ id: 'item-ayam', sort_order: 0 }],
            }),
            { status: 201 },
          ),
        );
      }
      if (url === '/api/print/send') {
        return Promise.resolve(new Response('{}', { status: 201 }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const errorSpy = vi.spyOn(toast, 'error');
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <MonitorAddItemModal
        row={mkRow()}
        menus={menus}
        printerSettings={DEFAULT_PRINTER_SETTINGS}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    await tapMenu(user, /ayam goreng/i);
    await user.click(confirmButton());

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        'Menu sudah berubah',
        expect.objectContaining({ description: expect.stringMatching(/reload/i) }),
      );
    });
    expect(onSaved).not.toHaveBeenCalled();

    await user.click(confirmButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const posts = fetchMock.mock.calls.filter(
      (c) => String(c[0]) === ITEMS_URL && (c[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(posts).toHaveLength(2);
  });

  // Behaviour 3: 401 → sama seperti 400 (modal tetap terbuka, lock dilepas).
  it('401: sesi login habis → modal tetap terbuka, lock dilepas sehingga retry mengirim POST baru', async () => {
    let attempt = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === ITEMS_URL && init?.method === 'POST') {
        attempt += 1;
        if (attempt === 1) return Promise.resolve(new Response('{}', { status: 401 }));
        return Promise.resolve(
          new Response(
            JSON.stringify({
              transaction: txResponse(mkRow()),
              items: [{ id: 'item-ayam', sort_order: 0 }],
            }),
            { status: 201 },
          ),
        );
      }
      if (url === '/api/print/send') {
        return Promise.resolve(new Response('{}', { status: 201 }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const errorSpy = vi.spyOn(toast, 'error');
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <MonitorAddItemModal
        row={mkRow()}
        menus={menus}
        printerSettings={DEFAULT_PRINTER_SETTINGS}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    await tapMenu(user, /ayam goreng/i);
    await user.click(confirmButton());

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        'Sesi login habis',
        expect.objectContaining({ description: expect.stringMatching(/login ulang/i) }),
      );
    });
    expect(onSaved).not.toHaveBeenCalled();

    await user.click(confirmButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const posts = fetchMock.mock.calls.filter(
      (c) => String(c[0]) === ITEMS_URL && (c[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(posts).toHaveLength(2);
  });

  // Behaviour 4a: server balikin baris tidak berurutan — harus disortir dulu
  // via sort_order sebelum dipasangkan ke draft, bukan dipasangkan mentah
  // sesuai urutan array response.
  it('memasangkan id hasil insert berdasarkan sort_order, bukan urutan array response', async () => {
    const fetchMock = mockFetch({
      itemsBody: {
        transaction: txResponse(mkRow()),
        // Sengaja dibalik: tempe (sort_order 1) duluan di array, ayam
        // (sort_order 0) belakangan.
        items: [
          { id: 'id-tempe', sort_order: 1 },
          { id: 'id-ayam', sort_order: 0 },
        ],
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <MonitorAddItemModal
        row={mkRow()}
        menus={menus}
        printerSettings={DEFAULT_PRINTER_SETTINGS}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    // Draft dikirim dalam urutan: Ayam Goreng dulu, lalu Tempe Goreng.
    await tapMenu(user, /ayam goreng/i);
    await tapMenu(user, /tempe goreng/i);
    await user.click(confirmButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));

    const printCalls = fetchMock.mock.calls.filter((c) => String(c[0]) === '/api/print/send');
    // Assert dulu sebelum indexing — kalau print call ternyata tidak pernah
    // terkirim (regresi masa depan), tes gagal dengan pesan yang jelas,
    // bukan "Cannot read properties of undefined".
    expect(printCalls).toHaveLength(1);
    const body = JSON.parse((printCalls[0][1] as RequestInit).body as string) as {
      item_ids: string[];
    };
    // Draft Ayam (dikirim pertama) harus dapat id-ayam (sort_order 0), draft
    // Tempe (dikirim kedua) dapat id-tempe (sort_order 1) — sesuai urutan
    // pengiriman, BUKAN urutan array response yang dibalik.
    expect(body.item_ids).toEqual(['id-ayam', 'id-tempe']);
  });

  // Behaviour 4b: response lebih pendek dari draft — warning + hanya id asli
  // yang dipasangkan, tidak ada id fabrikasi.
  it('response lebih pendek dari draft: warning tampil, cuma id asli yang dikirim ke print job', async () => {
    const fetchMock = mockFetch({
      itemsBody: {
        transaction: txResponse(mkRow()),
        // Dua draft dikirim, server cuma balikin satu baris.
        items: [{ id: 'id-ayam-only', sort_order: 0 }],
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const warnSpy = vi.spyOn(toast, 'warning');
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <MonitorAddItemModal
        row={mkRow()}
        menus={menus}
        printerSettings={DEFAULT_PRINTER_SETTINGS}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    await tapMenu(user, /ayam goreng/i);
    await tapMenu(user, /tempe goreng/i);
    await user.click(confirmButton());

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/jumlah item yang tersimpan tidak sesuai/i),
        expect.anything(),
      );
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));

    const printCalls = fetchMock.mock.calls.filter((c) => String(c[0]) === '/api/print/send');
    expect(printCalls).toHaveLength(1);
    const body = JSON.parse((printCalls[0][1] as RequestInit).body as string) as {
      item_ids: string[];
    };
    // Persis satu id — id asli dari server, bukan dua (draft) dan bukan id
    // fabrikasi buat baris yang tidak pernah di-insert.
    expect(body.item_ids).toEqual(['id-ayam-only']);
  });

  // Behaviour 5a: semua print job sukses.
  it('semua print job sukses: satu toast sukses menyebut jumlah item & job', async () => {
    const fetchMock = mockFetch({
      itemsBody: {
        transaction: txResponse(mkRow()),
        items: [{ id: 'item-ayam', sort_order: 0 }],
      },
      printStatus: 201,
    });
    vi.stubGlobal('fetch', fetchMock);
    const successSpy = vi.spyOn(toast, 'success');
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <MonitorAddItemModal
        row={mkRow()}
        menus={menus}
        printerSettings={DEFAULT_PRINTER_SETTINGS}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    await tapMenu(user, /ayam goreng/i);
    await user.click(confirmButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(successSpy).toHaveBeenCalledWith('1 item ditambahkan, 1 print job dikirim');
  });

  // Behaviour 5b: agent printer offline (503).
  it('agent printer offline: toast sukses (item tersimpan) + toast warning offline terpisah', async () => {
    const fetchMock = mockFetch({
      itemsBody: {
        transaction: txResponse(mkRow()),
        items: [{ id: 'item-ayam', sort_order: 0 }],
      },
      printStatus: 503,
    });
    vi.stubGlobal('fetch', fetchMock);
    const successSpy = vi.spyOn(toast, 'success');
    const warnSpy = vi.spyOn(toast, 'warning');
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <MonitorAddItemModal
        row={mkRow()}
        menus={menus}
        printerSettings={DEFAULT_PRINTER_SETTINGS}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    await tapMenu(user, /ayam goreng/i);
    await user.click(confirmButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(successSpy).toHaveBeenCalledWith('1 item ditambahkan');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/agent printer offline/i),
      expect.anything(),
    );
  });

  // Behaviour 5c: kegagalan kirim print biasa (bukan offline).
  it('kegagalan kirim print biasa: toast sukses (item tersimpan) + toast error sebut target yang gagal', async () => {
    const fetchMock = mockFetch({
      itemsBody: {
        transaction: txResponse(mkRow()),
        items: [{ id: 'item-ayam', sort_order: 0 }],
      },
      printStatus: 500,
    });
    vi.stubGlobal('fetch', fetchMock);
    const successSpy = vi.spyOn(toast, 'success');
    const errorSpy = vi.spyOn(toast, 'error');
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <MonitorAddItemModal
        row={mkRow()}
        menus={menus}
        printerSettings={DEFAULT_PRINTER_SETTINGS}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    await tapMenu(user, /ayam goreng/i);
    await user.click(confirmButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(successSpy).toHaveBeenCalledWith('1 item ditambahkan');
    expect(errorSpy).toHaveBeenCalledWith('Gagal kirim print: dapur');
  });

  // Behaviour 6, jalur generik: non-2xx yang bukan 404/409/400/401 — lewat
  // `res.json().catch(() => ({}))` + `data.error ?? 'save-failed'`. Tes lain
  // di atas cuma menjangkau catch via network rejection (fetch reject), jadi
  // ekstraksi pesan dari body 500 nyata belum pernah tereksekusi.
  it('500 dari server: toast retry pakai pesan dari body error, lock dilepas sehingga retry mengirim POST baru', async () => {
    let attempt = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === ITEMS_URL && init?.method === 'POST') {
        attempt += 1;
        if (attempt === 1) {
          return Promise.resolve(new Response(JSON.stringify({ error: 'boom' }), { status: 500 }));
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              transaction: txResponse(mkRow()),
              items: [{ id: 'item-ayam', sort_order: 0 }],
            }),
            { status: 201 },
          ),
        );
      }
      if (url === '/api/print/send') {
        return Promise.resolve(new Response('{}', { status: 201 }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const errorSpy = vi.spyOn(toast, 'error');
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <MonitorAddItemModal
        row={mkRow()}
        menus={menus}
        printerSettings={DEFAULT_PRINTER_SETTINGS}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    await tapMenu(user, /ayam goreng/i);
    await user.click(confirmButton());

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith('Gagal menambah item', { description: 'boom' });
    });
    expect(onSaved).not.toHaveBeenCalled();

    // Lock dilepas: klik Simpan lagi benar-benar mengirim POST kedua.
    await user.click(confirmButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const posts = fetchMock.mock.calls.filter(
      (c) => String(c[0]) === ITEMS_URL && (c[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(posts).toHaveLength(2);
  });

  // Behaviour di luar 6 asli: routing print dua target. Kedua fixture menu
  // dipakai di seluruh file ini ber-kategori "makanan" → split.minuman selalu
  // kosong dan blok dispatch minuman (lines ~145-152 di produksi) tidak
  // pernah tereksekusi oleh tes manapun sampai sekarang.
  it('item campuran makanan + minuman: dua print job terpisah dengan item_ids disjoint', async () => {
    const fetchMock = mockFetch({
      itemsBody: {
        transaction: txResponse(mkRow()),
        items: [
          { id: 'id-ayam', sort_order: 0 },
          { id: 'id-es-teh', sort_order: 1 },
        ],
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const successSpy = vi.spyOn(toast, 'success');
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <MonitorAddItemModal
        row={mkRow()}
        menus={menus}
        printerSettings={DEFAULT_PRINTER_SETTINGS}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    await tapMenu(user, /ayam goreng/i);
    await user.click(screen.getByRole('button', { name: /minuman/i }));
    await tapMenu(user, /es teh/i);
    await user.click(confirmButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));

    const printCalls = fetchMock.mock.calls.filter((c) => String(c[0]) === '/api/print/send');
    expect(printCalls).toHaveLength(2);

    const bodies = printCalls.map(
      (c) =>
        JSON.parse((c[1] as RequestInit).body as string) as {
          target: string;
          item_ids: string[];
        },
    );
    const dapurBody = bodies.find((b) => b.target === 'dapur');
    const minumanBody = bodies.find((b) => b.target === 'minuman');
    expect(dapurBody).toBeDefined();
    expect(minumanBody).toBeDefined();
    expect(dapurBody?.item_ids).toEqual(['id-ayam']);
    expect(minumanBody?.item_ids).toEqual(['id-es-teh']);
    // Disjoint — id minuman tidak boleh nyempil di job dapur dan sebaliknya.
    expect(dapurBody?.item_ids.some((id) => minumanBody?.item_ids.includes(id))).toBe(false);

    expect(successSpy).toHaveBeenCalledWith('2 item ditambahkan, 2 print job dikirim');
  });
});
