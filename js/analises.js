// Etapa 3: janela móvel (GraficoMediaMovel do VBA, com dias úteis ANBIMA) e correlação.
import { somarMeses, lowerBound, upperBound } from "./calculos.js";
import { diasUteis, nivelEm, retornosDiarios } from "./indices.js";

/**
 * Para cada data de aplicação >= ini, o retorno de ficar `meses` meses investido no fundo.
 * fim: nenhuma janela passa desta data ("Intervalo de Análise" do macro).
 * bench: "CDI" (CDI do próprio fundo, sem arredondar, como o Acumulado CDI do Access), "" (nenhum),
 *        a chave de outro índice (nível do índice entre as mesmas datas) ou { fundo } (cota de outro fundo).
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
    else if (bench && bench.fundo) {                       // outro fundo como benchmark: cota dele nas mesmas datas
      const g = bench.fundo, k0 = upperBound(g.d, f.d[i]) - 1, k1 = upperBound(g.d, f.d[j]) - 1;
      if (k0 < 0 || g.d[g.d.length - 1] < f.d[j]) continue;
      b = (g.q[k1] / g.q[k0]) ** (252 / du) - 1;
    }
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

/** Correlação de Pearson entre séries de retornos (Map dia -> retorno), só nos dias em comum; mínimo de 20 dias.
 *  Devolve Float64Array n×n (NaN = sem dias suficientes). */
export function matrizCorrelacao(series) {
  const n = series.length, dias = new Set();
  for (const s of series) for (const d of s.keys()) dias.add(d);
  const ord = [...dias].sort((a, b) => a - b), pos = new Map(ord.map((d, i) => [d, i])), T = ord.length;
  const M = new Float64Array(n * T).fill(NaN);
  series.forEach((s, a) => { for (const [d, v] of s) if (Number.isFinite(v)) M[a * T + pos.get(d)] = v; });
  const out = new Float64Array(n * n).fill(NaN);
  for (let a = 0; a < n; a++) {
    out[a * n + a] = 1;
    const oa = a * T;
    for (let b = a + 1; b < n; b++) {
      const ob = b * T;
      let k = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
      for (let t = 0; t < T; t++) {
        const x = M[oa + t], y = M[ob + t];
        if (x === x && y === y) { k++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; }
      }
      if (k < 20) continue;
      const cov = sxy - sx * sy / k, va = sxx - sx * sx / k, vb = syy - sy * sy / k;
      const r = va > 1e-30 && vb > 1e-30 ? Math.max(-1, Math.min(1, cov / Math.sqrt(va * vb))) : NaN;
      out[a * n + b] = out[b * n + a] = r;
    }
  }
  return out;
}
