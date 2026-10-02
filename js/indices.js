// Índices de comparação (CDI, IBOV, Selic, IPCA, IGP-M, dólar, S&P 500) e calendário de dias úteis ANBIMA.
// Cada índice vira uma série de "nível" diário (L): o retorno entre duas datas é L(fim) / L(início) - 1.
import { diaYMD, partes, lowerBound, upperBound } from "./calculos.js";

// ---------------------------------------------------------------------------- catálogo
// tipo: taxa (% a.a. base 252, acumula como o CDI) | preco (fechamento) | mensal (variação % do mês)
export const INDICES = {
  CDI:      { nome: "CDI", tipo: "taxa", cor: ["#000000", "#e6e9f7"] },
  IBOV:     { nome: "IBOV", tipo: "preco", cor: ["#7f7f7f", "#a9b0c8"] },
  SELIC:    { nome: "Selic", tipo: "taxa", cor: ["#6b4f1d", "#d9b77a"] },
  IPCA:     { nome: "IPCA", tipo: "mensal", cor: ["#b3202c", "#ff8a8a"] },
  IGPM:     { nome: "IGP-M", tipo: "mensal", cor: ["#7a4bc4", "#b99bff"] },
  DOLAR:    { nome: "Dólar", tipo: "preco", cor: ["#0c8a4e", "#3ddc97"] },
  SP500:    { nome: "S&P 500 (US$)", tipo: "preco", cor: ["#e07b24", "#ffa94d"] },
  SP500BRL: { nome: "S&P 500 (R$)", tipo: "preco", cor: ["#1596d3", "#4fd1ff"] },
};
export const ORDEM_INDICES = Object.keys(INDICES);
const escuro = () => matchMedia("(prefers-color-scheme: dark)").matches;
export const corIndice = (k) => (INDICES[k]?.cor[escuro() ? 1 : 0]) || "#888";
export const nomeIndice = (k) => INDICES[k]?.nome || k;
export const chaveIndice = (nome) => ORDEM_INDICES.find((k) => INDICES[k].nome === nome) || null;

// ---------------------------------------------------------------------------- calendário ANBIMA
function pascoa(a) {
  const b = a % 19, c = Math.floor(a / 100), d = a % 100, e = Math.floor(c / 4), f = c % 4, g = Math.floor((c + 8) / 25),
    h = Math.floor((c - g + 1) / 3), i = (19 * b + c - e - h + 15) % 30, k = Math.floor(d / 4), l = d % 4,
    m = (32 + 2 * f + 2 * k - i - l) % 7, n = Math.floor((b + 11 * i + 22 * m) / 451),
    mes = Math.floor((i + m - 7 * n + 114) / 31), dia = ((i + m - 7 * n + 114) % 31) + 1;
  return diaYMD(a, mes, dia);
}
const CAL_INI = diaYMD(1999, 1, 1), CAL_FIM = diaYMD(2055, 12, 31);
const UTIL = new Uint8Array(CAL_FIM - CAL_INI + 1), ACUM = new Int32Array(CAL_FIM - CAL_INI + 1);
(function montarCalendario() {
  const fer = new Set();
  for (let a = 1999; a <= 2055; a++) {
    [[1, 1], [4, 21], [5, 1], [9, 7], [10, 12], [11, 2], [11, 15], [12, 25]].forEach(([m, d]) => fer.add(diaYMD(a, m, d)));
    if (a >= 2024) fer.add(diaYMD(a, 11, 20));                        // Consciência Negra
    const p = pascoa(a);
    [p - 48, p - 47, p - 2, p + 60].forEach((x) => fer.add(x));        // carnaval, sexta-feira santa, Corpus Christi
  }
  let s = 0;
  for (let x = CAL_INI; x <= CAL_FIM; x++) {
    const sem = (x + 4) % 7;                                           // 01/01/1970 foi quinta-feira (0 = domingo)
    const u = sem !== 0 && sem !== 6 && !fer.has(x) ? 1 : 0;
    UTIL[x - CAL_INI] = u; s += u; ACUM[x - CAL_INI] = s;
  }
})();
const lim = (x) => Math.min(Math.max(x, CAL_INI), CAL_FIM);
export const ehUtil = (x) => UTIL[lim(x) - CAL_INI] === 1;
/** Dias úteis entre as datas: conta o fim, não conta o início (igual ao calculos.py). */
export const diasUteis = (a, b) => ACUM[lim(b) - CAL_INI] - ACUM[lim(a) - CAL_INI];

// ---------------------------------------------------------------------------- montagem
/** linhas: registros do indices.parquet já convertidos { INDICE, dia, VALOR }. */
export function montarIndices(linhas) {
  const bruto = {};
  for (const r of linhas) (bruto[r.INDICE] ||= []).push(r);
  const serie = (k) => {
    const v = (bruto[k] || []).sort((a, b) => a.dia - b.dia);
    return { d: Int32Array.from(v.map((r) => r.dia)), v: Float64Array.from(v.map((r) => r.VALOR)) };
  };
  const series = {}, niveis = {};
  for (const k of ORDEM_INDICES) if (k !== "SP500BRL") series[k] = serie(k);

  for (const k of Object.keys(series)) {
    const s = series[k], tipo = INDICES[k].tipo;
    if (!s.d.length) continue;
    if (tipo === "preco") niveis[k] = { d: s.d, L: s.v };
    else if (tipo === "taxa") {                     // fator diário com a taxa do dia ANTERIOR (regra do VBA)
      const L = new Float64Array(s.d.length); L[0] = 1;
      for (let i = 1; i < L.length; i++) L[i] = L[i - 1] * (1 + s.v[i - 1] / 100) ** (1 / 252);
      niveis[k] = { d: s.d, L };
    } else niveis[k] = mensalParaDiario(s);
  }
  // S&P 500 em reais: fechamento em US$ × dólar PTAX do mesmo dia (ou do anterior disponível)
  if (niveis.SP500 && niveis.DOLAR) {
    const sp = niveis.SP500, dl = niveis.DOLAR, d = [], L = [];
    for (let i = 0; i < sp.d.length; i++) {
      const k = upperBound(dl.d, sp.d[i]) - 1;
      if (k >= 0) { d.push(sp.d[i]); L.push(sp.L[i] * dl.L[k]); }
    }
    if (d.length) niveis.SP500BRL = { d: Int32Array.from(d), L: Float64Array.from(L) };
  }
  const cdi = series.CDI, cdiAnterior = new Map();     // CDI do dia ANTERIOR da série (regra do VBA)
  for (let i = 1; i < cdi.d.length; i++) cdiAnterior.set(cdi.d[i], cdi.v[i - 1]);
  return { cdi, ibov: series.IBOV, cdiAnterior, niveis, disponiveis: ORDEM_INDICES.filter((k) => niveis[k]) };
}

// Inflação mensal -> nível diário: a variação do mês é distribuída pelos dias úteis do mês (pro rata, composta)
function mensalParaDiario(s) {
  const d = [], L = [];
  let nivel = 1;
  for (let i = 0; i < s.d.length; i++) {
    const [a, m] = partes(s.d[i]);
    const ini = diaYMD(a, m, 1), fim = diaYMD(m === 12 ? a + 1 : a, m === 12 ? 1 : m + 1, 1) - 1;
    const uteis = []; for (let x = ini; x <= fim; x++) if (ehUtil(x)) uteis.push(x);
    if (!uteis.length) continue;
    if (!d.length) { let x = ini - 1; while (!ehUtil(x)) x--; d.push(x); L.push(1); }   // ponto de partida
    const f = 1 + s.v[i] / 100;
    uteis.forEach((x, k) => { d.push(x); L.push(nivel * f ** ((k + 1) / uteis.length)); });
    nivel *= f;
  }
  return { d: Int32Array.from(d), L: Float64Array.from(L) };
}

// ---------------------------------------------------------------------------- consultas
/** Nível na data (ou no último dia disponível antes dela); null se a data é anterior ao início da série. */
export function nivelEm(idx, k, dia) {
  const n = idx.niveis[k]; if (!n) return null;
  const i = upperBound(n.d, dia) - 1;
  return i >= 0 ? n.L[i] : null;
}
export const ultimoDia = (idx, k) => { const n = idx.niveis[k]; return n && n.d.length ? n.d[n.d.length - 1] : null; };

/** Retorno acumulado diário de dIni a dFim, com base no dia anterior a dIni (mesma regra das cotas dos fundos). */
export function serieIndice(idx, k, dIni, dFim) {
  const n = idx.niveis[k]; if (!n) return null;
  let base = nivelEm(idx, k, dIni - 1);
  const i0 = lowerBound(n.d, dIni), i1 = upperBound(n.d, dFim) - 1;
  if (i1 < i0) return null;
  if (base == null) base = n.L[i0];
  const x = [], y = [];
  for (let i = i0; i <= i1; i++) { x.push(n.d[i]); y.push(n.L[i] / base - 1); }
  return { x, y };
}

/** Retorno anualizado (dias úteis ANBIMA) e volatilidade anualizada (log-retornos × √252) entre as datas. */
export function retornoVol(idx, k, dIni, dFim) {
  const n = idx.niveis[k]; if (!n) return null;
  const j0 = upperBound(n.d, dIni - 1) - 1, i1 = upperBound(n.d, dFim) - 1;
  const ini = j0 >= 0 ? j0 : lowerBound(n.d, dIni);
  if (i1 - ini < 2) return null;
  const du = diasUteis(n.d[ini], n.d[i1]);
  if (du <= 0) return null;
  const lr = [];
  for (let i = ini + 1; i <= i1; i++) if (n.d[i] !== n.d[i - 1]) lr.push(Math.log(n.L[i] / n.L[i - 1]));
  const m = lr.reduce((s, v) => s + v, 0) / lr.length;
  const dp = Math.sqrt(lr.reduce((s, v) => s + (v - m) ** 2, 0) / (lr.length - 1));
  return { ret: (n.L[i1] / n.L[ini]) ** (252 / du) - 1, vol: dp * Math.sqrt(252), fim: n.d[i1] };
}

/** Retornos diários (dia -> retorno) entre as datas, para a correlação. */
export function retornosDiarios(idx, k, dIni, dFim) {
  const n = idx.niveis[k], out = new Map(); if (!n) return out;
  const i0 = Math.max(1, lowerBound(n.d, dIni)), i1 = upperBound(n.d, dFim) - 1;
  for (let i = i0; i <= i1; i++) out.set(n.d[i], n.L[i] / n.L[i - 1] - 1);
  return out;
}
