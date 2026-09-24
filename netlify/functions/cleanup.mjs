import {getJobStore,getAuthStore} from '../../lib/store.mjs';
export default async function() {
  const store=await getJobStore();
  for await (const page of store.list({paginate:true})) {
    for(const blob of page.blobs) {
      if(!blob.key.endsWith('/job')) continue;
      const state=await store.get(blob.key,{type:'json'});
      if(state && Date.now()-state.created>86400000) {
        const prefix=blob.key.slice(0,-3);
        for(let i=0;i<4;i++) await store.delete(`${prefix}image-${i}`);
        await store.delete(blob.key);
      }
    }
  }
  const auth=await getAuthStore();
  for await(const page of auth.list({paginate:true})){
    for(const blob of page.blobs){
      const record=await auth.get(blob.key,{type:'json'});
      if(record?.expires<=Date.now())await auth.delete(blob.key);
    }
  }
}
export const config={schedule:'0 3 * * *'};
