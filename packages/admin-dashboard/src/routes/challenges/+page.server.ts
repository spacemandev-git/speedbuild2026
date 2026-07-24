import { fail } from '@sveltejs/kit';
import { executorAdmin, executorPublic, hostAgent } from '$lib/server/upstream';
import type { Actions, PageServerLoad } from './$types';

function integer(form: FormData, key: string): number | null {
  const value = Number(form.get(key));
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
}

export const load: PageServerLoad = async () => ({ state: await executorAdmin.state() });

export const actions: Actions = {
  beginSeance: async ({ request }) => {
    const form = await request.formData();
    const participants = form.getAll('participant').filter((v): v is string => typeof v === 'string');
    const bought = form.getAll('bought').filter((v): v is string => typeof v === 'string');
    const claimPattern = /^[A-Za-z0-9-]{1,64}$/;
    if (participants.length !== 6 || new Set(participants).size !== 6 || !participants.every((c) => claimPattern.test(c))) {
      return fail(400, { success: false, error: 'The séance requires exactly six distinct claimants.' });
    }
    if (bought.length !== 2 || new Set(bought).size !== 2 || !bought.every((c) => participants.includes(c))) {
      return fail(400, { success: false, error: 'Mark exactly two bought claimants, both among the six participants.' });
    }

    try {
      await executorPublic.beginSeance({ participants, bought });
      return { success: true, message: `The séance has begun for ${participants.length} claimants (${bought.length} bought).` };
    } catch (cause) {
      return fail(502, { success: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
  },

  revealAll: async ({ request }) => {
    const form = await request.formData();
    const room = integer(form, 'room');
    if (room === null) return fail(400, { success: false, error: 'Room must be between 1 and 5.' });

    try {
      const participants = await hostAgent.participants();
      const results = await Promise.allSettled(participants.map((participant) => hostAgent.reveal(participant.name, room)));
      const failures = results.flatMap((result, index) =>
        result.status === 'rejected' ? [participants[index]?.name ?? `claimant ${index + 1}`] : []
      );
      if (failures.length > 0) {
        return fail(502, {
          success: false,
          error: `Room ${room} reveal failed for: ${failures.join(', ')}. Other reveals may have succeeded.`
        });
      }
      return { success: true, message: `Room ${room} has been revealed to ${participants.length} claimants.` };
    } catch (cause) {
      return fail(502, { success: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
  },

  mercy: async ({ request }) => {
    const form = await request.formData();
    const room = integer(form, 'room');
    const claimNumber = form.get('claimNumber');
    if (room === null || typeof claimNumber !== 'string' || !claimNumber.trim()) {
      return fail(400, { success: false, error: 'A claimant and room are required for mercy.' });
    }
    try {
      const result = await executorAdmin.mercy(claimNumber, room);
      const unlock = result.combo ?? result.fragment;
      return {
        success: true,
        message: `The executor has granted mercy to ${claimNumber} in room ${room}.${unlock ? ` Unlock: ${unlock}` : ''}`
      };
    } catch (cause) {
      return fail(502, { success: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
  }
};
