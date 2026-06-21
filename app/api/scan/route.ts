import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getSupabaseServer } from '@/lib/supabase/server';
import { scanNota } from '@/lib/gemini';
import type { MenuRef, ScanResult } from '@/lib/prompts';

const STORAGE_BUCKET = 'notas';

export async function POST(request: NextRequest) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const formData = await request.formData();
  const image = formData.get('image');
  if (!(image instanceof File)) {
    return NextResponse.json({ error: 'image_missing' }, { status: 400 });
  }
  if (!image.type.startsWith('image/')) {
    return NextResponse.json({ error: 'not_an_image' }, { status: 400 });
  }
  if (image.size === 0) {
    return NextResponse.json({ error: 'image_empty' }, { status: 400 });
  }

  const transactionId = randomUUID();
  const now = new Date();
  const yyyymm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const storagePath = `${yyyymm}/${transactionId}.jpg`;

  const imageBuffer = await image.arrayBuffer();
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, imageBuffer, {
      contentType: 'image/jpeg',
      upsert: false,
    });
  if (uploadError) {
    return NextResponse.json({ error: 'upload_failed', details: uploadError.message }, { status: 500 });
  }

  const { data: menusData, error: menusError } = await supabase
    .from('menus')
    .select('id, name, category, price')
    .eq('is_active', true)
    .order('category')
    .order('name');
  if (menusError || !menusData) {
    return NextResponse.json({ error: 'menu_fetch_failed' }, { status: 500 });
  }
  const menus: MenuRef[] = menusData;

  let ocr: ScanResult;
  try {
    const base64 = Buffer.from(imageBuffer).toString('base64');
    ocr = await scanNota(base64, 'image/jpeg', menus);
  } catch {
    ocr = {
      items: [],
      handwritten_total: 0,
      customer_name: null,
      table_no: null,
    };
  }

  const menuByName = new Map(menus.map((m) => [m.name, m]));
  const itemRows = ocr.items
    .map((item, idx) => {
      const menu = menuByName.get(item.menu_name);
      if (!menu) return null;
      return {
        transaction_id: transactionId,
        menu_id: menu.id,
        menu_name_snapshot: menu.name,
        unit_price_snapshot: menu.price,
        qty: item.qty,
        notes: item.notes,
        sort_order: idx,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const { error: txError } = await supabase.from('transactions').insert({
    id: transactionId,
    scan_image_path: storagePath,
    handwritten_total: ocr.handwritten_total || null,
    status: 'pending_review',
    customer_name: ocr.customer_name,
    table_no: ocr.table_no,
  });
  if (txError) {
    return NextResponse.json({ error: 'tx_insert_failed', details: txError.message }, { status: 500 });
  }

  if (itemRows.length > 0) {
    const { error: itemsError } = await supabase.from('transaction_items').insert(itemRows);
    if (itemsError) {
      return NextResponse.json(
        { transaction_id: transactionId, partial_error: 'items_insert_failed' },
        { status: 207 }
      );
    }
  }

  const computedSum = itemRows.reduce((acc, it) => acc + it.qty * it.unit_price_snapshot, 0);
  const mismatch = !!ocr.handwritten_total && computedSum !== ocr.handwritten_total;
  return NextResponse.json(
    {
      transaction_id: transactionId,
      item_count: itemRows.length,
      handwritten_total: ocr.handwritten_total,
      computed_sum: computedSum,
      mismatch,
    },
    { status: 201 }
  );
}
