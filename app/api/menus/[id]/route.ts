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
    const { chips, ...menuFields } = parsed.data;
    evt.merge({
      patch_fields: Object.keys(menuFields),
      patch_chips_present: chips !== undefined,
      patch_chip_count: chips?.length ?? null,
    });

    if (Object.keys(menuFields).length > 0) {
      const { error } = await supabase
        .from('menus')
        .update(menuFields)
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
    }

    if (chips !== undefined) {
      // DELETE all + INSERT fresh. Snapshot di transaction_items.applied_chips
      // aman karena freeze at save. Simpler than diff.
      const { error: delError } = await supabase
        .from('menu_chips')
        .delete()
        .eq('menu_id', id);
      if (delError) {
        tagStatus(evt, 500);
        evt.error(delError);
        return NextResponse.json({ error: delError.message }, { status: 500 });
      }

      if (chips.length > 0) {
        const chipRows = chips.map((c, idx) => ({
          menu_id: id,
          label: c.label,
          price_delta: c.price_delta,
          mutex_group: c.mutex_group,
          sort_order: c.sort_order ?? idx,
        }));
        const { error: insError } = await supabase.from('menu_chips').insert(chipRows);
        if (insError) {
          tagStatus(evt, 500);
          evt.error(insError);
          return NextResponse.json({ error: insError.message }, { status: 500 });
        }
      }
    }

    // Return final state with chips joined.
    const { data: finalMenu } = await supabase
      .from('menus')
      .select(`
        id, name, category, price, sort_order, is_active, created_at, updated_at,
        chips:menu_chips(id, label, price_delta, mutex_group, sort_order)
      `)
      .eq('id', id)
      .single();

    tagStatus(evt, 200);
    return NextResponse.json({ menu: finalMenu });
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
