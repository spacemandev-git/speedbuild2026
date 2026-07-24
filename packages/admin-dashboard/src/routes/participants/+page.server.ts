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
      return { success: true, message: `${participant.name} was provisioned.` };
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
      return { success: true, message: `${name} was removed.` };
    } catch (error) {
      return fail(502, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  resetAll: async () => {
    try {
      const participants = await hostAgent.participants();
      if (participants.length === 0) return { success: true, message: 'No operatives to reset.' };

      const results = await Promise.allSettled(participants.map((p) => hostAgent.control(p.name, 'reset')));
      const failures = results.flatMap((result, index) =>
        result.status === 'rejected' ? [participants[index]?.name ?? `operative ${index + 1}`] : []
      );
      if (failures.length > 0) {
        return fail(502, {
          success: false,
          error: `Reset failed for: ${failures.join(', ')}. Other resets may have succeeded.`
        });
      }
      return { success: true, message: `Reset instruction accepted for ${participants.length} operatives.` };
    } catch (error) {
      return fail(502, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  removeAll: async () => {
    try {
      const participants = await hostAgent.participants();
      if (participants.length === 0) return { success: true, message: 'No operatives to delete.' };

      const results = await Promise.allSettled(participants.map((p) => hostAgent.remove(p.name)));
      const failures = results.flatMap((result, index) =>
        result.status === 'rejected' ? [participants[index]?.name ?? `operative ${index + 1}`] : []
      );
      if (failures.length > 0) {
        return fail(502, {
          success: false,
          error: `Delete failed for: ${failures.join(', ')}. Other deletions may have succeeded.`
        });
      }
      return { success: true, message: `Removed ${participants.length} operatives.` };
    } catch (error) {
      return fail(502, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
};
