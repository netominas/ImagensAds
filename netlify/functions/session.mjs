import {sessionStatus} from '../../lib/auth.mjs';
import {getAuthStore} from '../../lib/store.mjs';
export default async function(request){return sessionStatus(request,await getAuthStore());}
export const config={path:'/api/session'};
