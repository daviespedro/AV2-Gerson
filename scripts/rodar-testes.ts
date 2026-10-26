// O maestro dos testes. Ele resolve a única dúvida chata: "de onde vem o PostgreSQL?".
//   1) já tem um acessível (instalado na máquina ou apontado por TEST_DATABASE_ADMIN_URL)? Usa esse.
//   2) não tem? Sobe um PostgreSQL embutido, temporário, só para esta execução (sem Docker, sem instalar nada).
//   3) nenhum dos dois? Explica o que fazer, em vez de despejar uma centena de linhas vermelhas.
// Depois roda os arquivos de teste, apaga as luzes (desliga o PostgreSQL embutido, se foi ele) e devolve o código de saída.
import { spawn } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { semSenha, URL_ADMIN } from '../tests/helpers/ambiente';
import { iniciarPgEmbutido, PgEmbutido } from './pg-embutido';

const TODOS = [
  'tests/dominio.test.ts',
  'tests/config.test.ts',
  'tests/api.test.ts',
  'tests/seguranca.test.ts',
  'tests/concorrencia.test.ts',
  'tests/requisitos.test.ts',
  'tests/seed.test.ts',
  'tests/encerramento.test.ts',
];
const SEM_BANCO = ['tests/dominio.test.ts', 'tests/config.test.ts', 'tests/encerramento.test.ts'];

async function alcancavel(url: string): Promise<boolean> {
  // Pergunta simples: tem alguém em casa? Três segundos de paciência e eu sigo em frente.
  const sep = url.includes('?') ? '&' : '?';
  const db = new PrismaClient({ datasourceUrl: `${url}${sep}connect_timeout=3` });
  try {
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await db.$disconnect();
  }
}

const AJUDA = `
Não encontrei um PostgreSQL para os testes de API e não consegui subir o embutido.
Escolha um caminho (detalhes em docs/TESTES.md):

  A) Instale o PostgreSQL e crie o usuário:   CREATE USER greencode WITH PASSWORD 'greencode' CREATEDB;
       Ubuntu:   sudo apt install postgresql
       Windows:  instalador em postgresql.org (ou: winget install PostgreSQL.PostgreSQL)
       macOS:    brew install postgresql@16 && brew services start postgresql@16
  B) Outro usuário/senha: defina TEST_DATABASE_ADMIN_URL=postgresql://usuario:senha@localhost:5432/postgres

Para rodar só o que não precisa de banco:   npm run test:unit
`;

async function main() {
  const pedidos = process.argv.slice(2);
  const lista = pedidos.length ? pedidos : TODOS;
  const env: NodeJS.ProcessEnv = { ...process.env };
  let pg: PgEmbutido | null = null;

  const precisaBanco = lista.some((f) => !SEM_BANCO.includes(f));
  if (precisaBanco && (await alcancavel(URL_ADMIN))) {
    // dizer qual PostgreSQL está em uso: quem não diz de onde veio a prova, não tem prova
    console.log(`Usando o PostgreSQL encontrado em ${semSenha(URL_ADMIN)} (um banco temporário será criado e apagado).\n`);
  } else if (precisaBanco) {
    if (process.env.TEST_DATABASE_ADMIN_URL) {
      console.error(`TEST_DATABASE_ADMIN_URL aponta para ${semSenha(URL_ADMIN)}, mas o PostgreSQL não respondeu.`);
      process.exit(1);
    }
    console.log(`Nenhum PostgreSQL em ${semSenha(URL_ADMIN)}. Tentando o PostgreSQL embutido (sem Docker)...`);
    try {
      pg = await iniciarPgEmbutido();
      env.TEST_DATABASE_ADMIN_URL = pg.urlAdmin;
      console.log(`PostgreSQL embutido ativo na porta ${pg.porta} (temporário: some quando os testes terminarem).\n`);
    } catch (e) {
      console.error(`${AJUDA}\nMotivo do embutido: ${e instanceof Error ? e.message : e}`);
      process.exit(1);
    }
  }

  const sair = async (codigo: number) => {
    await pg?.parar();
    process.exit(codigo);
  };
  process.on('SIGINT', () => void sair(130));
  process.on('SIGTERM', () => void sair(143));

  const codigo = await new Promise<number>((ok) => {
    const filho = spawn(process.execPath, ['--import', 'tsx', '--test', ...lista], { stdio: 'inherit', env });
    filho.on('exit', (c) => ok(c ?? 1));
  });
  await sair(codigo);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
