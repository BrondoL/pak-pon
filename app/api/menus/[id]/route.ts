import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';
import { UpdateMenuSchema } from '../_schemas';

// PostgREST error code returned by `.single()` when zero rows match.
const NOT_FOUND_CODE = 'PGRST116';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const evt = newEvent('PATCH /api/menus/[id]', { menu_id: id });
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const body = await request.json();
    const parsed = UpdateMenuSchema.safeParse(body);
    if (!parsed.success) {
      tagStatus(evt, 400);
      evt.merge({ reject_reason: 'invalid_body', zod_issues: parsed.error.issues });
      return NextResponse.json({ error: 'invalid_body', details: parsed.error.flatten() }, { status: 400 });
    }
    evt.set('patch_fields', Object.keys(parsed.data));

    const { data, error } = await supabase
      .from('menus')
      .update(parsed.data)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === NOT_FOUND_CODE) {
        tagStatus(evt, 404);
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    tagStatus(evt, 200);
    return NextResponse.json({ menu: data });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const evt = newEvent('DELETE /api/menus/[id]', { menu_id: id });
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    // .select().single() forces PostgREST to return the row (or PGRST116 if missing),
    // so we know whether the row actually existed.
    const { error } = await supabase
      .from('menus')
      .update({ is_active: false })
      .eq('id', id)
      .select('id')
      .single();

    if (error) {
      if (error.code === NOT_FOUND_CODE) {
        tagStatus(evt, 404);
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    tagStatus(evt, 200);
    return NextResponse.json({ ok: true });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
