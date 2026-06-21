import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';

export async function POST(request: NextRequest) {
  const evt = newEvent('POST /api/auth/signout');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) evt.set('user_id', user.id);

    await supabase.auth.signOut();
    tagStatus(evt, 303);
    return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
