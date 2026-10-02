// Etapa 3: janela móvel (GraficoMediaMovel do VBA, com dias úteis ANBIMA) e correlação.
import { somarMeses, lowerBound, upperBound } from "./calculos.js";
import { diasUteis, nivelEm, retornosDiarios } from "./indices.js";

/**
 * Para cada data de aplicação >= ini, o retorno de ficar `meses` meses investido no fundo.
 * fim: nenhuma janela passa desta data ("Intervalo de Análise" do macro).
 * bench: "CDI" (CDI do próprio fundo, sem arredondar, como o Acumulado CDI do Access), "" (nenhum)
 *        ou a chave de outro índice (nível do índice entre as mesmas datas).
 * Devolve linhas { ini, fim, du, linhas, ret, retAA, benchAA, dif }.
 */
export function janelaMovel(f, idx, { meses, ini, fim, bench }) {
  const ult = upperBound(f.d, fim) - 1;
  if (ult < 1) return [];
  let fc = null;
  if (bench === "CDI") {
    fc = new Float64Array(f.d.length);
    let a = 1;
    for (let i = 0; i < f.d.length; i++) { const c = f.cdi[i]; if (!Number.isNaN(c)) a *= (1 + c / 100) ** (1 / 252); fc[i] = a; }
  }
  const out = [];
  for (let i = lowerBound(f.d, ini); i < ult; i++) {
    const alvo = somarMeses(f.d[i], meses);
    if (alvo > f.d[ult]) break;
    const j = lowerBound(f.d, alvo);                       // 1º dia com cota >= data-alvo
    const du = diasUteis(f.d[i], f.d[j]);
    if (du <= 0 || j <= i) continue;
    const ret = f.q[j] / f.q[i], retAA = ret ** (252 / du) - 1;
    let b = 0;
    if (bench === "CDI") b = (fc[j] / fc[i]) ** (252 / du) - 1;
    else if (bench) {
      const l0 = nivelEm(idx, bench, f.d[i]), l1 = nivelEm(idx, bench, f.d[j]);
      if (!(l0 && l1 && f.d[j] <= ultimoValido(idx, bench))) continue;   // índice ainda sem dado no fim da janela (ex.: IPCA do mês)
      b = (l1 / l0) ** (252 / du) - 1;
    }
    out.push({ ini: f.d[i], fim: f.d[j], du, linhas: j - i, ret: ret - 1, retAA, benchAA: b, dif: b == null ? null : retAA - b });
  }
  return out;
}
const ultimoValido = (idx, k) => { const n = idx.niveis[k]; return n ? n.d[n.d.length - 1] : -Infinity; };

/** Mínimo, mediana e máximo (ordenados pela diferença), contagens e consistência (regras do GraficoMediaMovel). */
export function resumoJanela(jm) {
  const ord = jm.filter((l) => l.dif != null).sort((a, b) => a.dif - b.dif);
  const n = ord.length;
  if (!n) return null;
  const r = {
    total: n, abaixo: ord.filter((l) => l.dif <= 0).length, acima: ord.filter((l) => l.dif > 0).length,
    negativas: ord.filter((l) => l.ret <= 0).length, positivas: ord.filter((l) => l.ret > 0).length,
  };
  r.pAcima = r.acima / n; r.pPositivas = r.positivas / n;
  const faixa = (l) => ({ data: l.ini, ret: l.ret, retAA: l.retAA, benchAA: l.benchAA, dif: l.dif });
  r.min = faixa(ord[0]); r.max = faixa(ord[n - 1]);
  if (n % 2) r.med = faixa(ord[(n - 1) / 2]);
  else {                                                    // par: média das duas do meio (sem data única)
    const a = ord[n / 2 - 1], b = ord[n / 2];
    r.med = { data: null, ret: (a.ret + b.ret) / 2, retAA: (a.retAA + b.retAA) / 2, benchAA: (a.benchAA + b.benchAA) / 2 };
    r.med.dif = r.med.retAA - r.med.benchAA;
  }
  r.primeira = jm[0].ini; r.ultima = jm[jm.length - 1].ini;
  return r;
}

/** Retornos diários de um fundo entre as datas (dia -> retorno). */
export function retornosFundo(f, dIni, dFim) {
  const out = new Map();
  const i0 = Math.max(1, lowerBound(f.d, dIni)), i1 = upperBound(f.d, dFim) - 1;
  for (let i = i0; i <= i1; i++) out.set(f.d[i], f.q[i] / f.q[i - 1] - 1);
  return out;
}
export { retornosDiarios };

/** Correlação de Pearson entre séries de retornos (Map dia -> retorno), só nos dias em comum; mínimo de 20 dias. */
export function matrizCorrelacao(series) {
  const n = series.length, m = Array.from({ length: n }, () => new Array(n).fill(null));
  for (let a = 0; a < n; a++) {
    m[a][a] = 1;
    for (let b = a + 1; b < n; b++) {
      const xa = [], xb = [];
      const [p, q] = series[a].size <= series[b].size ? [series[a], series[b]] : [series[b], series[a]];
      for (const [dia, v] of p) { const w = q.get(dia); if (w != null && Number.isFinite(v) && Number.isFinite(w)) { xa.push(v); xb.push(w); } }
      if (xa.length < 20) continue;
      const ma = xa.reduce((s, v) => s + v, 0) / xa.length, mb = xb.reduce((s, v) => s + v, 0) / xb.length;
      let sab = 0, saa = 0, sbb = 0;
      for (let i = 0; i < xa.length; i++) { const da = xa[i] - ma, db = xb[i] - mb; sab += da * db; saa += da * da; sbb += db * db; }
      const r = saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : null;
      m[a][b] = m[b][a] = r;
    }
  }
  return m;
}
