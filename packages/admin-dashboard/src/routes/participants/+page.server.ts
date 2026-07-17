import { fail } from '@sveltejs/kit';
import { hostAgent } from '$lib/server/upstream';
import type { Actions, PageServerLoad } from './$types';

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export const load: PageServerLoad = async () => ({ participants: await hostAgent.participants() });

export const actions: Actions = {
  provision: async ({ request }) => {
    const form = await request.formData();
    const requestedName = text(form, 'name');
    try {
      const participant = await hostAgent.provision(requestedName || undefined);
      return { success: true, message: `${participant.name} has entered probate.` };
    } catch (error) {
      return fail(502, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  control: async ({ request }) => {
    const form = await request.formData();
    const name = text(form, 'name');
    const operation = text(form, 'operation');
    if (!name || !['suspend', 'resume', 'reset'].includes(operation)) {
      return fail(400, { success: false, error: 'Invalid participant operation.' });
    }

    try {
      await hostAgent.control(name, operation as 'suspend' | 'resume' | 'reset');
      return { success: true, message: `${name}: ${operation} instruction accepted.` };
    } catch (error) {
      return fail(502, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  remove: async ({ request }) => {
    const form = await request.formData();
    const name = text(form, 'name');
    if (!name) return fail(400, { success: false, error: 'Participant name is required.' });

    try {
      await hostAgent.remove(name);
      return { success: true, message: `${name} has been removed from the estate.` };
    } catch (error) {
      return fail(502, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
};
