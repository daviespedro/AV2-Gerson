// Cria o .env a partir do .env.example quando ele ainda não existe.
// Quem esquece o .env é sempre o primeiro suspeito, e eu prefiro resolver o caso antes do interrogatório.
import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const raiz = resolve(__dirname, '..');
const destino = resolve(raiz, '.env');

if (existsSync(destino)) {
  console.log('.env já existe: não mexi em nada.');
} else {
  copyFileSync(resolve(raiz, '.env.example'), destino);
  console.log('.env criado a partir do .env.example (ajuste usuário/senha do banco e o JWT_SECRET, se precisar).');
}
