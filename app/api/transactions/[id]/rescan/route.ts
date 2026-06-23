import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { scanNota } from '@/lib/gemini';
import { newEvent, tagStatus } from '@/lib/logger';
import { detectThousandsMissing } from '@/lib/total-parser';
import type { MenuRef } from '@/lib/prompts';

const STORAGE_BUCKET = 'notas';
const NOT_FOUND_CODE = 'PGRST116';

/**
 * Re-OCR an existing pending transaction using its stored scan image.
 * Uses Pro-only strategy (more careful re-read; skips Flash).
 * Replaces items + header fields (customer_name, table_no, handwritten_total).
 * Refuses on confirmed transactions (those are final).
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const evt = newEvent('POST /api/transactions/[id]/rescan', { tx_id: id });
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const { data: tx, error: txError } = await supabase
      .from('transactions')
      .select('id, status, scan_image_path, rescanned_at')
      .eq('id', id)
      .is('deleted_at', null)
      .single();
    if (txError) {
      if (txError.code === NOT_FOUND_CODE) {
        tagStatus(evt, 404);
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }
      tagStatus(evt, 500);
      evt.error(txError);
      return NextResponse.json({ error: txError.message }, { status: 500 });
    }
    if (tx.status !== 'pending_review') {
      tagStatus(evt, 409);
      evt.set('reject_reason', 'status_not_pending');
      return NextResponse.json({ error: 'status_not_pending' }, { status: 409 });
    }
    if (!tx.scan_image_path) {
      tagStatus(evt, 409);
      evt.set('reject_reason', 'no_scan_image');
      return NextResponse.json({ error: 'no_scan_image' }, { status: 409 });
    }
    if (tx.rescanned_at) {
      tagStatus(evt, 409);
      evt.set('reject_reason', 'already_rescanned').set('rescanned_at', tx.rescanned_at);
      return NextResponse.json(
        { error: 'already_rescanned', rescanned_at: tx.rescanned_at },
        { status: 409 }
      );
    }
    evt.set('storage_path', tx.scan_image_path);

    const { data: imageBlob, error: dlError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(tx.scan_image_path);
    if (dlError || !imageBlob) {
      tagStatus(evt, 500);
      evt.set('reject_reason', 'image_download_failed').error(dlError);
      return NextResponse.json({ error: 'image_download_failed' }, { status: 500 });
    }
    const imageBuffer = await imageBlob.arrayBuffer();
    evt.set('image_bytes', imageBuffer.byteLength);

    const { data: menusData, error: menusError } = await supabase
      .from('menus')
      .select('id, name, category, price')
      .eq('is_active', true)
      .order('category')
      .order('name');
    if (menusError || !menusData) {
      tagStatus(evt, 500);
      evt.set('reject_reason', 'menu_fetch_failed').error(menusError);
      return NextResponse.json({ error: 'menu_fetch_failed' }, { status: 500 });
    }
    const menus: MenuRef[] = menusData;
    evt.set('menus_count', menus.length);

    const base64 = Buffer.from(imageBuffer).toString('base64');
    const { result: ocr, meta: ocrMeta } = await scanNota(
      base64,
      imageBlob.type || 'image/jpeg',
      menus,
      { strategy: 'pro-only' }
    );
    evt.merge({
      ocr_attempts: ocrMeta.attempts,
      ocr_final_model: ocrMeta.final_model,
      ocr_total_failure: ocrMeta.final_model === null,
      ocr_items_raw: ocr.items.length,
      ocr_handwritten_total: ocr.handwritten_total,
      ocr_customer_name: ocr.customer_name,
      ocr_table_no: ocr.table_no,
    });

    if (ocrMeta.final_model === null) {
      tagStatus(evt, 502);
      return NextResponse.json({ error: 'ocr_failed', attempts: ocrMeta.attempts }, { status: 502 });
    }

    const menuByName = new Map(menus.map((m) => [m.name, m]));
    const unknownMenuNames: string[] = [];
    const itemRows = ocr.items
      .map((item, idx) => {
        const menu = menuByName.get(item.menu_name);
        if (!menu) {
          unknownMenuNames.push(item.menu_name);
          return null;
        }
        return {
          transaction_id: id,
          menu_id: menu.id,
          menu_name_snapshot: menu.name,
          unit_price_snapshot: menu.price,
          qty: item.qty,
          notes: item.notes,
          sort_order: idx,
          confidence: item.confidence,
          alternatives: item.alternatives,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (unknownMenuNames.length > 0) {
      evt.set('ocr_unknown_menu_names', unknownMenuNames);
    }
    evt.set('items_resolved', itemRows.length);

    const confidences = ocr.items.map((it) => it.confidence);
    if (confidences.length > 0) {
      const minConf = Math.min(...confidences);
      const meanConf = Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length);
      const lowConfItems = ocr.items.filter((it) => it.confidence < 75).map((it) => it.menu_name);
      evt.merge({
        ocr_conf_min: minConf,
        ocr_conf_mean: meanConf,
        ocr_low_conf_count: lowConfItems.length,
        ocr_low_conf_items: lowConfItems,
      });
    }

    // Replace items: DELETE existing + INSERT new
    const { error: deleteError } = await supabase
      .from('transaction_items')
      .delete()
      .eq('transaction_id', id);
    if (deleteError) {
      tagStatus(evt, 500);
      evt.set('reject_reason', 'items_delete_failed').error(deleteError);
      return NextResponse.json({ error: 'items_delete_failed' }, { status: 500 });
    }

    if (itemRows.length > 0) {
      const { error: itemsError } = await supabase.from('transaction_items').insert(itemRows);
      if (itemsError) {
        tagStatus(evt, 500);
        evt.set('reject_reason', 'items_insert_failed').error(itemsError);
        return NextResponse.json({ error: 'items_insert_failed' }, { status: 500 });
      }
    }

    // Update header fields from new OCR (overwrite — rescan is opt-in by kasir).
    // Also stamp rescanned_at to enforce the 1x-per-tx limit.
    const { error: txUpdateError } = await supabase
      .from('transactions')
      .update({
        handwritten_total: ocr.handwritten_total || null,
        customer_name: ocr.customer_name,
        table_no: ocr.table_no,
        rescanned_at: new Date().toISOString(),
      })
      .eq('id', id)
      .is('deleted_at', null);
    if (txUpdateError) {
      tagStatus(evt, 500);
      evt.set('reject_reason', 'tx_update_failed').error(txUpdateError);
      return NextResponse.json({ error: 'tx_update_failed' }, { status: 500 });
    }

    const computedSum = itemRows.reduce((acc, it) => acc + it.qty * it.unit_price_snapshot, 0);
    const suggestThousands = detectThousandsMissing(ocr.handwritten_total, computedSum);
    evt.merge({ computed_sum: computedSum, suggest_thousands: suggestThousands.suggest });

    tagStatus(evt, 200);
    return NextResponse.json({
      transaction_id: id,
      item_count: itemRows.length,
      handwritten_total: ocr.handwritten_total,
      computed_sum: computedSum,
      suggest_thousands: suggestThousands,
      model: ocrMeta.final_model,
    });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
