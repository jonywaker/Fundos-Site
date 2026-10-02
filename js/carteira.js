// Montagem de carteira: simulação diária (dias úteis ANBIMA) com pesos, rebalanceamento e contribuição de cada ativo.
import { partes, upperBound } from "./calculos.js";
import { ehUtil, diasUteis } from "./indices.js";

/** Série de nível de um ativo: { d: dias, L: níveis } (cotas de fundo ou nível de índice). */
const nivelAsof = (s, dia) => { const i = upperBound(s.d, dia) - 1; return i >= 0 ? s.L[i] : null; };

/**
 * ativos: [{ s: { d, L }, nome }]; pesos: frações que somam 1; ini/fim: dias; rebal: meses entre rebalanceamentos (0 = nunca).
 * O período efetivo começa quando todos os ativos têm dado e termina no último dia em que todos têm dado.
 */
export function simularCarteira(ativos, pesos, { ini, fim, rebal = 0 }) {
  const comeco = Math.max(ini, ...ativos.map((a) => a.s.d[0]));
  const ultimos = ativos.map((a) => a.s.d[a.s.d.length - 1]);
  const termino = Math.min(fim, ...ultimos);
  const dias = [];
  for (let x = comeco; x <= termino; x++) if (ehUtil(x)) dias.push(x);
  if (dias.length < 3) return null;
  const n = ativos.length, T = dias.length;
  const niveis = ativos.map((a) => Float64Array.from(dias, (x) => nivelAsof(a.s, x)));
  let pos = pesos.slice(), total = 1;
  const ganho = new Float64Array(n), valor = new Float64Array(T);
  valor[0] = 1;
  const mesDe = (x) => { const [a, m] = partes(x); return a * 12 + m - 1; };
  for (let t = 1; t < T; t++) {
    for (let k = 0; k < n; k++) {
      const r = niveis[k][t] / niveis[k][t - 1] - 1;
      const g = pos[k] * r; ganho[k] += g; pos[k] += g;
    }
    total = pos.reduce((s, v) => s + v, 0);
    valor[t] = total;
    // rebalanceia no último dia útil do mês de rebalanceamento (mensal, trimestral = mar/jun/set/dez, etc.)
    if (rebal && t < T - 1 && mesDe(dias[t + 1]) !== mesDe(dias[t]) && (mesDe(dias[t]) % 12 + 1) % rebal === 0) pos = pesos.map((w) => w * total);
  }
  const porAtivo = niveis.map((L) => Float64Array.from(L, (v) => v / L[0]));
  return { dias, valor, contrib: Array.from(ganho), porAtivo, cortadoIni: comeco > ini, cortadoFim: termino < fim,
    limitante: termino < fim ? ativos[ultimos.indexOf(termino)].nome : null };
}

/** Estatísticas de uma série de valores diários (base qualquer). cdiAnual: CDI anualizado no mesmo período (para o Sharpe). */
export function estatisticas(dias, v, cdiAnual = null) {
  const T = v.length; if (T < 3) return null;
  const total = v[T - 1] / v[0] - 1, du = diasUteis(dias[0], dias[T - 1]);
  const anual = du > 0 ? (1 + total) ** (252 / du) - 1 : null;
  const lr = []; for (let t = 1; t < T; t++) lr.push(Math.log(v[t] / v[t - 1]));
  const m = lr.reduce((s, x) => s + x, 0) / lr.length;
  const vol = Math.sqrt(lr.reduce((s, x) => s + (x - m) ** 2, 0) / (lr.length - 1)) * Math.sqrt(252);
  let pico = v[0], mdd = 0;
  for (let t = 0; t < T; t++) { pico = Math.max(pico, v[t]); mdd = Math.min(mdd, v[t] / pico - 1); }
  // retornos mensais (do último dia do mês anterior ao último dia do mês)
  const mens = []; let base = v[0];
  for (let t = 1; t < T; t++) {
    const fimMes = t === T - 1 || partes(dias[t + 1])[1] !== partes(dias[t])[1];
    if (fimMes) { mens.push(v[t] / base - 1); base = v[t]; }
  }
  return { total, anual, vol, mdd, sharpe: vol > 0 && cdiAnual != null && anual != null ? (anual - cdiAnual) / vol : null,
    melhorMes: mens.length ? Math.max(...mens) : null, piorMes: mens.length ? Math.min(...mens) : null,
    mesesPos: mens.length ? mens.filter((x) => x > 0).length / mens.length : null, nMeses: mens.length };
}

export function curvaDrawdown(v) { let p = -Infinity; return Array.from(v, (x) => { p = Math.max(p, x); return x / p - 1; }); }
