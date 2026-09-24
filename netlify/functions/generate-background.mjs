import {runJob,validate} from '../../lib/generation.mjs';
import {getJobStore,getAuthStore} from '../../lib/store.mjs';
import {requireSession,sameOrigin} from '../../lib/auth.mjs';
export default async function(request) {
  if (request.method !== 'POST') return;
  if (!sameOrigin(request)) return;
  if (await requireSession(request,await getAuthStore())) return;
  if (Number(request.headers.get('content-length')) > 64000) return;
  let input;
  try {input=validate(await request.json());} catch {return;}
  await runJob(input,await getJobStore());
}
