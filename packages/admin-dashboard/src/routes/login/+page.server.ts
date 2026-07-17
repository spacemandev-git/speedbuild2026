import { fail, redirect } from '@sveltejs/kit';
import { createSessionValue, isValidAdminToken } from '$lib/server/auth';
import type { Actions } from './$types';

export const actions: Actions = {
  default: async ({ request, cookies, url }) => {
    const form = await request.formData();
    const token = form.get('token');

    if (typeof token !== 'string' || !isValidAdminToken(token)) {
      return fail(400, { invalid: true });
    }

    cookies.set('sb_session', createSessionValue(), {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: url.protocol === 'https:',
      maxAge: 60 * 60 * 12
    });

    throw redirect(303, '/');
  }
};
