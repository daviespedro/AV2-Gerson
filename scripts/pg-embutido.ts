// Um PostgreSQL de verdade, trazido pelo npm (pacote opcional "embedded-postgres"): nada de Docker, nada de instalador.
// O truque: ele baixa o binário certo para o seu sistema (Windows, Linux ou macOS) na hora do npm install.
// Se o pacote não existir na máquina, ou o sistema não deixar o servidor subir (o PostgreSQL recusa rodar como root no Linux),
// eu aviso com clareza e o resto do plano (instalar o PostgreSQL na máquina) continua valendo.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const USUARIO_PG = 'greencode';
export const SENHA_PG = 'greencode';

export function portaLivre(): Promise<number> {
  // Pergunto ao sistema operacional por uma porta livre: a resposta dele é mais confiável que a minha intuição.
  return new Promise((ok, falha) => {
    const s = createServer();
    s.once('error', falha);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });
}

export interface PgEmbutido {
  porta: number;
  /** Conexão de administração (banco "postgres"), pronta para o TEST_DATABASE_ADMIN_URL. */
  urlAdmin: string;
  parar: () => Promise<void>;
}

export async function iniciarPgEmbutido(o: { porta?: number; dir?: string; persistente?: boolean; banco?: string } = {}): Promise<PgEmbutido> {
  // Um PostgreSQL sob demanda: aparece quando preciso, some quando acabo. Todo bom truque tem um desaparecimento.
  let modulo: any;
  try {
    modulo = await import('embedded-postgres');
  } catch {
    throw new Error('o pacote opcional "embedded-postgres" não está instalado (npm install o traz quando a plataforma é suportada)');
  }
  const EmbeddedPostgres = modulo.default ?? modulo;
  const porta = o.porta ?? (await portaLivre());
  const persistente = o.persistente ?? false;
  const dir = o.dir ?? mkdtempSync(join(tmpdir(), 'greencode-pg-'));

  const pg = new EmbeddedPostgres({ databaseDir: dir, user: USUARIO_PG, password: SENHA_PG, port: porta, persistent: persistente, onLog: () => {}, onError: () => {} });
  if (!existsSync(join(dir, 'PG_VERSION'))) await pg.initialise(); // diretório já inicializado? então só acordo o servidor
  await pg.start();
  if (o.banco) await pg.createDatabase(o.banco).catch(() => null); // já existe? ótimo

  return {
    porta,
    urlAdmin: `postgresql://${USUARIO_PG}:${SENHA_PG}@127.0.0.1:${porta}/postgres`,
    async parar() {
      await pg.stop().catch(() => null);
      if (!persistente) rmSync(dir, { recursive: true, force: true });
    },
  };
}
