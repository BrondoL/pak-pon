import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getSupabaseServer } from '@/lib/supabase/server';
import { scanNota } from '@/lib/gemini';
import type { MenuRef, ScanResult } from '@/lib/prompts';

const STORAGE_BUCKET = 'notas';

export async function POST(request: NextRequest) {
  const t0 = Date.now();
  console.log(`[scan] POST /api/scan received`);

  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    console.warn(`[scan] ✗ unauthorized`);
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  console.log(`[scan] user=${user.id}`);

  const formData = await request.formData();
  const image = formData.get('image');
  if (!(image instanceof File)) {
    console.warn(`[scan] ✗ image_missing — form field "image" not a File`);
    return NextResponse.json({ error: 'image_missing' }, { status: 400 });
  }
  if (!image.type.startsWith('image/')) {
    console.warn(`[scan] ✗ not_an_image — type=${image.type}`);
    return NextResponse.json({ error: 'not_an_image' }, { status: 400 });
  }
  if (image.size === 0) {
    console.warn(`[scan] ✗ image_empty`);
    return NextResponse.json({ error: 'image_empty' }, { status: 400 });
  }
  console.log(`[scan] image: name="${image.name}", type=${image.type}, size=${image.size}B`);

  const transactionId = randomUUID();
  const now = new Date();
  const yyyymm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const storagePath = `${yyyymm}/${transactionId}.jpg`;
  console.log(`[scan] tx_id=${transactionId}, storage path=${storagePath}`);

  const imageBuffer = await image.arrayBuffer();
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, imageBuffer, {
      contentType: 'image/jpeg',
      upsert: false,
    });
  if (uploadError) {
    console.error(`[scan] ✗ upload_failed:`, uploadError);
    return NextResponse.json({ error: 'upload_failed', details: uploadError.message }, { status: 500 });
  }
  console.log(`[scan] ✓ uploaded to storage`);

  const { data: menusData, error: menusError } = await supabase
    .from('menus')
    .select('id, name, category, price')
    .eq('is_active', true)
    .order('category')
    .order('name');
  if (menusError || !menusData) {
    console.error(`[scan] ✗ menu_fetch_failed:`, menusError);
    return NextResponse.json({ error: 'menu_fetch_failed' }, { status: 500 });
  }
  const menus: MenuRef[] = menusData;
  console.log(`[scan] fetched ${menus.length} active menus: ${menus.map((m) => m.name).join(', ')}`);

  let ocr: ScanResult;
  let ocrError: string | null = null;
  try {
    const base64 = Buffer.from(imageBuffer).toString('base64');
    ocr = await scanNota(base64, 'image/jpeg', menus);
    console.log(`[scan] ✓ OCR result: items=${ocr.items.length}, handwritten_total=${ocr.handwritten_total}, customer=${ocr.customer_name}, table=${ocr.table_no}`);
  } catch (err) {
    ocrError = err instanceof Error ? err.message : 'unknown';
    console.error(`[scan] ✗ OCR threw — falling back to empty draft. error=${ocrError}`);
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
      if (!menu) {
        console.warn(`[scan] ⚠ OCR returned unknown menu_name="${item.menu_name}" — skipped`);
        return null;
      }
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
  console.log(`[scan] resolved ${itemRows.length} item rows from ${ocr.items.length} OCR items`);

  const { error: txError } = await supabase.from('transactions').insert({
    id: transactionId,
    scan_image_path: storagePath,
    handwritten_total: ocr.handwritten_total || null,
    status: 'pending_review',
    customer_name: ocr.customer_name,
    table_no: ocr.table_no,
  });
  if (txError) {
    console.error(`[scan] ✗ tx_insert_failed:`, txError);
    return NextResponse.json({ error: 'tx_insert_failed', details: txError.message }, { status: 500 });
  }
  console.log(`[scan] ✓ tx inserted`);

  if (itemRows.length > 0) {
    const { error: itemsError } = await supabase.from('transaction_items').insert(itemRows);
    if (itemsError) {
      console.error(`[scan] ✗ items_insert_failed (tx already in DB):`, itemsError);
      return NextResponse.json(
        { transaction_id: transactionId, partial_error: 'items_insert_failed' },
        { status: 207 }
      );
    }
    console.log(`[scan] ✓ ${itemRows.length} items inserted`);
  }

  const computedSum = itemRows.reduce((acc, it) => acc + it.qty * it.unit_price_snapshot, 0);
  const mismatch = !!ocr.handwritten_total && computedSum !== ocr.handwritten_total;
  const dt = Date.now() - t0;
  console.log(`[scan] DONE in ${dt}ms — tx=${transactionId}, items=${itemRows.length}, computed=${computedSum}, handwritten=${ocr.handwritten_total}, mismatch=${mismatch}, ocrError=${ocrError ?? 'none'}`);
  return NextResponse.json(
    {
      transaction_id: transactionId,
      item_count: itemRows.length,
      handwritten_total: ocr.handwritten_total,
      computed_sum: computedSum,
      mismatch,
      ocr_error: ocrError,
    },
    { status: 201 }
  );
}
