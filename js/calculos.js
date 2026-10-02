// Cálculos das métricas (tradução do calculos.py / macro inicioTudo do VBA).
// Datas são representadas como número de dias desde 01/01/1970 (UTC) para ficar rápido.

export const PERIODOS = ["Mês", "Ano", "3 Meses", "12 Meses", "24 Meses", "36 Meses", "Vida Toda", "Personalizado"];
const MESES_PERIODO = { "3 Meses": 3, "12 Meses": 12, "24 Meses": 24, "36 Meses": 36 };
const NORMINV_95 = 1.6448536269514722;
const RAIZ_252 = Math.sqrt(252);
const DIA = 86400000;

// (grupo, nome, tipo) na ordem da planilha "Início"
export const COLUNAS = [
  ["Fundo", "Fundo", "txt"], ["Fundo", "CNPJ", "txt"], ["Cadastro", "Classificação CVM", "txt"],
  ["Cadastro", "Classificação ANBIMA", "txt"],
  ["Data", "Data Inicial", "data"], ["Data", "Data Final", "data"],
  ["Cotas", "Cota Inicial", "num"], ["Cotas", "Cota Final", "num"],
  ["Captação", "Captação Líquida no Período", "valor"],
  ["Objetivo", "Objetivo de retorno", "txt"],
  ["Rentabilidade", "% Acumulado", "pct"], ["Rentabilidade", "% Anualizado", "pct"],
  ["Rentabilidade", "%CDI", "pct"], ["Rentabilidade", "CDI +", "pct"],
  ["Rentabilidade", "% de dias acima do CDI", "pct"],
  ["VaR", "VaR Histórico", "pct"], ["VaR", "VaR Normal (1 dia 95%)", "pct"], ["VaR", "No. de estouros", "int"],
  ["Risco", "Volatilidade", "pct"], ["Risco", "Sharpe Anualizado", "num"], ["Risco", "yRoa", "num"],
  ["MDD", "Queda", "pct"], ["MDD", "Poço", "num"], ["MDD", "Data Poço", "data"],
  ["MDD", "Máxima anterior", "num"], ["MDD", "Data da máxima anterior", "data"],
  ["MDD", "% recuperado até hoje", "pct"], ["MDD", "Quando recuperou", "txt"],
  ["MDD", "Duração Total", "int"], ["MDD", "Duração da Queda", "int"], ["MDD", "Duração da Recuperação", "int"],
  ["MDD", "MDD/VOL", "num"],
  ["Underwater", "Valor Atual", "pct"], ["Underwater", "Dias em Underwater Atual", "int"],
  ["Underwater", "Maior Período em Dias Underwater", "int"],
  ["Underwater", "Data de Saída do Maior Período", "txt"],
  ["Underwater", "Períodos 21d-30d", "int"], ["Underwater", "Períodos 31d-60d", "int"],
  ["Underwater", "Períodos 61d-90d", "int"], ["Underwater", "Períodos 91d-120d", "int"],
  ["Underwater", "Períodos acima de 120d", "int"],
  ["IBOV", "Beta", "num"], ["IBOV", "IBOV +", "pct"], ["IBOV", "% de dias acima do IBOV", "pct"],
  ["Outras", "Var Diária Ponderada", "pct"], ["Outras", "Sortino", "num"], ["Outras", "Índice de Dor", "pct"],
];

// ----------------------------------------------------------------------------- datas
export const diaDe = (d) => Math.floor(d.getTime() / DIA);                 // Date -> dia
export const dataDe = (n) => new Date(n * DIA);                            // dia -> Date (UTC)
export const diaYMD = (a, m, d) => Math.floor(Date.UTC(a, m - 1, d) / DIA);
export function partes(n) { const d = dataDe(n); return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]; }

// igual ao DateSerial do VBA: dia que não existe no mês "transborda" (31/05 - 3m = 03/03)
export function somarMeses(n, meses) {
  const [a, m, d] = partes(n);
  const total = a * 12 + (m - 1) + meses;
  return diaYMD(Math.floor(total / 12), (total % 12 + 12) % 12 + 1, 1) + (d - 1);
}
const fimDoMes = (n) => { const [a, m] = partes(n); return somarMeses(diaYMD(a, m, 1), 1) - 1; };

// primeiro índice com d[i] >= x  /  primeiro índice com d[i] > x
export function lowerBound(arr, x) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; } return lo; }
export function upperBound(arr, x) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= x) lo = m + 1; else hi = m; } return lo; }

export function janela(d, periodo, { ref, ini, fim } = {}) {
  if (!d.length) return null;
  let limIni, limFim;
  if (periodo === "Mês") { const [a, m] = partes(ref); limIni = diaYMD(a, m, 1); limFim = fimDoMes(ref); }
  else if (periodo === "Ano") { const [a] = partes(ref); limIni = diaYMD(a, 1, 1); limFim = diaYMD(a, 12, 31); }
  else if (MESES_PERIODO[periodo]) { limFim = d[d.length - 1]; limIni = somarMeses(limFim, -MESES_PERIODO[periodo]); }
  else if (periodo === "Vida Toda") { limIni = d[0]; limFim = d[d.length - 1]; }
  else { limIni = ini; limFim = fim; }
  const iIni = lowerBound(d, limIni), iFim = upperBound(d, limFim) - 1;
  if (iIni >= d.length || iFim < 0 || iIni > iFim) return null;
  return [iIni, iFim];
}

// ----------------------------------------------------------------------------- estatística (iguais ao Excel)
function stdevS(x) {
  const v = x.filter((a) => a != null && !Number.isNaN(a));
  if (v.length < 2) return null;
  const m = v.reduce((s, a) => s + a, 0) / v.length;
  return Math.sqrt(v.reduce((s, a) => s + (a - m) ** 2, 0) / (v.length - 1));
}
function media(x) { const v = x.filter((a) => a != null && !Number.isNaN(a)); return v.reduce((s, a) => s + a, 0) / v.length; }
function percentileExc(x, p) {
  const v = x.filter((a) => a != null && !Number.isNaN(a)).sort((a, b) => a - b);
  const h = p * (v.length + 1);
  if (h < 1 || h > v.length) return null;
  const lo = Math.floor(h);
  if (lo === v.length) return v[v.length - 1];
  return v[lo - 1] + (h - lo) * (v[lo] - v[lo - 1]);
}
const fin = (v) => (v == null || Number.isNaN(v) || !Number.isFinite(v) ? null : v);

// ----------------------------------------------------------------------------- colunas derivadas
// Mesmas regras do script de atualização (SQL_METRICAS): 1ª cota do fundo tem Quota Anterior 0, variação 0 etc.
// cdiAnterior: Map dia -> CDI do dia ANTERIOR da série (regra do VBA).
export function prepararFundo(linhas, cdiAnterior) {
  const n = linhas.length;
  const f = { d: new Int32Array(n), q: new Float64Array(n), capt: new Float64Array(n), resg: new Float64Array(n),
    pl: new Float64Array(n), cot: new Float64Array(n), qa: new Float64Array(n), vari: new Float64Array(n),
    ln: new Float64Array(n), neg: new Float64Array(n), cdi: new Float64Array(n), rel: new Int8Array(n) };
  for (let i = 0; i < n; i++) {
    const r = linhas[i];
    f.d[i] = r.d; f.q[i] = r.q; f.capt[i] = r.capt ?? 0; f.resg[i] = r.resg ?? 0; f.pl[i] = r.pl ?? NaN; f.cot[i] = r.cot ?? NaN;
    const cdi = cdiAnterior.get(r.d);
    f.cdi[i] = cdi == null ? NaN : cdi;
    if (i === 0) { f.qa[i] = 0; f.vari[i] = 0; f.ln[i] = 0; f.neg[i] = 0; f.rel[i] = 0; continue; }
    const qa = f.q[i - 1];
    f.qa[i] = qa;
    const v = f.q[i] / qa - 1;
    f.vari[i] = v;
    f.ln[i] = f.q[i] / qa > 0 ? Math.log(f.q[i] / qa) : NaN;
    f.neg[i] = v < 0 ? v : NaN;
    if (cdi == null || !(cdi > -100)) { f.rel[i] = 0; continue; }
    f.rel[i] = Math.exp(Math.log(1 + cdi / 100) / 252) - 1 > v ? -1 : 1;     // -1 menor, 1 maior que o CDI
  }
  return f;
}

// ----------------------------------------------------------------------------- cálculo principal
export function calcularFundo(f, ibov, periodo, pesoTotal = 1, opc = {}) {
  const jan = janela(f.d, periodo, opc);
  if (!jan) return null;
  const [a0, a1] = jan;
  const nSub = a1 - a0 + 1;
  const q = f.q.subarray(a0, a1 + 1), qa = f.qa.subarray(a0, a1 + 1), vari = Array.from(f.vari.subarray(a0, a1 + 1));
  const ln = Array.from(f.ln.subarray(a0, a1 + 1)), neg = Array.from(f.neg.subarray(a0, a1 + 1)), d = f.d.subarray(a0, a1 + 1);
  const r = { "Data Inicial": f.d[a0], "Data Final": f.d[a1] };

  r["VaR Histórico"] = nSub > 19 ? percentileExc(vari, 0.05) : 0;
  const dpVar = stdevS(vari);
  const varNormal = nSub > 1 && dpVar != null ? media(vari) - dpVar * NORMINV_95 : 0;
  r["VaR Normal (1 dia 95%)"] = varNormal;

  let k0 = -1;
  for (let i = 0; i < nSub; i++) if (qa[i] !== 0) { k0 = i; break; }
  if (k0 < 0) return null;
  const primeira = qa[k0], n = nSub - k0;
  r["Cota Inicial"] = primeira; r["Cota Final"] = q[nSub - 1];

  let capt = 0, acumCdi = 1, acima = 0, estouros = 0;
  for (let i = k0; i < nSub; i++) {
    capt += f.capt[a0 + i] - f.resg[a0 + i];
    const c = f.cdi[a0 + i];
    if (!Number.isNaN(c)) acumCdi *= Math.round(((c / 100 + 1) ** (1 / 252)) * 1e8) / 1e8;
    if (f.rel[a0 + i] === 1) acima++;
    if (vari[i] <= varNormal) estouros++;
  }
  r["Captação Líquida no Período"] = capt;
  r["% de dias acima do CDI"] = acima / n;
  r["No. de estouros"] = estouros;

  const ret = q[nSub - 1] / primeira;
  r["% Acumulado"] = ret - 1;
  r["% Anualizado"] = ret ** (252 / n) - 1;
  r["%CDI"] = acumCdi !== 1 ? (ret - 1) / (acumCdi - 1) : null;
  const cdiMais = ret ** (252 / n) - acumCdi ** (252 / n);
  r["CDI +"] = cdiMais;

  const dpLn = stdevS(ln);
  const vol = dpLn ? dpLn * RAIZ_252 : null;
  r["Volatilidade"] = vol;
  r["Sharpe Anualizado"] = vol ? cdiMais / vol : null;
  const dpNeg = stdevS(neg);
  r["Sortino"] = dpNeg ? cdiMais / (dpNeg * RAIZ_252) : null;

  // MDD e Var Diária Ponderada
  let maior = q[0], dMaior = d[0], mdd = 0, poco = null, dPoco = null, pico = null, dPico = null;
  const passo = pesoTotal / ((n + 1) * (n / 2));
  let peso = passo, ponderada = 0;
  for (let i = 0; i < nSub; i++) {
    if (q[i] > maior) { maior = q[i]; dMaior = d[i]; }
    else if (q[i] / maior - 1 < mdd) { mdd = q[i] / maior - 1; poco = q[i]; dPoco = d[i]; pico = maior; dPico = dMaior; }
    const v = Number.isNaN(vari[i]) ? 0 : vari[i];
    ponderada = (ponderada + 1) * (1 + v * peso) - 1;
    peso += passo;
  }
  r["Var Diária Ponderada"] = ponderada;
  r["Queda"] = mdd; r["Poço"] = poco; r["Data Poço"] = dPoco;
  r["Máxima anterior"] = pico; r["Data da máxima anterior"] = dPico;
  r["% recuperado até hoje"] = poco ? q[nSub - 1] / poco - 1 : null;

  if (poco != null) {
    let cont = 0, recup = 0, quando = null, total = null;
    for (let i = 0; i < nSub; i++) {
      if (d[i] > dPico) {
        if (q[i] > pico) { total = cont; quando = d[i]; break; }
        else if (d[i] > dPoco) recup++;
        cont++;
      }
    }
    if (total == null) { quando = "Não Recuperou"; total = cont; }
    r["Quando recuperou"] = typeof quando === "number" ? fmtData(quando) : quando;
    r["Duração Total"] = total; r["Duração da Recuperação"] = recup; r["Duração da Queda"] = total - recup;
  }
  r["MDD/VOL"] = vol ? -mdd / vol : null;
  r["yRoa"] = mdd ? cdiMais / -mdd : null;

  // Underwater e Índice de Dor
  const faixas = [0, 0, 0, 0, 0];
  const classificar = (dias) => {
    if (dias > 20 && dias <= 30) faixas[0]++;
    else if (dias > 30 && dias <= 60) faixas[1]++;
    else if (dias > 60 && dias <= 90) faixas[2]++;
    else if (dias > 90 && dias <= 120) faixas[3]++;      // no VBA esta linha testava a coluna errada (37)
    else if (dias > 120) faixas[4]++;
  };
  maior = q[0];
  let ddAtual = 0, diasAtual = 0, maiorPeriodo = 0, aux = 0, saida = null, somaDd = 0;
  for (let i = 0; i < nSub; i++) {
    if (q[i] >= maior) { classificar(diasAtual); maior = q[i]; ddAtual = 0; diasAtual = 0; }
    else { ddAtual = q[i] / maior - 1; diasAtual++; somaDd += ddAtual; }
    maiorPeriodo = Math.max(maiorPeriodo, diasAtual);
    if (diasAtual === 0 && maiorPeriodo > aux) { aux = maiorPeriodo; saida = fmtData(d[i]); }
  }
  if (maiorPeriodo > aux) saida = "Está no maior Período";
  classificar(diasAtual);
  r["Valor Atual"] = ddAtual; r["Dias em Underwater Atual"] = diasAtual;
  r["Maior Período em Dias Underwater"] = maiorPeriodo; r["Data de Saída do Maior Período"] = saida;
  ["Períodos 21d-30d", "Períodos 31d-60d", "Períodos 61d-90d", "Períodos 91d-120d", "Períodos acima de 120d"]
    .forEach((k, i) => (r[k] = faixas[i]));
  r["Índice de Dor"] = -somaDd / nSub;

  // IBOV
  if (ibov && ibov.d.length) {
    const ia = upperBound(ibov.d, f.d[a1]) - 1, ib = lowerBound(ibov.d, f.d[a0]) - 1;
    if (ia >= 0 && ib >= 0 && ia > ib) r["IBOV +"] = r["% Anualizado"] - ((ibov.v[ia] / ibov.v[ib]) ** (252 / (ia - ib)) - 1);
    const fq = [], iv = [];
    for (let i = 0; i < nSub; i++) {
      const k = lowerBound(ibov.d, d[i]);
      if (k < ibov.d.length && ibov.d[k] === d[i]) { fq.push(q[i]); iv.push(ibov.v[k]); }
    }
    if (fq.length > 2) {
      const rf = [], ri = [];
      for (let i = 1; i < fq.length; i++) { rf.push(fq[i] / fq[i - 1] - 1); ri.push(iv[i] / iv[i - 1] - 1); }
      const mf = media(rf), mi = media(ri);
      let cov = 0, vi = 0, acimaI = 0;
      for (let i = 0; i < rf.length; i++) { cov += (rf[i] - mf) * (ri[i] - mi); vi += (ri[i] - mi) ** 2; if (rf[i] > ri[i]) acimaI++; }
      r["Beta"] = vi ? cov / vi : null;
      r["% de dias acima do IBOV"] = acimaI / rf.length;
    } else r["Beta"] = "Intervalo muito curto para calcular o beta";
  }
  for (const k in r) if (typeof r[k] === "number" && !k.startsWith("Data")) r[k] = fin(r[k]);
  return r;
}

// rentabilidade acumulada e drawdown diários (gráficos)
export function serieAcumulada(f, dIni, dFim) {
  const i0 = lowerBound(f.d, dIni), i1 = upperBound(f.d, dFim) - 1;
  let base = null;
  for (let i = i0; i <= i1; i++) if (f.qa[i] !== 0) { base = f.qa[i]; break; }
  if (base == null) base = f.q[i0];
  const d = [], acum = [], dd = [];
  let maxQ = -Infinity;
  for (let i = i0; i <= i1; i++) {
    maxQ = Math.max(maxQ, f.q[i]);
    d.push(f.d[i]); acum.push(f.q[i] / base - 1); dd.push(f.q[i] / maxQ - 1);
  }
  return { d, acum, dd };
}

export const fmtData = (n) => { if (n == null) return ""; const [a, m, d] = partes(n); return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${a}`; };
