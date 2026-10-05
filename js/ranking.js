// Rankings de fundos: tipos de cálculo (pesos), métricas usadas e a pontuação relativa entre os fundos do ranking.
// Em cada métrica, o pior fundo do ranking tem nota 0 e o melhor tem nota 1 (os demais ficam no meio, em proporção);
// a nota é multiplicada pelo peso. Peso positivo = maior é melhor; peso negativo = menor é melhor. Os pesos somam 100.

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
export const metricaRank = (k) => METRICAS_RANK.find((m) => m.k === k);

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
export function pontuar(itens, pesos) {
  const ks = Object.keys(pesos), lim = {};
  const ok = (x) => typeof x === "number" && Number.isFinite(x);
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
      let nota = 0;
      if (L && ok(x)) nota = L[1] === L[0] ? 1 : p > 0 ? (x - L[0]) / (L[1] - L[0]) : (L[1] - x) / (L[1] - L[0]);
      const pontos = nota * Math.abs(p);
      notas[k] = { nota, pontos, valor: ok(x) ? x : null };
      total += pontos; grupos[metricaRank(k)?.g || "Performance"] += pontos;
    }
    return { id: it.id, total, grupos, notas };
  });
}

/** Ordem do ranking: maior pontuação; empate -> maior rentabilidade acumulada. */
export function ordenarRanking(pontuados, acum) {
  return [...pontuados].sort((a, b) => b.total - a.total || (acum(b.id) ?? -Infinity) - (acum(a.id) ?? -Infinity));
}
