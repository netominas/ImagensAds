import {lookup} from 'node:dns/promises';
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {BlockList,isIP} from 'node:net';
import {AdsError} from './client.mjs';
import {publicURL} from './domain.mjs';
const denied=new BlockList();
for(const [ip,bits]of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])denied.addSubnet(ip,bits,'ipv4');
const global6=new BlockList();global6.addSubnet('2000::',3,'ipv6');
for(const [ip,bits]of [['2001::',32],['2001:db8::',32],['2002::',16]])denied.addSubnet(ip,bits,'ipv6');
export function publicAddress(address){const family=isIP(address);return family===4?!denied.check(address,'ipv4'):family===6&&global6.check(address,'ipv6')&&!denied.check(address,'ipv6');}
export async function readPublicPage(value){
 let current=value;
 for(let i=0;i<5;i++){
  const u=publicURL(current),addresses=await lookup(u.hostname.replace(/^\[|\]$/g,''),{all:true});
  if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new AdsError('A página não possui um endereço público permitido.',{status:400});
  const first=addresses[0];
  const result=await new Promise((resolve,reject)=>{
   const request=(u.protocol==='https:'?httpsRequest:httpRequest)(u,{method:'GET',headers:{'User-Agent':'AKWorkspace/GoogleAds','Accept':'text/html'},lookup:(host,options,callback)=>options.all?callback(null,[first]):callback(null,first.address,first.family)},response=>{
    if([301,302,303,307,308].includes(response.statusCode)){response.resume();resolve({redirect:new URL(response.headers.location||'',u).href});return;}
    if(response.statusCode!==200||!String(response.headers['content-type']).includes('text/html')){response.resume();reject(new AdsError('Não foi possível ler a página. Desmarque a leitura automática e informe um resumo no briefing.',{status:400}));return;}
    let size=0;const chunks=[];
    response.on('data',chunk=>{size+=chunk.length;if(size>600000)response.destroy(new AdsError('Página muito grande; informe um resumo no briefing.',{status:400}));else chunks.push(chunk);});
    response.on('error',reject);response.on('end',()=>resolve({html:Buffer.concat(chunks).toString('utf8')}));
   });
   request.setTimeout(15000,()=>request.destroy(new AdsError('A página não respondeu a tempo; informe um resumo no briefing.',{status:400})));request.on('error',reject);request.end();
  });
  if(result.redirect){current=result.redirect;continue;}
  const text=result.html.replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/\s+/g,' ').trim().slice(0,14000);
  if(text.length<50)throw new AdsError('A página não forneceu texto suficiente. Cole um resumo no briefing.',{status:400});
  return {url:current,text};
 }
 throw new AdsError('A página possui redirecionamentos demais.',{status:400});
}
