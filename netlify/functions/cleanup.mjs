import {getJobStore} from '../../lib/store.mjs';
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
}
export const config={schedule:'0 3 * * *'};
