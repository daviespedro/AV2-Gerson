// Configuração: o que o ambiente nos conta. Eu confio em todo mundo... depois de conferir a variável.
// Segredo curto ou porta maluca? O sistema nem sobe. Melhor falhar na porta do que no meio do show.

try {
  process.loadEnvFile(); // Node 20.12+ lê o .env sozinho. Sem .env? Tudo bem, o ambiente também sabe guardar segredos
} catch {}

export interface Config {
  porta: number;
  host: string;
  databaseUrl: string;
  jwtSecret: string;
  jwtExpira: string;
  cors: string | boolean;
  logLevel: string;
  encerramentoMs: number;
}

export function carregarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Eu verifico tudo antes de sorrir para a plateia. Quem confia demais acaba sendo enganado.
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL não definida. Copie .env.example para .env.');
  if ((env.JWT_SECRET ?? '').length < 32) throw new Error('JWT_SECRET precisa ter 32+ caracteres.');
  const porta = Number(env.PORT ?? 3000);
  if (!Number.isInteger(porta) || porta < 0 || porta > 65535) throw new Error(`PORT inválida: ${env.PORT}`);
  const cors = env.CORS_ORIGIN;
  return {
    porta,
    host: env.HOST ?? '0.0.0.0',
    databaseUrl: env.DATABASE_URL,
    jwtSecret: env.JWT_SECRET!,
    jwtExpira: env.JWT_EXPIRES_IN ?? '30m',
    cors: !cors ? false : cors === '*' ? true : cors,
    logLevel: env.LOG_LEVEL ?? 'info',
    encerramentoMs: Number(env.SHUTDOWN_TIMEOUT_MS ?? 10000),
  };
}
