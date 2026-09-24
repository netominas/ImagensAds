export async function getJobStore() {
  const {getStore} = await import('@netlify/blobs');
  return getStore({name:'adstudio-jobs',consistency:'strong'});
}
export const json = (data,status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export function validToken(value) {return typeof value==='string' && /^[a-f0-9]{64}$/.test(value);}
