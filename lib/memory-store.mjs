export function memoryStore(){
  const entries=new Map();
  return {
    async get(key,{type}={}){const item=entries.get(key);if(item===undefined)return null;if(type==='json')return JSON.parse(item);if(type==='arrayBuffer')return new Uint8Array(item).buffer;return item;},
    async set(key,value,{onlyIfNew}={}){if(onlyIfNew&&entries.has(key))return {modified:false};entries.set(key,value);return {modified:true};},
    async setJSON(key,value,options){return this.set(key,JSON.stringify(value),options);},
    async delete(key){entries.delete(key);}
  };
}
