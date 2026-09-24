import {logout} from '../../lib/auth.mjs';
import {getAuthStore} from '../../lib/store.mjs';
export default async function(request){return logout(request,await getAuthStore());}
export const config={path:'/api/logout'};
