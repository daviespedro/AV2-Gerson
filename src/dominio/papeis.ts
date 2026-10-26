// Quatro papéis, quatro chapéus. O admin entra em qualquer sala; o auditor só olha (e anota).

export const PAPEIS = ['admin', 'cadastro', 'almoxarifado', 'auditor'] as const;
export type Papel = (typeof PAPEIS)[number];
