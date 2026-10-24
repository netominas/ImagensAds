import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
for (const file of ['index.html','login.css','login.js','access.js','favicon.svg','dashboard.js','dashboard.css']) await copyFile(`public/${file}`, `dist/${file}`);
await mkdir('dist/apps/criativos',{recursive:true});
for(const file of ['app.js','core.js','styles.css','copy.js','copy-core.js','copy.css']){
 await copyFile(`apps/criativos/public/${file}`,`dist/apps/criativos/${file}`);
 await copyFile(`apps/criativos/public/${file}`,`dist/${file}`);
}
console.log('Build concluído: dist/');

