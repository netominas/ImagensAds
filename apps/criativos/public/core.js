export const providers = {
  gemini: { name: 'Gemini', company: 'Google', model: 'gemini-3.1-flash-image', icon: '✦' },
  openai: { name: 'ChatGPT', company: 'OpenAI', model: 'gpt-image-2.5-sunburst', icon: '◎' },
  grok: { name: 'Grok', company: 'xAI', model: 'grok-imagine-image-2.0', icon: '𝕏' }
};
export const formats = [
  {w:336,h:280,label:'Retângulo grande',channel:'Google Ads'},
  {w:300,h:250,label:'Retângulo médio',channel:'Google Ads'},
  {w:1080,h:1080,label:'Feed quadrado',channel:'Meta Ads'},
  {w:1080,h:1350,label:'Feed vertical',channel:'Meta Ads'},
  {w:1080,h:1920,label:'Stories e Reels',channel:'Meta Ads'},
  {w:1200,h:628,label:'Paisagem',channel:'Google / Meta'},
  {w:300,h:600,label:'Meia página',channel:'Google Ads'},
  {w:728,h:90,label:'Leaderboard',channel:'Google Ads'}
];
export const presets = [
  {id:'real',name:'Imagem realista',icon:'◉',description:'Fotografia natural, luz e detalhes.',prompt:'Crie uma fotografia publicitária realista sobre: {{tema}}. Use iluminação natural, texturas autênticas e composição profissional. Destaque o assunto principal com fundo organizado e espaço de respiro. Evite aparência artificial e elementos desnecessários.'},
  {id:'ctr',name:'Imagem alto CTR',icon:'↗',description:'Contraste e foco para chamar atenção.',prompt:'Crie um criativo visual marcante sobre: {{tema}}. Use contraste de cores, um ponto focal claro e leitura imediata em telas pequenas. Explore curiosidade visual honesta, sem sensacionalismo, falsas promessas, botões falsos ou resultados garantidos. Composição simples e expressiva.'},
  {id:'portal',name:'Contexto portal',icon:'▤',description:'Um olhar editorial para sua campanha.',prompt:'Crie uma imagem editorial fotográfica para ilustrar um conteúdo sobre: {{tema}}. Mostre uma situação cotidiana crível e contextualizada, com linguagem visual de revista digital. Não inclua logotipos de veículos, manchetes falsas ou interface de portal. Preserve a distinção entre anúncio e notícia.'},
  {id:'product',name:'Produto em destaque',icon:'◇',description:'Seu produto no centro da composição.',prompt:'Crie uma fotografia de produto para anúncio sobre: {{tema}}. Use cenário minimalista, luz de estúdio suave, sombras realistas e excelente definição. Concentre o olhar no produto com uma composição elegante.'}
];
export function composePrompt(template, theme, extra, width, height, text) {
  const main = template.includes('{{tema}}') ? template.replaceAll('{{tema}}', theme) : `${template}\nTema: ${theme}`;
  return `${main}\n${extra ? `Direção adicional: ${extra}\n` : ''}Formato final: ${width} × ${height} pixels. Organize o assunto para permitir recorte nessa proporção. Mantenha elementos essenciais longe das bordas. ${text ? 'Se houver texto solicitado, use português brasileiro e somente o texto explicitamente pedido.' : 'Não inclua textos, letras, marcas d’água ou logotipos.'}`;
}
export function cropRect(iw, ih, w, h, zoom = 1, x = .5, y = .5) {
  const scale = Math.max(w / iw, h / ih) * zoom;
  const sw = w / scale, sh = h / scale;
  return {sx: (iw - sw) * x, sy: (ih - sh) * y, sw, sh};
}
export function imagePlacement(iw, ih, w, h, zoom = 1, x = .5, y = .5) {
  const cover = Math.max(w / iw, h / ih);
  const dw = iw * cover * zoom, dh = ih * cover * zoom;
  return {dx:(w-dw)*x,dy:(h-dh)*y,dw,dh,fitZoom:Math.min(w/iw,h/ih)/cover};
}
export function nearestRatio(w, h) {
  return ['1:1','5:4','4:3','3:2','16:9','2:3','3:4','4:5','9:16'].reduce((a,b) => {
    const val = r => {const [x,y]=r.split(':').map(Number);return Math.abs(Math.log((w/h)/(x/y)));};
    return val(a) <= val(b) ? a : b;
  });
}
