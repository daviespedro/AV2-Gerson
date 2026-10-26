// PostgreSQL de bolso para rodar a API na sua máquina sem Docker e sem instalar nada: `npm run pg`.
// Fica ligado até o Ctrl+C; os dados ficam em .pgdata/ (sobrevivem entre execuções). Usuário/senha/banco: greencode.
// Em outro terminal: npm run db:setup && npm run dev
import { resolve } from 'node:path';
import { iniciarPgEmbutido } from './pg-embutido';

async function main() {
  // Fica ligado até o Ctrl+C. Como todo bom chá, não deve ser deixado esquecido na bancada.
  const pg = await iniciarPgEmbutido({ porta: Number(process.env.PG_PORTA ?? 5432), dir: resolve(__dirname, '..', '.pgdata'), persistente: true, banco: 'greencode' });
  console.log(`PostgreSQL embutido no ar: postgresql://greencode:greencode@localhost:${pg.porta}/greencode`);
  console.log('Deixe este terminal aberto. Ctrl+C para desligar.');
  const sair = async () => {
    await pg.parar();
    process.exit(0);
  };
  process.on('SIGINT', () => void sair());
  process.on('SIGTERM', () => void sair());
  await new Promise(() => {}); // fica de pé
}

main().catch((e) => {
  console.error(`Não consegui subir o PostgreSQL embutido: ${e instanceof Error ? e.message : e}`);
  console.error('Alternativas: instale o PostgreSQL (veja docs/TESTES.md). Porta ocupada? Defina PG_PORTA.');
  process.exit(1);
});
