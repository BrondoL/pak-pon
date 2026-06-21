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
      .select('id, name, category, price, sort_order, is_active, created_at, updated_at')
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
    evt.set('items_count', data?.length ?? 0);
    tagStatus(evt, 200);
    return NextResponse.json({ items: data ?? [] });
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
    evt.merge({
      menu_name: parsed.data.name,
      menu_category: parsed.data.category,
      menu_price: parsed.data.price,
    });

    const { data, error } = await supabase
      .from('menus')
      .insert(parsed.data)
      .select()
      .single();

    if (error) {
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    evt.set('menu_id', data.id);
    tagStatus(evt, 201);
    return NextResponse.json({ menu: data }, { status: 201 });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
