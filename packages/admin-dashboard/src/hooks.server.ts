import { redirect, type Handle } from '@sveltejs/kit';
import { isValidSession } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
  const isLogin = event.url.pathname === '/login';
  const session = event.cookies.get('sb_session');
  event.locals.authenticated = isValidSession(session);

  if (!event.locals.authenticated && !isLogin) {
    throw redirect(303, '/login');
  }

  if (event.locals.authenticated && isLogin) {
    throw redirect(303, '/');
  }

  return resolve(event);
};
