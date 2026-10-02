// Análise de Fundos — página principal (etapa 2)
import Chart from "https://cdn.jsdelivr.net/npm/chart.js@4.5.1/auto/+esm";
import * as D from "./dados.js";
import { COLUNAS, PERIODOS, calcularFundo, serieAcumulada, fmtData, diaDe, diaYMD, partes, lowerBound, upperBound } from "./calculos.js";

// ============================== CONFIGURAÇÃO (único lugar para editar) ==============================
const HF_REPO = "Shote/fundos-cvm";
const DADOS_URL = `https://huggingface.co/datasets/${HF_REPO}/resolve/main/`;
// =====================================================================================================

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const nf = (c) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
const NF = [0, 1, 2, 4, 6].reduce((o, c) => ((o[c] = nf(c)), o), {});
const br = (v, c = 2) => (v == null || Number.isNaN(v) ? "" : NF[c].format(v));
const brPct = (v, c = 2) => (typeof v !== "number" || Number.isNaN(v) ? "" : br(v * 100, c) + "%");
const cnpjFmt = (c) => (c || "").replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
const curto = (s, n = 45) => (s.length <= n ? s : s.slice(0, n - 1) + "…");
const VERDE = "#0c8a4e", VERMELHO = "#d0262c", OURO = "#c9a23a", ANIL = "#2b2c78";
const COR_BENCH = { CDI: "#000000", IBOV: "#7f7f7f" };
const PALETA = ["#2E91E5", "#E15F99", "#1CA71C", "#FB0D0D", "#DA16FF", "#B68100", "#750D86", "#EB663B", "#511CFB",
  "#00A08B", "#FB00D1", "#FC0080", "#B2828D", "#6C7C32", "#778AAE", "#862A16", "#A777F1", "#620042", "#1616A7",
  "#DA60CA", "#6C4516", "#0D2A63", "#AF0038", "#AA0DFE", "#3283FE", "#85660D", "#782AB6", "#565656", "#1C8356",
  "#16FF32", "#F7E1A0", "#1CBE4F", "#C4451C", "#DEA0FD", "#FE00FA", "#325A9B", "#FEAF16", "#F8A19F", "#90AD1C",
  "#F6222E", "#1CFFCE", "#2ED9FF", "#B10DA1", "#C075A6", "#FC1CBF", "#B00068", "#FBE426", "#FA0087"];

const st = {
  meta: null, lista: [], porCnpj: new Map(), idx: null, sel: [], periodos: new Set(["12 Meses"]),
  res: null, perAtivo: null, zoom: {}, destaque: "", ordem: { col: "Ordem da seleção", desc: true },
  rel: { on: false, alvo: "CDI", modo: "dif" }, todos: {}, graficos: {},
};
const log = (t) => { const el = $("#log"); if (el) el.textContent = t; };

// ============================== inicialização ==============================
async function iniciar() {
  try {
    $("#status").innerHTML = "carregando…";
    st.meta = await D.iniciar(DADOS_URL);
    D.definirGrupos(st.meta.grupos, st.meta.formato);
    $("#status").innerHTML = `dados da CVM até<b>${fmtData(diaDe(new Date(st.meta.ultimo_dado)))}</b>
      <small>atualizado em ${st.meta.gerado_em.slice(8, 10)}/${st.meta.gerado_em.slice(5, 7)} ${st.meta.gerado_em.slice(11, 16)}</small>`;
    const [lista, idx] = await Promise.all([D.carregarLista(), D.carregarIndices()]);
    st.lista = lista; st.idx = idx;
    for (const f of lista) st.porCnpj.set(f.CNPJ, f);
    const ultimo = st.idx.cdi.d[st.idx.cdi.d.length - 1];
    const [a, m] = partes(ultimo);
    $("#refMes").value = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;   // mês anterior
    $("#refAno").value = a;
    $("#pIni").value = `${a - 3}-${String(m).padStart(2, "0")}-01`;
    $("#pFim").value = new Date(ultimo * 86400000).toISOString().slice(0, 10);
    const daUrl = new URLSearchParams(location.search).get("fundos");
    if (daUrl) adicionar(daUrl.split(",").map((c) => c.replace(/\D/g, "").padStart(14, "0")));
    $("#app").classList.remove("carregando");
    atualizarSidebar();
    atualizarEspaco();
  } catch (e) {
    $("#status").textContent = "erro ao carregar";
    log("ERRO: " + e.message);
    console.error(e);
  }
}

// ============================== seleção de fundos ==============================
function adicionar(cnpjs) {
  let ok = 0; const faltam = [];
  for (const c of cnpjs) {
    if (!st.porCnpj.has(c)) { faltam.push(c); continue; }
    if (!st.sel.includes(c)) { st.sel.push(c); ok++; }
  }
  atualizarSidebar();
  return { ok, faltam };
}
function remover(c) { st.sel = st.sel.filter((x) => x !== c); atualizarSidebar(); }

function buscar(texto, limite, filtroExtra) {
  const q = texto.trim().toUpperCase();
  if (q.length < 3) return [];
  const dig = q.replace(/\D/g, "");
  const out = [];
  for (const f of st.lista) {                    // a lista já vem ordenada por patrimônio (maiores primeiro)
    if ((f._busca.includes(q) || (dig.length >= 3 && f.CNPJ.includes(dig))) && (!filtroExtra || filtroExtra(f))) {
      out.push(f);
      if (out.length >= limite) break;
    }
  }
  return out;
}

function atualizarSidebar() {
  // resultados da busca rápida
  const caixa = $("#resBusca");
  const achados = buscar($("#busca").value, 8, (f) => !st.sel.includes(f.CNPJ));
  caixa.innerHTML = $("#busca").value.trim().length < 3 ? "" : achados.length
    ? achados.map((f) => `<button class="add" data-c="${f.CNPJ}" title="${esc(f.NOME)}">＋ ${esc(curto(f.NOME, 38))}<small>${cnpjFmt(f.CNPJ)}</small></button>`).join("")
    : `<p class="nota">Nada encontrado (ou já selecionado).</p>`;
  // selecionados
  $("#nSel").textContent = st.sel.length;
  $("#selecionados").innerHTML = st.sel.map((c) => `<span class="chip" title="${esc(st.porCnpj.get(c)?.NOME)}">
      ${esc(curto(st.porCnpj.get(c)?.NOME || c, 34))}<button data-rm="${c}" aria-label="remover">×</button></span>`).join("")
    || `<p class="nota">Nenhum fundo selecionado.</p>`;
  $("#limpar").hidden = !st.sel.length;
  // períodos
  $$("#periodos button").forEach((b) => b.setAttribute("aria-pressed", st.periodos.has(b.dataset.p)));
  $("#campoMes").hidden = !st.periodos.has("Mês");
  $("#campoAno").hidden = !st.periodos.has("Ano");
  $("#campoPers").hidden = !st.periodos.has("Personalizado");
  const pronto = st.sel.length && st.periodos.size && (!st.periodos.has("Personalizado") || ($("#pIni").value && $("#pFim").value));
  $("#calcular").disabled = !pronto;
  avisoDesatualizado();
}

function lerColagem() {
  const itens = $("#colar").value.split(/[\s;,]+/).map((s) => s.replace(/\D/g, "")).filter(Boolean).map((s) => s.padStart(14, "0"));
  const { ok, faltam } = adicionar(itens);
  $("#colar").value = "";
  $("#avisoColar").innerHTML = `<span class="ok">${ok} fundo(s) adicionado(s)</span>` +
    (faltam.length ? `<br><span class="neg">Não encontrados: ${faltam.map(cnpjFmt).join(", ")}</span>` : "");
}

// ---------- janela "Selecionar fundos"
const dlg = { sel: [] };
function abrirSeletor() { dlg.sel = []; $("#dlgBusca").value = ""; renderSeletor(); $("#seletor").showModal(); $("#dlgBusca").focus(); }
function renderSeletor() {
  const q = $("#dlgBusca").value.trim();
  const ativos = $("#dlgAtivos").checked;
  const limiteDia = st.idx.cdi.d[st.idx.cdi.d.length - 1] - 30;
  const filtro = (f) => !ativos || (f._dia && f._dia >= limiteDia);
  const linhas = q.length >= 3 ? buscar(q, 200, filtro) : st.lista.filter(filtro).slice(0, 200);
  $("#dlgInfo").textContent = (q.length >= 3 ? `${linhas.length}${linhas.length === 200 ? "+" : ""} fundo(s) encontrado(s)` : "Maiores fundos por patrimônio")
    + " · marque ✓ para selecionar (mostra até 200)";
  $("#dlgTabela").innerHTML = `<table class="tb"><thead><tr><th>✓</th><th class="t">Fundo</th><th>CNPJ</th><th>Classificação</th>
      <th>Gestor</th><th>Início</th><th>Última cota</th><th>Data da cota</th><th>12 meses</th><th>Desde a 1ª cota</th><th>PL (R$ mi)</th></tr></thead><tbody>
      ${linhas.map((f) => `<tr><td><input type="checkbox" data-c="${f.CNPJ}" ${dlg.sel.includes(f.CNPJ) || st.sel.includes(f.CNPJ) ? "checked" : ""} ${st.sel.includes(f.CNPJ) ? "disabled title='já selecionado'" : ""}></td>
        <td class="t">${esc(f.NOME)}</td><td>${cnpjFmt(f.CNPJ)}</td><td class="t">${esc(f.CLASSIFICACAO_ANBIMA || f.CLASSIFICACAO_CVM || "")}</td>
        <td class="t">${esc(f.GESTOR || "")}</td><td>${f.DATA_CONSTITUICAO ? esc(String(f.DATA_CONSTITUICAO).slice(0, 10).split("-").reverse().join("/")) : f.DATA_PRIMEIRA_COTA ? fmtData(diaDe(f.DATA_PRIMEIRA_COTA)) : ""}</td>
        <td>${br(f.VL_QUOTA, 6)}</td><td>${f._dia ? fmtData(f._dia) : ""}</td>
        <td style="${corSinal(f.RET_12M)}">${brPct(f.RET_12M)}</td><td style="${corSinal(f.ACUMULADO)}">${brPct(f.ACUMULADO)}</td>
        <td>${f.VL_PATRIM_LIQ != null ? br(f.VL_PATRIM_LIQ / 1e6, 1) : ""}</td></tr>`).join("")}</tbody></table>`;
  renderSelDialogo();
}
function renderSelDialogo() {
  $("#dlgSel").innerHTML = dlg.sel.map((c) => `<span class="chip">${esc(curto(st.porCnpj.get(c).NOME, 40))}<button data-dlgrm="${c}">×</button></span>`).join("")
    || `<p class="nota">Nenhum marcado ainda.</p>`;
  $("#dlgN").textContent = dlg.sel.length;
  $("#dlgAdd").textContent = `＋ Adicionar ${dlg.sel.length} fundo(s)`;
  $("#dlgAdd").disabled = !dlg.sel.length;
}

// ============================== cálculo ==============================
function apelidos(cnpjs) {
  const out = {}, usados = new Set();
  for (const c of cnpjs) {
    let n = curto(st.porCnpj.get(c)?.NOME || c);
    if (usados.has(n)) n = `${n} (${c.slice(8, 12)}-${c.slice(12)})`;
    usados.add(n); out[c] = n;
  }
  return out;
}
const paramsAtuais = () => JSON.stringify({ sel: st.sel, per: [...st.periodos], mes: $("#refMes").value, ano: $("#refAno").value,
  ini: $("#pIni").value, fim: $("#pFim").value, peso: $("#peso").value });

async function calcular() {
  const barra = $("#progresso");
  barra.hidden = false;
  const t0 = performance.now();
  const sel = [...st.sel];
  try {
    barra.firstElementChild.style.width = "5%";
    $("#progTxt").textContent = "baixando cotas…";
    const fundos = await D.carregarFundos(sel, st.idx.cdiAnterior, (feitos, total) => {
      barra.firstElementChild.style.width = `${5 + 75 * feitos / total}%`;
      $("#progTxt").textContent = `baixando cotas · ${feitos}/${total} arquivo(s)`;
    });
    $("#progTxt").textContent = "calculando…";
    await new Promise((r) => setTimeout(r, 0));
    const [ma, mm] = $("#refMes").value.split("-").map(Number);
    const opc = { ref: null, ini: diaDe(new Date($("#pIni").value)), fim: diaDe(new Date($("#pFim").value)) };
    const peso = Number($("#peso").value) / 100;
    const apel = apelidos(sel);
    const res = { apelidos: apel, fundos, periodos: {} };
    for (const per of PERIODOS.filter((p) => st.periodos.has(p))) {
      const ref = per === "Mês" ? diaYMD(ma, mm, 15) : per === "Ano" ? diaYMD(Number($("#refAno").value), 1, 1) : null;
      const linhas = [], semDados = [], series = new Map();
      for (const c of sel) {
        const f = fundos.get(c);
        const r = f ? calcularFundo(f, st.idx.ibov, per, peso, { ...opc, ref }) : null;
        if (!r) { semDados.push(c); continue; }
        const cad = st.porCnpj.get(c) || {};
        Object.assign(r, { _c: c, "Fundo": cad.NOME, "CNPJ": cnpjFmt(c), "Classificação CVM": cad.CLASSIFICACAO_CVM || "",
          "Classificação ANBIMA": cad.CLASSIFICACAO_ANBIMA || "", "Objetivo de retorno": cad.INDICADOR_DESEMPENHO || "N/D" });
        linhas.push(r);
        series.set(c, serieAcumulada(f, r["Data Inicial"], r["Data Final"]));
      }
      res.periodos[per] = { linhas, semDados, series };
    }
    st.res = res; st.params = paramsAtuais(); st.zoom = {};
    st.perAtivo = Object.keys(res.periodos)[0];
    const url = new URL(location.href); url.searchParams.set("fundos", sel.join(",")); history.replaceState(null, "", url);
    barra.firstElementChild.style.width = "100%";
    $("#progTxt").textContent = `pronto em ${br((performance.now() - t0) / 1000, 1)} s`;
    renderResultado();
    atualizarEspaco();
  } catch (e) {
    $("#progTxt").textContent = "erro: " + e.message;
    console.error(e);
  }
}
function avisoDesatualizado() {
  const el = $("#avisoMudou");
  if (el) el.hidden = !st.res || st.params === paramsAtuais();
}

// ============================== tabelas ==============================
function corSinal(v) { return typeof v === "number" && !Number.isNaN(v) ? (v > 0 ? `color:${VERDE}` : v < 0 ? `color:${VERMELHO}` : "") : ""; }
const FMT = {
  pct: (v) => brPct(v), num: (v) => (typeof v === "number" ? br(v, 4) : v ?? ""), valor: (v) => br(v, 2),
  int: (v) => (typeof v === "number" ? br(v, 0) : ""), data: (v) => (typeof v === "number" ? fmtData(v) : v ?? ""), txt: (v) => v ?? "",
};
const casa = (termo, ...textos) => {
  const t = termo.trim().toLowerCase(); if (!t) return false;
  const dig = t.replace(/\D/g, "");
  return textos.some((x) => { x = String(x ?? ""); return x.toLowerCase().includes(t) || (dig.length >= 4 && x.replace(/\D/g, "").includes(dig)); });
};

// tabela HTML: cabeçalho fixo, 1ª(s) colunas fixas, zebra, destaque e rolagem interna
function tabelaHTML({ colunas, linhas, fixas = 0, larguras = [260, 150], grupos = null, destacar = [], separadores = new Set(), altura = 460 }) {
  const esq = larguras.map((_, j) => larguras.slice(0, j).reduce((s, x) => s + x, 0));
  const fx = (j) => (j < fixas ? ` class="fx" style="left:${esq[j]}px;min-width:${larguras[j]}px;max-width:${larguras[j]}px"` : "");
  let h = `<div class="tb-wrap" style="max-height:${altura}px"><table class="tb"><thead>`;
  if (grupos) {
    h += "<tr>";
    for (let j = 0; j < colunas.length;) {
      if (j < fixas) { h += `<th class="g fx" style="left:${esq[j]}px">${j === 0 ? esc(grupos[0]) : ""}</th>`; j++; continue; }
      let k = j; while (k + 1 < colunas.length && grupos[k + 1] === grupos[j]) k++;
      h += `<th class="g" colspan="${k - j + 1}">${esc(grupos[j])}</th>`; j = k + 1;
    }
    h += `</tr><tr class="h2">`;
  } else h += "<tr>";
  colunas.forEach((c, j) => (h += `<th${fx(j)}>${esc(c.nome)}</th>`));
  h += "</tr></thead><tbody>";
  linhas.forEach((l, i) => {
    const cls = [destacar[i] ? "dest" : "", separadores.has(i) ? "sep" : ""].join(" ").trim();
    h += `<tr${cls ? ` class="${cls}"` : ""}>`;
    colunas.forEach((c, j) => {
      const v = l[c.chave];
      if (separadores.has(i)) { h += c.chave === "Fundo" ? `<td class="t">${esc(v)}</td>` : "<td></td>"; return; }
      const txt = c.html ? c.html(v, l) : esc((FMT[c.tipo] || FMT.txt)(v));
      const estilo = c.cor ? corSinal(v) : "";
      const alinh = c.tipo === "txt" || c.tipo === "data" || c.html ? " t" : "";
      if (j < fixas) h += `<td class="fx t" style="left:${esq[j]}px;min-width:${larguras[j]}px;max-width:${larguras[j]}px;${estilo}" title="${esc(v)}">${txt}</td>`;
      else h += `<td class="${alinh.trim()}" style="${estilo}">${txt}</td>`;
    });
    h += "</tr>";
  });
  return h + "</tbody></table></div>";
}

function tabelaMetricas(dados) {
  const colunas = COLUNAS.map(([g, n, t]) => ({ chave: n, nome: n, tipo: t, cor: t === "pct" }));
  const grupos = COLUNAS.map(([g]) => g);
  let linhas = [...dados.linhas];
  const { col, desc } = st.ordem;
  if (col !== "Ordem da seleção") {
    linhas.sort((a, b) => {
      const x = a[col], y = b[col];
      if (typeof x !== "number" && typeof y !== "number") return String(x ?? "").localeCompare(String(y ?? ""), "pt-BR") * (desc ? -1 : 1);
      if (typeof x !== "number") return 1; if (typeof y !== "number") return -1;
      return desc ? y - x : x - y;
    });
  }
  const dest = linhas.map((l) => casa(st.destaque, l.Fundo, l.CNPJ));
  return tabelaHTML({ colunas, linhas, fixas: 2, grupos, destacar: dest, altura: 520 });
}

// tabela-legenda: cor, posição, fundo e valores, do maior para o menor; 5 maiores + 5 menores (+ destacados)
function tabelaLegenda(chave, itens, colsValor) {
  const ord = [...itens].sort((a, b) => (b.Final ?? -Infinity) - (a.Final ?? -Infinity));
  ord.forEach((it, i) => (it["#"] = String(i + 1)));
  const todos = st.todos[chave];
  const marc = ord.map((it) => casa(st.destaque, it.Fundo));
  let vis = ord, seps = new Set();
  if (!todos && ord.length > 10) {
    vis = []; let ant = -1;
    ord.forEach((it, i) => {
      if (i < 5 || i >= ord.length - 5 || marc[i]) {
        if (i !== ant + 1) { seps.add(vis.length); vis.push({ Fundo: `⋯ ${i - ant - 1} no meio ⋯` }); }
        vis.push(it); ant = i;
      }
    });
  }
  const colunas = [{ chave: "#", nome: "#", tipo: "txt" },
    { chave: "Fundo", nome: "Fundo", html: (v, l) => `<span class="sw" style="background:${l.cor}"></span>${esc(v)}` },
    ...colsValor.map((c) => ({ chave: c, nome: c, tipo: "pct", cor: true }))];
  const dest = vis.map((it, i) => !seps.has(i) && casa(st.destaque, it.Fundo));
  return `<label class="tog"><input type="checkbox" data-todos="${chave}" ${todos ? "checked" : ""} ${ord.length <= 10 ? "disabled" : ""}>
      Mostrar todos (${ord.length})</label>` + tabelaHTML({ colunas, linhas: vis, destacar: dest, separadores: seps, altura: 420 });
}

// ============================== gráficos ==============================
const corTexto = () => getComputedStyle(document.body).getPropertyValue("--txt").trim() || "#333";
const linhaRef = { id: "linhaRef", afterDraw(ch, _a, o) {
  if (o?.y == null) return; const y = ch.scales.y.getPixelForValue(o.y); const { left, right } = ch.chartArea;
  const ctx = ch.ctx; ctx.save(); ctx.strokeStyle = ANIL; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); ctx.restore(); } };

function grafico(id, series, { fmtY = (v) => brPct(v, 1), ref = null, xMin, xMax } = {}) {
  st.graficos[id]?.destroy();
  const algum = series.some((s) => !s.bench && casa(st.destaque, s.nome));
  const datasets = series.map((s) => {
    const ativo = !algum || s.bench || casa(st.destaque, s.nome);
    const cor = s.cor + (ativo ? "" : "22");
    return { label: s.nome, data: s.x.map((x, i) => ({ x, y: s.y[i] })), borderColor: cor, backgroundColor: cor,
      borderWidth: algum && ativo && !s.bench ? 3 : 1.4, borderDash: s.bench ? [6, 4] : [], pointRadius: 0,
      pointHoverRadius: 4, order: ativo ? 0 : 1 };
  });
  st.graficos[id] = new Chart($("#" + id), {
    type: "line", data: { datasets },
    options: {
      parsing: false, normalized: true, animation: false, responsive: true, maintainAspectRatio: false,
      interaction: { mode: "nearest", intersect: false, axis: "xy" },
      plugins: {
        legend: { display: false }, linhaRef: { y: ref },
        decimation: { enabled: true, algorithm: "lttb", samples: 600 },
        tooltip: { callbacks: { title: (it) => fmtData(it[0].parsed.x), label: (it) => `${it.dataset.label}: ${fmtY(it.parsed.y)}` } },
      },
      scales: {
        x: { type: "linear", min: xMin, max: xMax, ticks: { callback: (v) => fmtData(v), maxTicksLimit: 7, includeBounds: false, color: corTexto() }, grid: { display: false } },
        y: { ticks: { callback: (v) => fmtY(v), color: corTexto() }, grid: { color: "rgba(128,128,128,.15)" } },
      },
    },
    plugins: [linhaRef],
  });
}

// ============================== resultado ==============================
function serieIndices(dIni, dFim) {
  const { cdi, ibov } = st.idx;
  const out = [];
  // CDI: fator diário com a taxa do dia anterior
  const i0 = lowerBound(cdi.d, dIni), i1 = upperBound(cdi.d, dFim) - 1;
  if (i1 > i0) {
    const x = [], y = []; let f = 1;
    for (let i = i0; i <= i1; i++) { if (i > 0) f *= (1 + cdi.v[i - 1] / 100) ** (1 / 252); x.push(cdi.d[i]); y.push(f - 1); }
    out.push({ nome: "CDI", x, y });
  }
  const j0 = lowerBound(ibov.d, dIni), j1 = upperBound(ibov.d, dFim) - 1;
  if (j1 > j0) {
    const base = j0 > 0 ? ibov.v[j0 - 1] : ibov.v[j0];
    const x = [], y = [];
    for (let i = j0; i <= j1; i++) { x.push(ibov.d[i]); y.push(ibov.v[i] / base - 1); }
    out.push({ nome: "IBOV", x, y });
  }
  return out;
}

// rentabilidade relativa ao benchmark: diferença (fundo − bench) ou razão (fundo ÷ bench)
function relativa(serie, bench, modo) {
  const x = [], y = [];
  let b0 = 0; const kAntes = lowerBound(bench.x, serie.x[0]) - 1;
  if (kAntes >= 0) b0 = bench.y[kAntes];
  for (let i = 0; i < serie.x.length; i++) {
    const k = upperBound(bench.x, serie.x[i]) - 1;
    if (k < 0) continue;
    const bf = (1 + bench.y[k]) / (1 + b0) - 1;
    const v = modo === "dif" ? serie.y[i] - bf : Math.abs(bf) > 0.01 ? serie.y[i] / bf : null;
    if (v != null) { x.push(serie.x[i]); y.push(v); }
  }
  return { ...serie, x, y };
}

function renderResultado() {
  const res = st.res;
  if (!res) return;
  const pers = Object.keys(res.periodos);
  $("#barraPer").innerHTML = pers.map((p) => `<button data-per="${p}" aria-pressed="${p === st.perAtivo}">${p}</button>`).join("");
  const dados = res.periodos[st.perAtivo];
  const cores = {}; st.sel.forEach((c, i) => (cores[c] = PALETA[i % PALETA.length]));
  $("#semDados").innerHTML = dados.semDados.length
    ? `<details><summary>⏳ ${dados.semDados.length} fundo(s) sem dados neste período · ver quais</summary>${dados.semDados.map((c) => esc(st.porCnpj.get(c)?.NOME || c)).join("; ")}</details>` : "";
  $("#vazio").hidden = true;
  if (!dados.linhas.length) { $("#resultado").hidden = true; return; }
  $("#resultado").hidden = false;
  $("#tituloMet").textContent = `Métricas · ${st.perAtivo}`;
  $("#ordem").innerHTML = ["Ordem da seleção", "Fundo", ...COLUNAS.filter(([, , t]) => t !== "txt" && t !== "data").map(([, n]) => n)]
    .map((n) => `<option ${n === st.ordem.col ? "selected" : ""}>${esc(n)}</option>`).join("");
  $("#tabMetricas").innerHTML = tabelaMetricas(dados);

  // intervalo (slider) compartilhado pelos gráficos de datas
  const dIni = Math.min(...dados.linhas.map((l) => l["Data Inicial"])), dFim = Math.max(...dados.linhas.map((l) => l["Data Final"]));
  const z = st.zoom[st.perAtivo] || [dIni, dFim];
  st.zoom[st.perAtivo] = z;
  configurarSlider(dIni, dFim, z);
  const [zi, zf] = z;
  const corta = (s) => { const a = lowerBound(s.x, zi), b = upperBound(s.x, zf); return { ...s, x: s.x.slice(a, b), y: s.y.slice(a, b) }; };

  const fundosSeries = dados.linhas.map((l) => { const s = dados.series.get(l._c); return { c: l._c, nome: res.apelidos[l._c], cor: cores[l._c], x: s.d, acum: s.acum, dd: s.dd }; });
  const idx = serieIndices(dIni, dFim).map((s) => ({ ...s, cor: COR_BENCH[s.nome], bench: true }));

  // rentabilidade acumulada (normal ou relativa)
  const opcAlvo = ["CDI", "IBOV", ...fundosSeries.map((s) => s.nome)];
  if (!opcAlvo.includes(st.rel.alvo)) st.rel.alvo = "CDI";
  $("#alvo").innerHTML = opcAlvo.map((n) => `<option ${n === st.rel.alvo ? "selected" : ""}>${esc(n)}</option>`).join("");
  $("#relOn").checked = st.rel.on;
  $("#relCtl").hidden = !st.rel.on;
  $$("#relModo button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.m === st.rel.modo));
  let seriesAcum = [...fundosSeries.map((s) => ({ nome: s.nome, cor: s.cor, x: s.x, y: s.acum })), ...idx];
  let ref = null, fmtY = (v) => brPct(v, 1);
  if (st.rel.on) {
    const bench = seriesAcum.find((s) => s.nome === st.rel.alvo);
    seriesAcum = seriesAcum.filter((s) => !s.bench && s.nome !== st.rel.alvo).map((s) => relativa(s, bench, st.rel.modo));
    ref = st.rel.modo === "dif" ? 0 : 1;
    if (st.rel.modo === "pct") fmtY = (v) => brPct(v, 0);
    $("#relNota").textContent = st.rel.modo === "dif"
      ? `Rentabilidade acumulada do fundo menos a do ${st.rel.alvo} (ex.: ${st.rel.alvo} + 5%).`
      : `Rentabilidade do fundo ÷ a do ${st.rel.alvo} (ex.: 150% do ${st.rel.alvo}). Início omitido enquanto o benchmark está perto de zero.`;
  } else $("#relNota").textContent = "";
  seriesAcum = seriesAcum.map(corta);
  grafico("gAcum", seriesAcum, { fmtY, ref, xMin: zi, xMax: zf });
  const seriesDd = fundosSeries.map((s) => corta({ nome: s.nome, cor: s.cor, x: s.x, y: s.dd }));
  grafico("gDd", seriesDd, { xMin: zi, xMax: zf });

  const final = (s) => (s.y.length ? s.y[s.y.length - 1] : null);
  $("#legAcum").innerHTML = tabelaLegenda("acum", seriesAcum.map((s) => ({ Fundo: s.nome, cor: s.cor, Final: final(s) })), ["Final"]);
  const mdd = Object.fromEntries(dados.linhas.map((l) => [res.apelidos[l._c], l.Queda]));
  $("#legDd").innerHTML = tabelaLegenda("dd", seriesDd.map((s) => ({ Fundo: s.nome, cor: s.cor, Final: final(s), "Máx. queda": mdd[s.nome] })), ["Final", "Máx. queda"]);
  avisoDesatualizado();
}

// ---------- slider de datas (dois cursores)
function configurarSlider(dIni, dFim, [zi, zf]) {
  const a = $("#zIni"), b = $("#zFim");
  for (const el of [a, b]) { el.min = dIni; el.max = dFim; }
  a.value = zi; b.value = zf;
  $("#zTxt").textContent = `${fmtData(zi)} – ${fmtData(zf)}`;
  const tot = dFim - dIni || 1;
  $("#zFaixa").style.left = `${(zi - dIni) / tot * 100}%`;
  $("#zFaixa").style.right = `${(dFim - zf) / tot * 100}%`;
}
let tSlider;
function aoMoverSlider(ev) {
  let zi = Number($("#zIni").value), zf = Number($("#zFim").value);
  if (zi > zf) { if (ev.target.id === "zIni") zi = zf; else zf = zi; }
  st.zoom[st.perAtivo] = [zi, zf];
  configurarSlider(Number($("#zIni").min), Number($("#zIni").max), [zi, zf]);
  clearTimeout(tSlider); tSlider = setTimeout(renderResultado, 120);
}

function atualizarEspaco() {
  const mb = D.espacoUsado() / 1024 / 1024;
  $("#espaco").textContent = D.guardarAtivo() ? `usando ${br(mb, 1)} MB neste computador` : "desligado";
}

// ============================== eventos ==============================
document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.closest("button.add")) { adicionar([t.closest("button.add").dataset.c]); }
  else if (t.dataset.rm) remover(t.dataset.rm);
  else if (t.id === "limpar") { st.sel = []; atualizarSidebar(); }
  else if (t.closest("#periodos button")) {
    const p = t.closest("button").dataset.p;
    st.periodos.has(p) ? st.periodos.delete(p) : st.periodos.add(p); atualizarSidebar();
  }
  else if (t.closest("#modoAdd button")) {
    const m = t.closest("button").dataset.m;
    $$("#modoAdd button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.m === m));
    $$(".modo").forEach((d) => (d.hidden = d.dataset.m !== m));
  }
  else if (t.id === "btnColar") lerColagem();
  else if (t.id === "abrirSeletor") abrirSeletor();
  else if (t.dataset.dlgrm) { dlg.sel = dlg.sel.filter((c) => c !== t.dataset.dlgrm); renderSeletor(); }
  else if (t.id === "dlgAdd") { adicionar(dlg.sel); $("#seletor").close(); }
  else if (t.id === "dlgCancelar") $("#seletor").close();
  else if (t.id === "calcular") calcular();
  else if (t.closest("#barraPer button")) { st.perAtivo = t.closest("button").dataset.per; renderResultado(); }
  else if (t.closest("#relModo button")) { st.rel.modo = t.closest("button").dataset.m; renderResultado(); }
});
document.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.matches("#dlgTabela input[type=checkbox]")) {
    const c = t.dataset.c;
    dlg.sel = t.checked ? [...new Set([...dlg.sel, c])] : dlg.sel.filter((x) => x !== c); renderSelDialogo();
  }
  else if (t.id === "dlgAtivos") renderSeletor();
  else if (t.dataset.todos) { st.todos[t.dataset.todos] = t.checked; renderResultado(); }
  else if (t.id === "ordem") { st.ordem.col = t.value; renderResultado(); }
  else if (t.id === "ordemDesc") { st.ordem.desc = t.checked; renderResultado(); }
  else if (t.id === "relOn") { st.rel.on = t.checked; renderResultado(); }
  else if (t.id === "alvo") { st.rel.alvo = t.value; renderResultado(); }
  else if (t.id === "guardar") { await D.definirGuardar(t.checked); atualizarEspaco(); }
  else if (["refMes", "refAno", "pIni", "pFim", "peso"].includes(t.id)) atualizarSidebar();
});
let tBusca, tDest, tDlg;
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "busca") { clearTimeout(tBusca); tBusca = setTimeout(atualizarSidebar, 150); }
  else if (t.id === "destaque") { clearTimeout(tDest); tDest = setTimeout(() => { st.destaque = t.value; renderResultado(); }, 200); }
  else if (t.id === "dlgBusca") { clearTimeout(tDlg); tDlg = setTimeout(renderSeletor, 200); }
  else if (t.id === "zIni" || t.id === "zFim") aoMoverSlider(e);
});
$("#guardar").checked = (() => { try { return JSON.parse(localStorage.getItem("fundos.guardar") ?? "true"); } catch { return true; } })();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderResultado);

iniciar();
