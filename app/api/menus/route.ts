import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';
import { CreateMenuSchema } from './_schemas';

export async function GET(request: NextRequest) {
  const evt = newEvent('GET /api/menus');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const includeInactive = request.nextUrl.searchParams.get('include_inactive') === '1';
    evt.set('include_inactive', includeInactive);

    let query = supabase
      .from('menus')
      .select(`
        id, name, category, price, sort_order, is_active, created_at, updated_at,
        chips:menu_chips(id, label, price_delta, mutex_group, sort_order)
      `)
      .order('category')
      .order('sort_order')
      .order('name');

    if (!includeInactive) query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) {
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Sort chips per menu by sort_order (nested select doesn't guarantee order).
    const items = (data ?? []).map((m) => ({
      ...m,
      chips: [...(m.chips ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    }));

    evt.set('items_count', items.length);
    tagStatus(evt, 200);
    return NextResponse.json({ items });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}

export async function POST(request: NextRequest) {
  const evt = newEvent('POST /api/menus');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const body = await request.json();
    const parsed = CreateMenuSchema.safeParse(body);
    if (!parsed.success) {
      tagStatus(evt, 400);
      evt.merge({ reject_reason: 'invalid_body', zod_issues: parsed.error.issues });
      return NextResponse.json({ error: 'invalid_body', details: parsed.error.flatten() }, { status: 400 });
    }
    const { chips, ...menuFields } = parsed.data;
    evt.merge({
      menu_name: menuFields.name,
      menu_category: menuFields.category,
      menu_price: menuFields.price,
      chip_count: chips.length,
    });

    const { data: created, error } = await supabase
      .from('menus')
      .insert(menuFields)
      .select()
      .single();

    if (error) {
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    evt.set('menu_id', created.id);

    if (chips.length > 0) {
      const chipRows = chips.map((c, idx) => ({
        menu_id: created.id,
        label: c.label,
        price_delta: c.price_delta,
        mutex_group: c.mutex_group,
        sort_order: c.sort_order ?? idx,
      }));
      const { error: chipError } = await supabase.from('menu_chips').insert(chipRows);
      if (chipError) {
        tagStatus(evt, 500);
        evt.error(chipError);
        return NextResponse.json({ error: chipError.message }, { status: 500 });
      }
    }

    tagStatus(evt, 201);
    return NextResponse.json({ menu: { ...created, chips } }, { status: 201 });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
