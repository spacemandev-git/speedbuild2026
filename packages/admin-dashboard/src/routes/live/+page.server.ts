import { hostAgent } from '$lib/server/upstream';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ participants: await hostAgent.participants() });
