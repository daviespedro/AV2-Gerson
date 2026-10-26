// A conexão com o banco, uma só, como todo bom truque: ensaiada e sem plateia de conexões extras.
// `transacao` é a promessa de que ou tudo acontece, ou nada aconteceu (e ninguém viu nada).

import './config'; // primeiro o .env, depois o Prisma: a ordem das cartas importa
import { Prisma, PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
export type Db = Prisma.TransactionClient; // o PrismaClient normal também serve: no truque, o mágico e o assistente usam o mesmo baralho

/** Tudo ou nada: se `fn` lançar qualquer erro, todas as escritas somem como se nunca tivessem existido. */
export const transacao = <T>(fn: (tx: Db) => Promise<T>) => prisma.$transaction(fn, { maxWait: 5000, timeout: 15000 });

export const codigoPrisma = (e: unknown) => (e as { code?: string })?.code;
