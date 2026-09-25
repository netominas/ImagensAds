export function textRequest({provider,model,prompt,apiKey}){
 const headers={'Content-Type':'application/json'};
 if(provider==='gemini')return {url:`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,headers:{...headers,'x-goog-api-key':apiKey},body:{contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:8000}}};
 headers.Authorization=`Bearer ${apiKey}`;
 if(provider==='openai')return {url:'https://api.openai.com/v1/responses',headers,body:{model,input:prompt,max_output_tokens:8000,store:false}};
 if(provider==='grok')return {url:'https://api.x.ai/v1/chat/completions',headers,body:{model,messages:[{role:'user',content:prompt}],max_tokens:8000,stream:false}};
 throw new Error('IA inválida.');
}
export async function generateCopy(input,fetcher=fetch){
 const req=textRequest(input);
 const r=await fetcher(req.url,{method:'POST',headers:req.headers,body:JSON.stringify(req.body),signal:AbortSignal.timeout(180000)});
 if(!r.ok){const messages={400:'Parâmetros recusados. Verifique se o modelo escolhido gera textos.',401:'Chave de API inválida.',403:'Sem acesso ao modelo selecionado.',404:'Modelo de texto não encontrado. Confira o nome do modelo.',429:'Limite de uso ou saldo da API atingido.'};throw new Error(messages[r.status]||`Falha no provedor (HTTP ${r.status}).`);}
 const d=await r.json();let text='',partial=false;
 if(input.provider==='openai'){text=(d.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n');partial=d.status==='incomplete';}
 if(input.provider==='gemini'){text=(d.candidates?.[0]?.content?.parts||[]).filter(x=>!x.thought&&typeof x.text==='string').map(x=>x.text).join('\n');partial=d.candidates?.[0]?.finishReason==='MAX_TOKENS';}
 if(input.provider==='grok'){text=d.choices?.[0]?.message?.content||'';partial=d.choices?.[0]?.finish_reason==='length';}
 if(typeof text!=='string'||!text.trim())throw new Error('A IA não retornou texto. Revise o pedido ou o modelo.');
 return {text:text.slice(0,100000),warning:partial||text.length>100000?'O texto atingiu o limite de saída e pode estar incompleto. Reduza o pedido antes de gerar novamente.':''};
}
