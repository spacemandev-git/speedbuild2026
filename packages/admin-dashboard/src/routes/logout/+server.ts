import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ cookies }) => {
  cookies.delete('sb_session', { path: '/' });
  throw redirect(303, '/login');
};
