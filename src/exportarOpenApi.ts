// Uma fotografia do contrato da API (OpenAPI), guardada em docs/openapi.json.
// Não precisa de banco, só das rotas. Cartão de visitas: curto, elegante e sem conversa fiada.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Só precisa montar as rotas (não conecta ao banco): valores falsos bastam se o .env não existir.
process.env.DATABASE_URL ??= 'postgresql://x:x@localhost:5432/x';
process.env.JWT_SECRET ??= 'x'.repeat(32);

async function main() {
  // Tiro a foto da API sem acordar o banco de dados. Alguns segredos é melhor deixar dormindo.
  const { carregarConfig } = await import('./config');
  const { criarApp } = await import('./app');
  const app = await criarApp(carregarConfig());
  await app.ready();
  const destino = resolve(__dirname, '..', 'docs', 'openapi.json');
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, JSON.stringify(app.swagger(), null, 2));
  await app.close();
  console.log(`Contrato OpenAPI gravado em ${destino}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
