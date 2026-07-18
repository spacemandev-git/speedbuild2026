import { hostAgent } from '$lib/server/upstream';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  try {
    return { participants: await hostAgent.participants(), loadError: null };
  } catch (error) {
    return { participants: [], loadError: error instanceof Error ? error.message : String(error) };
  }
};
