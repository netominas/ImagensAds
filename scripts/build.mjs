import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js', 'core.js', 'login.css', 'login.js', 'access.js', 'copy.js', 'copy-core.js', 'copy.css']) await copyFile(`public/${file}`, `dist/${file}`);
console.log('Build concluído: dist/');

