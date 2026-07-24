import { fail } from '@sveltejs/kit';
import { bureauAdmin, bureauPublic, hostAgent } from '$lib/server/upstream';
import type { Actions, PageServerLoad } from './$types';

const ROOM_NAMES = ['Operation', 'Assembly', 'Trust', 'Minesweeper', 'Memory Path'];

function integer(form: FormData, key: string): number | null {
  const value = Number(form.get(key));
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
}

function operativeId(form: FormData): string | null {
  const value = form.get('operativeId');
  return typeof value === 'string' && /^[A-Za-z0-9-]{1,16}$/.test(value) ? value : null;
}

function unlockValue(result: { combo?: string; fragment?: string }): { unlock: string; unlockLabel: 'Code' | 'Fragment' } | null {
  if (typeof result.combo === 'string') return { unlock: result.combo, unlockLabel: 'Code' };
  if (typeof result.fragment === 'string') return { unlock: result.fragment, unlockLabel: 'Fragment' };
  return null;
}

export const load: PageServerLoad = async () => {
  const [state, lockData] = await Promise.all([bureauAdmin.state(), bureauAdmin.locks()]);
  return {
    state,
    locks: lockData.locks,
    lockPool: lockData.pool,
    roomsComplete: state.roomsComplete ?? []
  };
};

export const actions: Actions = {
  configureRoom3: async ({ request }) => {
    const form = await request.formData();
    const operatives = form.getAll('operative').filter((value): value is string => typeof value === 'string');
    const selected = form.getAll('selected').filter((value): value is string => typeof value === 'string');
    const operativePattern = /^[A-Za-z0-9-]{1,16}$/;
    if (operatives.length !== 6 || new Set(operatives).size !== 6 || !operatives.every((value) => operativePattern.test(value))) {
      return fail(400, { success: false, error: 'Room 3 requires exactly six distinct operatives.' });
    }
    if (selected.length !== 2 || new Set(selected).size !== 2 || !selected.every((value) => operatives.includes(value))) {
      return fail(400, { success: false, error: 'Select exactly two of the six Room 3 operatives.' });
    }

    try {
      await bureauPublic.configureRoom3({ participants: operatives, selected });
      return { success: true, message: `Room 3 was configured for ${operatives.length} operatives.` };
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
        result.status === 'rejected' ? [participants[index]?.name ?? `operative ${index + 1}`] : []
      );
      if (failures.length > 0) {
        return fail(502, {
          success: false,
          error: `Room ${room} reveal failed for: ${failures.join(', ')}. Other reveals may have succeeded.`
        });
      }
      return { success: true, message: `Room ${room} — ${ROOM_NAMES[room - 1]} was revealed to ${participants.length} operatives.` };
    } catch (cause) {
      return fail(502, { success: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
  },

  override: async ({ request }) => {
    const form = await request.formData();
    const room = integer(form, 'room');
    const operative = operativeId(form);
    if (room === null || operative === null) {
      return fail(400, { success: false, error: 'A valid operative ID and room are required for manual override.' });
    }
    try {
      const result = await bureauAdmin.override(operative, room);
      const unlock = unlockValue(result);
      if (!result.ok || unlock === null) {
        return fail(502, { success: false, error: 'The manual override did not return a valid unlock value.' });
      }
      return {
        success: true,
        action: 'override',
        operativeId: operative,
        room,
        message: `Manual override granted to ${operative} for Room ${room} — ${ROOM_NAMES[room - 1]}.`,
        ...unlock
      };
    } catch (cause) {
      return fail(502, { success: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
  },

  forceComplete: async ({ request }) => {
    const form = await request.formData();
    const room = integer(form, 'room');
    const operative = operativeId(form);
    if (room === null || operative === null) {
      return fail(400, { success: false, error: 'A valid operative ID and room are required to force completion.' });
    }
    try {
      const result = await bureauAdmin.forceComplete(operative, room);
      const unlock = unlockValue(result);
      if (!result.ok || unlock === null) {
        return fail(502, { success: false, error: 'Force completion did not return a valid unlock value.' });
      }
      return {
        success: true,
        action: 'forceComplete',
        operativeId: operative,
        room,
        message: `Completion recorded for ${operative} in Room ${room} — ${ROOM_NAMES[room - 1]}.`,
        ...unlock
      };
    } catch (cause) {
      return fail(502, { success: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
  },

  roomComplete: async ({ request }) => {
    const form = await request.formData();
    const room = integer(form, 'room');
    if (room === null) {
      return fail(400, { success: false, error: 'A room between 1 and 5 is required.' });
    }
    try {
      const result = await bureauAdmin.completeRoom(room);
      if (!result.ok) {
        return fail(502, { success: false, error: `Room ${room} completion was not accepted.` });
      }
      return {
        success: true,
        action: 'roomComplete',
        room,
        message: `Room ${room} — ${ROOM_NAMES[room - 1]} marked complete.`
      };
    } catch (cause) {
      return fail(502, { success: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
  }
};
