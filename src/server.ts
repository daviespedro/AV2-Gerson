// A porta de entrada. Quem manda na porta é a variável PORT.
// E quando alguém pede para fechar (Ctrl+C), saímos de cena com elegância, sem derrubar ninguém no meio do truque.

import { carregarConfig } from './config';
import { criarApp } from './app';

/**
 * A porta vem de PORT. Na saída, elegância (SIGINT/SIGTERM, e SIGBREAK no Windows): para de aceitar conexões,
 * espera as requisições em andamento e fecha o pool do banco; um temporizador força a saída se passar de
 * SHUTDOWN_TIMEOUT_MS.
 */
async function main() {
  // Easter egg nº 7: se você chegou até aqui, uma xícara de chá é por minha conta. Há 9 truques escondidos neste projeto:
  // procure por 'Easter egg nº'. O último deles é o mais difícil de achar. :)
  const config = carregarConfig();
  const app = await criarApp(config);

  let encerrando = false;
  const encerrar = async (sinal: string) => {
    if (encerrando) return;
    encerrando = true;
    app.log.info(`${sinal} recebido: encerrando com graciosidade...`);
    setTimeout(() => {
      app.log.error('Tempo limite de encerramento excedido; forçando saída.');
      process.exit(1);
    }, config.encerramentoMs).unref();
    try {
      await app.close(); // fecha o servidor HTTP e, pelo hook onClose, o Prisma: apaga as luzes e tranca a porta
      process.exit(0);
    } catch (e) {
      app.log.error(e);
      process.exit(1);
    }
  };
  for (const s of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(s, () => void encerrar(s));

  await app.listen({ port: config.porta, host: config.host });
}

main().catch((e) => {
  console.error('Falha ao iniciar o servidor:', e instanceof Error ? e.message : e);
  process.exit(1);
});
