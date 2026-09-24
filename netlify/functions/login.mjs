import {login} from '../../lib/auth.mjs';
import {getAuthStore} from '../../lib/store.mjs';
export default async function(request,context){return login(request,await getAuthStore(),{ip:context.ip});}
export const config={path:'/api/login',rateLimit:{windowLimit:10,windowSize:60,aggregateBy:['ip','domain']}};
