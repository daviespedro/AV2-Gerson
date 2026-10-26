// O cérebro do equipamento: quanto vale com a idade, quando pode ser desmontado, quanto o estado pode cair.
// Cada tipo envelhece do seu jeito (um perfil por tipo). Tipo desconhecido? Perfil genérico: ninguém fica sem lugar.

import { erroValidacao } from '../errors';

export const ESTADOS_FISICOS = ['novo', 'seminovo', 'bom', 'regular', 'ruim', 'sucata'] as const; // do melhor ao pior: é pela ordem que eu meço a queda
export type EstadoFisico = (typeof ESTADOS_FISICOS)[number];

export const STATUS_EQUIPAMENTO = ['aguardando_triagem', 'em_triagem', 'triado', 'desmonte', 'reciclagem', 'descarte_seguro', 'revenda'] as const;
export type StatusEquipamento = (typeof STATUS_EQUIPAMENTO)[number];

// --- Depreciação: um perfil por tipo (estratégia). Tipo desconhecido cai no perfil genérico. ---
interface Perfil {
  vidaUtilMeses: number;
  coeficiente(meses: number): number; // de 0 (novinho) a 1 (só serve de peso de papel)
}

const linear = (vida: number) => (m: number) => Math.min(1, Math.max(0, m) / vida);

const PERFIS: Record<string, Perfil> = {
  terminal: { vidaUtilMeses: 36, coeficiente: linear(36) },
  // CPU: envelhece rápido, 50% no primeiro ano, como todo prodígio; depois segue linear até o fim da vida útil
  cpu: {
    vidaUtilMeses: 48,
    coeficiente: (m) => {
      const x = Math.max(0, m);
      return x <= 12 ? (x / 12) * 0.5 : Math.min(1, 0.5 + Math.min(1, (x - 12) / 36) * 0.5);
    },
  },
  monitor: { vidaUtilMeses: 60, coeficiente: linear(60) },
  // Servidor: sempre sobra algum valor residual, nunca passa de 85%
  servidor: { vidaUtilMeses: 72, coeficiente: (m) => Math.min(0.85, linear(72)(m)) },
};
const GENERICO: Perfil = { vidaUtilMeses: 24, coeficiente: linear(24) };

export const tiposEspecializados = () => Object.keys(PERFIS);

export function normalizarTipo(tipo: string): string {
  // 'CPU', 'cpu' e ' Cpu ' são a mesma pessoa de disfarce: eu reconheço pelo jeito de andar (minúsculas, sem espaços).
  const t = (tipo ?? '').trim().toLowerCase();
  if (!t) throw erroValidacao('O tipo do equipamento é obrigatório.');
  return t;
}

export function calcularDepreciacao(tipo: string, meses: number) {
  // Todo equipamento envelhece; a diferença é quem aceita isso com dignidade. Os perfis acima decidem a dignidade de cada tipo.
  // E 'constructor' não é um tipo de equipamento: é uma tentativa de truque com o protótipo. Esse número eu já vi.
  if (!Number.isFinite(meses) || meses < 0) throw erroValidacao('O número de meses deve ser maior ou igual a zero.');
  const perfil = Object.prototype.hasOwnProperty.call(PERFIS, tipo) ? PERFIS[tipo] : GENERICO;
  return { coeficiente: perfil.coeficiente(meses), vidaUtilEstimadaMeses: perfil.vidaUtilMeses };
}

// --- Regras de transição ---
export function validarMovimento(novo: StatusEquipamento, triagemCompleta: boolean) {
  // Desmontar antes de triar é acusar o suspeito antes de interrogá-lo.
  if (novo === 'desmonte' && !triagemCompleta) {
    throw erroValidacao("Equipamento só pode ir para 'desmonte' após a triagem completa.");
  }
}

export function validarEstadoFisico(valor: string): EstadoFisico {
  // Só reconheço os seis estados da lista. 'Meio quebrado' é um estado de espírito, não de equipamento.
  if (!ESTADOS_FISICOS.includes(valor as EstadoFisico)) {
    throw erroValidacao(`Estado físico inválido. Valores aceitos: ${ESTADOS_FISICOS.join(', ')}.`);
  }
  return valor as EstadoFisico;
}

/** Caiu duas categorias ou mais? Eu quero uma explicação: justificativa textual, por favor. */
export function exigirJustificativa(anterior: EstadoFisico, novo: EstadoFisico, justificativa?: string) {
  // Cair uma categoria, tudo bem. Cair duas ou mais sem explicação me obriga a perguntar: onde você estava na noite do crime?
  const queda = ESTADOS_FISICOS.indexOf(novo) - ESTADOS_FISICOS.indexOf(anterior);
  if (queda >= 2 && !justificativa?.trim()) {
    throw erroValidacao(`Alterar o estado físico de '${anterior}' para '${novo}' rebaixa 2 ou mais categorias e exige justificativa.`);
  }
}
