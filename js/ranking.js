// Rankings de fundos: tipos de cálculo (pesos), métricas usadas e a pontuação relativa entre os fundos do ranking.
// Em cada métrica, o pior fundo do ranking tem nota 0 e o melhor tem nota 1 (os demais ficam no meio, em proporção);
// a nota é multiplicada pelo peso. Peso positivo = maior é melhor; peso negativo = menor é melhor. Os pesos somam 100.

import { COLUNAS, partes, diaYMD, somarMeses } from "./calculos.js";

export const GRUPOS_RANK = ["Performance", "Consistência", "Risco"];

// k: nome da coluna nas métricas do site (as que começam com "_" são calculadas só para o ranking)
export const METRICAS_RANK = [
  { k: "% Acumulado", nome: "Rentabilidade acumulada", g: "Performance", tipo: "pct" },
  { k: "_objetivo", nome: "Realização do objetivo de retorno", g: "Performance", tipo: "pct" },
  { k: "Captação Líquida no Período", nome: "Captação líquida no período", g: "Performance", tipo: "valor" },
  { k: "Sharpe Anualizado", nome: "Sharpe", g: "Performance", tipo: "num2" },
  { k: "% de dias acima do CDI", nome: "% de dias acima do CDI", g: "Consistência", tipo: "pct" },
  { k: "% de dias acima do IBOV", nome: "% de dias acima do IBOV", g: "Consistência", tipo: "pct" },
  { k: "_jmPos", nome: "Rentabilidade positiva na janela móvel", g: "Consistência", tipo: "pct" },
  { k: "_jmBench", nome: "Rentabilidade acima do benchmark na janela móvel", g: "Consistência", tipo: "pct" },
  { k: "No. de estouros", nome: "Quantidade de estouros de VaR", g: "Risco", tipo: "int" },
  { k: "Índice de Dor", nome: "Índice de Dor", g: "Risco", tipo: "pct" },
  { k: "MDD/VOL", nome: "Drawdown máximo / volatilidade", g: "Risco", tipo: "num2" },
  { k: "Valor Atual", nome: "Valor atual em underwater", g: "Risco", tipo: "pct" },
  { k: "Dias em Underwater Atual", nome: "Dias em underwater atual", g: "Risco", tipo: "int" },
  { k: "Maior Período em Dias Underwater", nome: "Maior período em underwater (dias)", g: "Risco", tipo: "int" },
];
// demais métricas numéricas da tabela de métricas, que podem entrar em tipos de cálculo novos
// dir: direção sugerida (+1 = maior é melhor, -1 = menor é melhor); g: grupo sugerido
const EXTRAS_RANK = [
  ["% Anualizado", "Performance", 1], ["%CDI", "Performance", 1], ["CDI +", "Performance", 1], ["IBOV +", "Performance", 1], ["yRoa", "Performance", 1],
  ["Sortino", "Performance", 1], ["VaR Histórico", "Risco", 1], ["VaR Normal (1 dia 95%)", "Risco", 1], ["Volatilidade", "Risco", -1], ["Queda", "Risco", 1],
  ["% recuperado até hoje", "Risco", 1], ["Duração Total", "Risco", -1], ["Duração da Queda", "Risco", -1], ["Duração da Recuperação", "Risco", -1],
  ["Beta", "Risco", -1], ["Var Diária Ponderada", "Risco", 1], ["Períodos 21d-30d", "Risco", -1], ["Períodos 31d-60d", "Risco", -1], ["Períodos 61d-90d", "Risco", -1],
  ["Períodos 91d-120d", "Risco", -1], ["Períodos acima de 120d", "Risco", -1],
];
const TIPO_COL = Object.fromEntries(COLUNAS.map(([, n, t]) => [n, t]));
for (const [k, g, dir] of EXTRAS_RANK) if (TIPO_COL[k] && !METRICAS_RANK.some((m) => m.k === k))
  METRICAS_RANK.push({ k, nome: k === "Queda" ? "Drawdown máximo (queda)" : k, g, tipo: TIPO_COL[k] === "valor" ? "valor" : TIPO_COL[k], dir, extra: true });
// direção sugerida das métricas originais
const DIR_PADRAO = { "No. de estouros": -1, "Índice de Dor": -1, "MDD/VOL": -1, "Dias em Underwater Atual": -1, "Maior Período em Dias Underwater": -1 };
for (const m of METRICAS_RANK) if (m.dir == null) m.dir = DIR_PADRAO[m.k] || 1;
export const metricaRank = (k) => METRICAS_RANK.find((m) => m.k === k);
/** Grupo da métrica no tipo de cálculo (pode ser trocado no editor); senão, o grupo sugerido. */
export const grupoMetrica = (M, k) => M?.grupos?.[k] || metricaRank(k)?.g || "Performance";

// Data de comparação para a coluna de variação de posição
export const COMPARACOES = {
  "1m": "1 mês antes", "2m": "2 meses antes", "3m": "3 meses antes", "6m": "6 meses antes", "12m": "12 meses antes",
  "24m": "24 meses antes", "36m": "36 meses antes", "fimMes": "Fim do mês passado", "fimAno": "Fim do ano passado",
};
export const ROTULO_VAR = { "1m": "1 mês", "2m": "2 meses", "3m": "3 meses", "6m": "6 meses", "12m": "12 meses", "24m": "24 meses", "36m": "36 meses", "fimMes": "mês", "fimAno": "ano" };
export function dataComparacao(fim, chave = "1m") {
  const [a, m] = partes(fim);
  if (chave === "fimMes") return diaYMD(a, m, 1) - 1;
  if (chave === "fimAno") return diaYMD(a, 1, 1) - 1;
  return somarMeses(fim, -(parseInt(chave, 10) || 1));
}

// Tipos de cálculo (planilha "Métricas × categoria"): período das métricas, janela móvel (5 anos de aplicações) e pesos
export const MODELOS_RANK = {
  MM: { nome: "Multimercado", periodo: "36 Meses", jmMeses: 36, bench: "CDI",
    pesos: { "% Acumulado": 15, "_objetivo": 10, "Sharpe Anualizado": 20, "% de dias acima do CDI": 10, "_jmPos": 10, "_jmBench": 10,
      "No. de estouros": -5, "Índice de Dor": -10, "MDD/VOL": -5, "Valor Atual": 5 } },
  RF: { nome: "Renda Fixa", periodo: "24 Meses", jmMeses: 24, bench: "CDI",
    pesos: { "% Acumulado": 15, "Captação Líquida no Período": 20, "Sharpe Anualizado": 5, "% de dias acima do CDI": 5, "_jmPos": 10, "_jmBench": 10,
      "No. de estouros": -5, "Índice de Dor": -10, "Valor Atual": 5, "Dias em Underwater Atual": -5, "Maior Período em Dias Underwater": -10 } },
  RV: { nome: "Renda Variável", periodo: "36 Meses", jmMeses: 12, bench: "IBOV",
    pesos: { "% Acumulado": 15, "_objetivo": 10, "Sharpe Anualizado": 20, "% de dias acima do IBOV": 10, "_jmPos": 10, "_jmBench": 10,
      "No. de estouros": -5, "Índice de Dor": -10, "MDD/VOL": -5, "Valor Atual": 5 } },
  INF: { nome: "Inflação", periodo: "24 Meses", jmMeses: 24, bench: "CDI",
    pesos: { "% Acumulado": 15, "Captação Líquida no Período": 20, "Sharpe Anualizado": 5, "% de dias acima do CDI": 5, "_jmPos": 10, "_jmBench": 10,
      "No. de estouros": -5, "Índice de Dor": -10, "Valor Atual": 5, "Dias em Underwater Atual": -5, "Maior Período em Dias Underwater": -10 } },
};
export const JM_ANOS = 5;                        // a janela móvel olha os últimos 5 anos de aplicações

// índice do "objetivo de retorno" declarado no cadastro da CVM (texto livre) -> chave do índice no site
export function indiceObjetivo(txt) {
  const t = String(txt || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!t || t === "N/D") return null;
  if (/IBOV|IBRX|IBX|ACOES|SMLL/.test(t)) return "IBOV";
  if (/IPCA|IMA-?B|IMAB|INFLA/.test(t)) return "IPCA";
  if (/IGP/.test(t)) return "IGPM";
  if (/SELIC/.test(t)) return "SELIC";
  if (/DOLAR|PTAX|CAMBIO|USD/.test(t)) return "DOLAR";
  if (/\bDI\b|CDI|DI DE UM DIA|IMA-?S|IRF-?M/.test(t)) return "CDI";
  return null;
}

/**
 * itens: [{ id, v: { métrica: número | null } }]; pesos: { métrica: peso com sinal }.
 * Devolve, por item: { id, total (0 a 100), grupos: { Performance, Consistência, Risco }, notas: { métrica: { nota 0..1, pontos } } }.
 * Sem valor numa métrica = 0 ponto nela. Se todos os fundos têm o mesmo valor, todos recebem nota 1.
 */
// Opcional (M.jmProporcional): nas métricas de consistência da janela móvel (_jmPos, _jmBench), em vez da nota relativa,
// pontos = peso × consistência × (janelas do fundo ÷ janelas do fundo com mais janelas) — fundo com histórico curto vale menos.
export const METRICAS_JM = ["_jmPos", "_jmBench"];
export function pontuar(itens, pesos, M = null) {
  const ks = Object.keys(pesos), lim = {};
  const ok = (x) => typeof x === "number" && Number.isFinite(x);
  const prop = !!M?.jmProporcional, nMax = prop ? Math.max(0, ...itens.map((it) => it.v._jmN || 0)) : 0;
  for (const k of ks) {
    let a = Infinity, b = -Infinity;
    for (const it of itens) { const x = it.v[k]; if (ok(x)) { if (x < a) a = x; if (x > b) b = x; } }
    lim[k] = a <= b ? [a, b] : null;
  }
  return itens.map((it) => {
    const notas = {}, grupos = Object.fromEntries(GRUPOS_RANK.map((g) => [g, 0]));
    let total = 0;
    for (const k of ks) {
      const p = pesos[k], x = it.v[k], L = lim[k];
      let nota = 0, pJan = null;
      if (prop && METRICAS_JM.includes(k)) {
        pJan = nMax > 0 ? (it.v._jmN || 0) / nMax : 0;
        if (ok(x)) nota = (p > 0 ? x : 1 - x) * pJan;                    // consistência × proporção de janelas
      } else if (L && ok(x)) nota = L[1] === L[0] ? 1 : p > 0 ? (x - L[0]) / (L[1] - L[0]) : (L[1] - x) / (L[1] - L[0]);
      const pontos = nota * Math.abs(p);
      notas[k] = { nota, pontos, valor: ok(x) ? x : null, ...(pJan != null ? { pJan } : {}) };
      total += pontos; grupos[grupoMetrica(M, k)] = (grupos[grupoMetrica(M, k)] || 0) + pontos;
    }
    return { id: it.id, total, grupos, notas };
  });
}

/** Ordem do ranking: maior pontuação; empate -> maior rentabilidade acumulada. */
export function ordenarRanking(pontuados, acum) {
  return [...pontuados].sort((a, b) => b.total - a.total || (acum(b.id) ?? -Infinity) - (acum(a.id) ?? -Infinity));
}