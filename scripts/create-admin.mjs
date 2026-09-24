// Run this locally. The clear-text password is neither printed nor written to disk.
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {writeFile} from 'node:fs/promises';
import {hashPassword} from '../lib/auth.mjs';
let muted=false;
const output=new Writable({write(chunk,encoding,callback){if(!muted)process.stdout.write(chunk,encoding);callback();}});
const terminal=createInterface({input:process.stdin,output,terminal:true});
try{
  const email=(await terminal.question('E-mail do administrador: ')).trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Informe um e-mail válido.');
  process.stdout.write('Senha (14 a 256 caracteres; não será exibida): ');muted=true;
  const password=await terminal.question('');muted=false;process.stdout.write('\n');
  process.stdout.write('Confirme a senha: ');muted=true;
  const confirmation=await terminal.question('');muted=false;process.stdout.write('\n');
  if(password!==confirmation)throw new Error('As senhas não coincidem.');
  const hash=await hashPassword(password);
  await writeFile('.env',`ADMIN_EMAIL=${email}\nADMIN_PASSWORD_HASH='${hash}'\n`,{flag:'wx',mode:0o600});
  console.log('Configuração criada em .env (ignorada pelo Git). A senha não foi salva: somente seu hash.');
  console.log('Para ativar na Netlify, importe .env em Project configuration > Environment variables e faça um novo deploy.');
}catch(error){console.error(error.code==='EEXIST'?'O arquivo .env já existe. Preserve-o e edite sua configuração conscientemente antes de redefinir o acesso.':error.message);process.exitCode=1;}
finally{muted=false;terminal.close();}
