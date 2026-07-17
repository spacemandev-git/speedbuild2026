import { error, fail, redirect } from '@sveltejs/kit';
import { hostAgent } from '$lib/server/upstream';
import type { Actions, PageServerLoad } from './$types';

function participantName(params: { name: string }): string {
  const name = params.name.trim();
  if (!/^[a-z0-9-]+$/.test(name)) throw error(400, 'Invalid participant name');
  return name;
}

function roomNumber(form: FormData): number | null {
  const value = Number(form.get('room'));
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
}

export const load: PageServerLoad = async ({ params }) => {
  const name = participantName(params);
  try {
    return { participant: await hostAgent.participant(name) };
  } catch (cause) {
    throw error(502, cause instanceof Error ? cause.message : String(cause));
  }
};

export const actions: Actions = {
  reveal: async ({ params, request }) => {
    const name = participantName(params);
    const form = await request.formData();
    const room = roomNumber(form);
    if (room === null) return fail(400, { success: false, error: 'Room must be between 1 and 5.' });
    try {
      await hostAgent.reveal(name, room);
      return { success: true, message: `Room ${room} has been revealed to ${name}.` };
    } catch (cause) {
      return fail(502, { success: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
  },

  control: async ({ params, request }) => {
    const name = participantName(params);
    const form = await request.formData();
    const operation = form.get('operation');
    if (operation !== 'suspend' && operation !== 'resume' && operation !== 'reset') {
      return fail(400, { success: false, error: 'Invalid participant operation.' });
    }
    try {
      await hostAgent.control(name, operation);
      return { success: true, message: `${name}: ${operation} instruction accepted.` };
    } catch (cause) {
      return fail(502, { success: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
  },

  remove: async ({ params }) => {
    const name = participantName(params);
    try {
      await hostAgent.remove(name);
    } catch (cause) {
      return fail(502, { success: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
    throw redirect(303, '/participants');
  }
};
