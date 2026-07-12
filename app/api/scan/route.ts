import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getSupabaseServer } from '@/lib/supabase/server';
import { scanNota, type ScanMeta } from '@/lib/gemini';
import { newEvent, tagStatus } from '@/lib/logger';
import { recordUsageDaily } from '@/lib/ai-usage';
import type { MenuRef } from '@/lib/prompts';
import { detectThousandsMissing } from '@/lib/total-parser';

const STORAGE_BUCKET = 'notas';

export async function POST(request: NextRequest) {
  const evt = newEvent('POST /api/scan');
  const requestStartedAt = new Date();
  let ocrMeta: ScanMeta | undefined;
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const formData = await request.formData();
    const image = formData.get('image');
    if (!(image instanceof File)) {
      tagStatus(evt, 400);
      evt.set('reject_reason', 'image_missing');
      return NextResponse.json({ error: 'image_missing' }, { status: 400 });
    }
    evt.merge({
      image_name: image.name,
      image_type: image.type,
      image_bytes: image.size,
    });
    if (!image.type.startsWith('image/')) {
      tagStatus(evt, 400);
      evt.set('reject_reason', 'not_an_image');
      return NextResponse.json({ error: 'not_an_image' }, { status: 400 });
    }
    if (image.size === 0) {
      tagStatus(evt, 400);
      evt.set('reject_reason', 'image_empty');
      return NextResponse.json({ error: 'image_empty' }, { status: 400 });
    }

    const transactionId = randomUUID();
    const now = new Date();
    const yyyymm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const storagePath = `${yyyymm}/${transactionId}.jpg`;
    evt.merge({ tx_id: transactionId, storage_path: storagePath });

    const imageBuffer = await image.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, imageBuffer, {
        contentType: 'image/jpeg',
        upsert: false,
      });
    if (uploadError) {
      tagStatus(evt, 500);
      evt.set('reject_reason', 'upload_failed').error(uploadError);
      return NextResponse.json({ error: 'upload_failed', details: uploadError.message }, { status: 500 });
    }

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
    const { result: ocr, meta } = await scanNota(base64, 'image/jpeg', menus);
    ocrMeta = meta;
    // Anomaly = attempt yang finish bukan STOP (MAX_TOKENS runaway, SAFETY, dst).
    // Filter di Vercel Log Search: `ocr_anomaly:true`. Cross-check dengan
    // ai_usage_daily kalau counter mismatch AI Studio (ai-usage.ts sengaja skip
    // insert kalau tokens 0 supaya mismatch = signal ada fail).
    const anomalyReasons = ocrMeta.attempts
      .map((a) => a.finish_reason)
      .filter((r): r is string => !!r && r !== 'STOP');
    evt.merge({
      ocr_attempts: ocrMeta.attempts,
      ocr_final_model: ocrMeta.final_model,
      ocr_fell_back: ocrMeta.fell_back,
      ocr_total_failure: ocrMeta.final_model === null,
      ocr_anomaly: anomalyReasons.length > 0,
      ocr_anomaly_reasons: anomalyReasons.length > 0 ? anomalyReasons : undefined,
      ocr_items_raw: ocr.items.length,
      ocr_handwritten_total: ocr.handwritten_total,
      ocr_customer_name: ocr.customer_name,
      ocr_table_no: ocr.table_no,
    });

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
          transaction_id: transactionId,
          menu_id: menu.id,
          menu_name_snapshot: menu.name,
          unit_price_snapshot: menu.price,
          qty: item.qty,
          notes: item.notes,
          sort_order: idx,
          confidence: item.confidence ?? null,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (unknownMenuNames.length > 0) {
      evt.set('ocr_unknown_menu_names', unknownMenuNames);
    }
    evt.set('items_resolved', itemRows.length);

    const confidences = ocr.items
      .map((it) => it.confidence)
      .filter((c): c is number => typeof c === 'number');
    if (confidences.length > 0) {
      const minConf = Math.min(...confidences);
      const meanConf = Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length);
      const lowConfItems = ocr.items
        .filter((it) => typeof it.confidence === 'number' && it.confidence < 75)
        .map((it) => it.menu_name);
      evt.merge({
        ocr_conf_min: minConf,
        ocr_conf_mean: meanConf,
        ocr_low_conf_count: lowConfItems.length,
        ocr_low_conf_items: lowConfItems,
      });
    }

    const { error: txError } = await supabase.from('transactions').insert({
      id: transactionId,
      scan_image_path: storagePath,
      handwritten_total: ocr.handwritten_total || null,
      status: 'pending_review',
      customer_name: ocr.customer_name,
      table_no: ocr.table_no,
    });
    if (txError) {
      tagStatus(evt, 500);
      evt.set('reject_reason', 'tx_insert_failed').error(txError);
      return NextResponse.json({ error: 'tx_insert_failed', details: txError.message }, { status: 500 });
    }

    let itemsInsertOk = true;
    if (itemRows.length > 0) {
      const { error: itemsError } = await supabase.from('transaction_items').insert(itemRows);
      if (itemsError) {
        itemsInsertOk = false;
        evt.set('reject_reason', 'items_insert_failed').error(itemsError);
      }
    }
    evt.set('items_inserted_ok', itemsInsertOk);

    const computedSum = itemRows.reduce((acc, it) => acc + it.qty * it.unit_price_snapshot, 0);
    const mismatch = !!ocr.handwritten_total && computedSum !== ocr.handwritten_total;
    const suggestThousands = detectThousandsMissing(ocr.handwritten_total, computedSum);
    evt.merge({
      computed_sum: computedSum,
      mismatch,
      suggest_thousands: suggestThousands.suggest,
    });

    if (!itemsInsertOk) {
      tagStatus(evt, 207);
      return NextResponse.json(
        { transaction_id: transactionId, partial_error: 'items_insert_failed' },
        { status: 207 }
      );
    }
    tagStatus(evt, 201);
    return NextResponse.json(
      {
        transaction_id: transactionId,
        item_count: itemRows.length,
        handwritten_total: ocr.handwritten_total,
        computed_sum: computedSum,
        mismatch,
        suggest_thousands: suggestThousands,
        ocr_total_failure: ocrMeta.final_model === null,
      },
      { status: 201 }
    );
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
    if (ocrMeta) {
      await recordUsageDaily({
        attempts: ocrMeta.attempts,
        failed: ocrMeta.final_model === null,
        requestStartedAt,
      });
    }
  }
}
