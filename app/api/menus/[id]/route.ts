import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { UpdateMenuSchema } from '../_schemas';

// PostgREST error code returned by `.single()` when zero rows match.
const NOT_FOUND_CODE = 'PGRST116';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json();
  const parsed = UpdateMenuSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', details: parsed.error.flatten() }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('menus')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    if (error.code === NOT_FOUND_CODE) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ menu: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

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
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
