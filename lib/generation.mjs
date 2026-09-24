import { nearestRatio, providers } from '../public/core.js';
const geminiRatios = {
  '1:1':'ASPECT_RATIO_ONE_BY_ONE','5:4':'ASPECT_RATIO_FIVE_BY_FOUR',
  '4:3':'ASPECT_RATIO_FOUR_BY_THREE','3:2':'ASPECT_RATIO_THREE_BY_TWO',
  '16:9':'ASPECT_RATIO_SIXTEEN_BY_NINE','2:3':'ASPECT_RATIO_TWO_BY_THREE',
  '3:4':'ASPECT_RATIO_THREE_BY_FOUR','4:5':'ASPECT_RATIO_FOUR_BY_FIVE',
  '9:16':'ASPECT_RATIO_NINE_BY_SIXTEEN'
};
export function validate(input) {
  if (!input || typeof input !== 'object') throw new Error('Solicitação inválida.');
  const {provider, apiKey, prompt, model, width, height, count, token} = input;
  if (!Object.hasOwn(providers, provider)) throw new Error('IA inválida.');
  if (typeof apiKey !== 'string' || apiKey.length < 10 || apiKey.length > 1024 || /[\r\n]/.test(apiKey)) throw new Error('Preencha uma chave de API válida em Configurações.');
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 14000) throw new Error('O prompt deve conter entre 1 e 14.000 caracteres.');
  if (typeof model !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(model)) throw new Error('Modelo inválido.');
  if (![width,height].every(v => Number.isInteger(v) && v >= 32 && v <= 4096)) throw new Error('Dimensões permitidas: 32 a 4096 pixels.');
  if (!Number.isInteger(count) || count < 1 || count > 4) throw new Error('Escolha de 1 a 4 imagens.');
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Identificador inválido.');
  return input;
}
export function providerRequest({provider, apiKey, model, prompt, width, height}) {
  const headers = {'Content-Type':'application/json'};
  const ratio = nearestRatio(width,height);
  if (provider === 'gemini') return {
    url:`https://generativelanguage.googleapis.com/v1/models/${model}:generateContent`,
    headers:{...headers,'x-goog-api-key':apiKey},
    body:{contents:[{parts:[{text:prompt}]}],generationConfig:{responseModalities:['TEXT','IMAGE'],responseFormat:{image:{aspectRatio:geminiRatios[ratio]}}}}
  };
  headers.Authorization = `Bearer ${apiKey}`;
  return {
    url:provider === 'openai' ? 'https://api.openai.com/v1/images/generations' : 'https://api.x.ai/v1/images/generations', headers,
    body:provider === 'openai' ? {model,prompt,n:1,size:width===height?'1024x1024':width>height?'1536x1024':'1024x1536',quality:'medium',output_format:'jpeg'} : {model,prompt,n:1,response_format:'b64_json',aspect_ratio:ratio}
  };
}
export function extractImage(provider, data) {
  if (provider === 'gemini') {
    const parts = data.candidates?.[0]?.content?.parts || [];
    const part = parts.find(p => !p.thought && (p.inlineData || p.inline_data));
    const image = part?.inlineData || part?.inline_data;
    if (image?.data) return {base64:image.data,mime:image.mimeType || image.mime_type || 'image/png'};
  } else if (data.data?.[0]?.b64_json) return {base64:data.data[0].b64_json,mime:'image/jpeg'};
  throw new Error('A IA não retornou uma imagem. O pedido pode ter sido filtrado; revise o prompt.');
}
export async function generateOne(input, fetcher = fetch) {
  const req = providerRequest(input);
  const res = await fetcher(req.url,{method:'POST',headers:req.headers,body:JSON.stringify(req.body),signal:AbortSignal.timeout(180000)});
  if (!res.ok) {
    // Never persist provider responses: they can echo prompts and credentials.
    const messages = {401:'Chave de API inválida.',403:'A chave não tem acesso ao modelo selecionado.',404:'Modelo indisponível. Verifique o nome em Configurações.',429:'Limite de uso ou saldo da API atingido.',400:'A IA recusou os parâmetros ou o conteúdo. Verifique o modelo e o prompt.'};
    throw new Error(messages[res.status] || `A IA apresentou uma falha (HTTP ${res.status}). Tente novamente mais tarde.`);
  }
  return extractImage(input.provider,await res.json());
}
export async function runJob(input, store, generate = generateOne) {
  validate(input);
  const key = `${input.token}/job`;
  const claim = await store.setJSON(key,{status:'running',created:Date.now(),count:input.count,images:[],errors:[]},{onlyIfNew:true});
  if (!claim.modified) return;
  const state = {status:'running',created:Date.now(),count:input.count,images:[],errors:[]};
  // Sequential progress writes avoid lost updates, with at most four provider calls.
  for (let i=0;i<input.count;i++) {
    try {
      const result = await generate({...input,prompt:`${input.prompt}\nVariação ${i+1} de ${input.count}: proponha uma composição própria.`});
      const bytes = Buffer.from(result.base64,'base64');
      if (!['image/png','image/jpeg','image/webp'].includes(result.mime) || !bytes.length || bytes.length > 18*1024*1024) throw new Error('A imagem recebida excede o limite ou usa formato não suportado.');
      await store.set(`${input.token}/image-${i}`,bytes);
      state.images.push({index:i,mime:result.mime});
    } catch (e) {state.errors.push({index:i,message:e.name==='TimeoutError'?'A IA excedeu o tempo de resposta.':e.message});}
    await store.setJSON(key,{...state,status:i===input.count-1?'done':'running'});
  }
}
