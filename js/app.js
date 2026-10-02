// Análise de Fundos — página principal (etapas 2 e 3)
import Chart from "https://cdn.jsdelivr.net/npm/chart.js@4.5.1/auto/+esm";
import * as D from "./dados.js";
import { COLUNAS, PERIODOS, calcularFundo, serieAcumulada, fmtData, diaDe, diaYMD, partes, lowerBound, upperBound, somarMeses } from "./calculos.js";
import { INDICES, corIndice, nomeIndice, serieIndice, retornoVol } from "./indices.js";
import { janelaMovel, resumoJanela, retornosFundo, retornosDiarios, matrizCorrelacao } from "./analises.js";

// ============================== CONFIGURAÇÃO (único lugar para editar) ==============================
const HF_REPO = "Shote/fundos-cvm";
const DADOS_URL = `https://huggingface.co/datasets/${HF_REPO}/resolve/main/`;
const MINIGRAFICOS = true;                 // minigráfico ao passar o mouse sobre um fundo (false desliga)
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
const PALETA = ["#2E91E5", "#E15F99", "#1CA71C", "#FB0D0D", "#DA16FF", "#B68100", "#750D86", "#EB663B", "#511CFB",
  "#00A08B", "#FB00D1", "#FC0080", "#B2828D", "#6C7C32", "#778AAE", "#862A16", "#A777F1", "#620042", "#1616A7",
  "#DA60CA", "#6C4516", "#0D2A63", "#AF0038", "#AA0DFE", "#3283FE", "#85660D", "#782AB6", "#565656", "#1C8356",
  "#16FF32", "#F7E1A0", "#1CBE4F", "#C4451C", "#DEA0FD", "#FE00FA", "#325A9B", "#FEAF16", "#F8A19F", "#90AD1C",
  "#F6222E", "#1CFFCE", "#2ED9FF", "#B10DA1", "#C075A6", "#FC1CBF", "#B00068", "#FBE426", "#FA0087"];

// ---------- preferências guardadas neste navegador (prefixo "fundos.")
const pref = (k, padrao) => { try { const v = localStorage.getItem("fundos." + k); return v == null ? padrao : JSON.parse(v); } catch { return padrao; } };
const salvar = (k, v) => { try { localStorage.setItem("fundos." + k, JSON.stringify(v)); } catch { /* sem armazenamento */ } };

const st = {
  meta: null, lista: [], porCnpj: new Map(), idx: null, sel: [], periodos: new Set(["12 Meses"]),
  res: null, perAtivo: null, zoom: {}, destaque: "",
  ord: {},                                              // tabela -> { col, dir } (sem entrada = ordem padrão)
  agrupar: pref("agrupar", ""), fechados: new Set(pref("gruposFechados", [])),
  minimizados: new Set(pref("minimizados", [])), travar: pref("travar", false),
  idxSel: new Set(pref("indices", ["CDI", "IBOV"])), riscoEixo: pref("riscoEixo", "ret"),
  rel: { on: false, alvo: "CDI", modo: "dif" }, todos: {}, graficos: {},
};
const log = (t) => { const el = $("#log"); if (el) el.textContent = t; };

// ============================== inicialização ==============================
async function iniciar() {
  try {
    $("#status").innerHTML = "carregando…";
    st.meta = await D.iniciar(DADOS_URL);
    D.definirGrupos(st.meta.grupos, st.meta.formato);
    desenharStatus();
    const [lista, idx] = await Promise.all([D.carregarLista(), D.carregarIndices()]);
    st.lista = lista; st.idx = idx;
    for (const f of lista) st.porCnpj.set(f.CNPJ, f);
    const ultimo = st.idx.cdi.d[st.idx.cdi.d.length - 1];
    const [a, m] = partes(ultimo);
    $("#refMes").value = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;   // mês anterior
    $("#refAno").value = a;
    $("#pIni").value = `${a - 3}-${String(m).padStart(2, "0")}-01`;
    $("#pFim").value = isoDe(ultimo);
    for (const k of [...st.idxSel]) if (!st.idx.niveis[k]) st.idxSel.delete(k);
    desenharChipsIndices();
    $("#jmBench").innerHTML = [["CDI", "CDI"], ["", "Nenhum (retorno absoluto)"],
      ...st.idx.disponiveis.filter((k) => k !== "CDI").map((k) => [k, nomeIndice(k)])]
      .map(([v, n]) => `<option value="${v}">${esc(n)}</option>`).join("");
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
const isoDe = (dia) => new Date(dia * 86400000).toISOString().slice(0, 10);

// horário dos dados em destaque no topo: data dos dados da CVM e "atualizado há X"
function desenharStatus() {
  const m = st.meta; if (!m) return;
  const s = String(m.gerado_em || "");
  const ms = Date.parse(/([+-]\d\d:\d\d|Z)$/.test(s) ? s : s + "Z");   // versões antigas gravavam em UTC sem fuso
  let rel = "";
  if (ms) {
    const min = Math.round((Date.now() - ms) / 60000);
    rel = min < 60 ? `há ${Math.max(1, min)} min` : min < 2880 ? `há ${Math.floor(min / 60)} h` : `há ${Math.floor(min / 1440)} dias`;
    rel += " · " + new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }
  $("#status").innerHTML = `<span class="rot">Dados da CVM até</span><span class="dt">${fmtData(diaDe(new Date(m.ultimo_dado)))}</span>
    <span class="rel">${rel ? "base atualizada " + rel : ""}</span>`;
}
setInterval(desenharStatus, 60000);

function desenharChipsIndices() {
  if (!st.idx) return;
  $("#idxChips").innerHTML = st.idx.disponiveis.map((k) =>
    `<button data-idx="${k}" aria-pressed="${st.idxSel.has(k)}"><span class="sw" style="background:${corIndice(k)}"></span>${esc(nomeIndice(k))}</button>`).join("");
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

// Fundo que parou de enviar cotas antes da data final comum: cancelado, em liquidação ou sem dados recentes.
// Atrasos curtos (até 7 dias) são normais no envio à CVM e não são marcados.
const DIAS_PARADO = 7;
function situacaoParado(f, cad, fimComum) {
  const ult = f.d[f.d.length - 1], sit = String(cad.SITUACAO || "");
  if (fimComum == null || fimComum - ult <= DIAS_PARADO) return null;
  const rot = /cancel/i.test(sit) ? "Cancelado" : /liquida/i.test(sit) ? "Em liquidação" : "Sem cotas recentes";
  return { rot, ult, txt: `${rot} · última cota em ${fmtData(ult)}${sit && !/cancel|liquida/i.test(sit) ? " · situação na CVM: " + sit : ""}` };
}
const marcaParado = (l) => (l && l._parado ? `<span class="parado" title="${esc(l._parado.txt)}">⊘</span>` : "");

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
      $("#progTxt").textContent = `baixando cotas · ${feitos}/${total} fundo(s)`;
    });
    $("#progTxt").textContent = "calculando…";
    await new Promise((r) => setTimeout(r, 0));
    const [ma, mm] = $("#refMes").value.split("-").map(Number);
    // data final comum: a cota mais recente entre os fundos selecionados
    let fimComum = -Infinity;
    for (const f of fundos.values()) if (f.d.length) fimComum = Math.max(fimComum, f.d[f.d.length - 1]);
    if (!Number.isFinite(fimComum)) fimComum = undefined;
    const opc = { ref: null, ini: diaDe(new Date($("#pIni").value)), fim: diaDe(new Date($("#pFim").value)), fimComum };
    const peso = Number($("#peso").value) / 100;
    const apel = apelidos(sel);
    const res = { apelidos: apel, fundos, periodos: {}, fimComum, sel };
    for (const per of PERIODOS.filter((p) => st.periodos.has(p))) {
      const ref = per === "Mês" ? diaYMD(ma, mm, 15) : per === "Ano" ? diaYMD(Number($("#refAno").value), 1, 1) : null;
      const linhas = [], semDados = [], series = new Map();
      for (const c of sel) {
        const f = fundos.get(c);
        const r = f ? calcularFundo(f, st.idx.ibov, per, peso, { ...opc, ref }) : null;
        if (!r) { semDados.push(c); continue; }
        const cad = st.porCnpj.get(c) || {};
        Object.assign(r, { _c: c, _parado: situacaoParado(f, cad, fimComum), _gestor: cad.GESTOR || "", "Fundo": cad.NOME, "CNPJ": cnpjFmt(c),
          "Classificação CVM": cad.CLASSIFICACAO_CVM || "", "Classificação ANBIMA": cad.CLASSIFICACAO_ANBIMA || "",
          "Objetivo de retorno": cad.INDICADOR_DESEMPENHO || "N/D" });
        linhas.push(r);
        series.set(c, serieAcumulada(f, r["Data Inicial"], r["Data Final"]));
      }
      res.periodos[per] = { linhas, semDados, series };
    }
    st.res = res; st.params = paramsAtuais(); st.zoom = {};
    if (!res.periodos[st.perAtivo]) st.perAtivo = Object.keys(res.periodos)[0];
    // janela móvel: padrão de 5 anos de aplicações até a última cota
    if (fimComum != null) {
      if (!$("#jmFim").value || st.jmFimAuto !== false) $("#jmFim").value = isoDe(fimComum);
      if (!$("#jmIni").value || st.jmIniAuto !== false) $("#jmIni").value = isoDe(somarMeses(fimComum, -60));
      calcularJM();
    }
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

// ---------- janela móvel (usa as cotas já carregadas; o botão Atualizar não baixa nada)
function calcularJM() {
  const res = st.res; if (!res) return;
  const ini = $("#jmIni").value, fim = $("#jmFim").value, meses = Math.max(1, Math.min(240, Number($("#jmMeses").value) || 12));
  if (!ini || !fim) return;
  const p = { bench: $("#jmBench").value, meses, ini: diaDe(new Date(ini)), fim: diaDe(new Date(fim)) };
  const porFundo = [];
  for (const c of res.sel) {
    const f = res.fundos.get(c); if (!f) continue;
    const linhas = janelaMovel(f, st.idx, p);
    const resumo = linhas.length ? resumoJanela(linhas) : null;
    if (resumo) porFundo.push({ c, linhas, resumo });
  }
  res.jm = { p, porFundo, nomeB: p.bench ? nomeIndice(p.bench) : "" };
}

// ============================== tabelas ==============================
function corSinal(v) { return typeof v === "number" && !Number.isNaN(v) ? (v > 0 ? `color:${VERDE}` : v < 0 ? `color:${VERMELHO}` : "") : ""; }
const FMT = {
  pct: (v) => brPct(v), num: (v) => (typeof v === "number" ? br(v, 4) : v ?? ""), num2: (v) => (typeof v === "number" ? br(v, 2) : v ?? ""),
  valor: (v) => br(v, 2), int: (v) => (typeof v === "number" ? br(v, 0) : ""), data: (v) => (typeof v === "number" ? fmtData(v) : v ?? ""),
  txt: (v) => v ?? "",
};
const casa = (termo, ...textos) => {
  const t = termo.trim().toLowerCase(); if (!t) return false;
  const dig = t.replace(/\D/g, "");
  return textos.some((x) => { x = String(x ?? ""); return x.toLowerCase().includes(t) || (dig.length >= 4 && x.replace(/\D/g, "").includes(dig)); });
};

// ---------- ordenação por clique no título: 1º clique ordena (maior primeiro; A→Z em textos), 2º inverte, 3º volta ao padrão
function clicarOrdem(tab, col, texto) {
  const ini = texto ? 1 : -1, o = st.ord[tab];
  if (!o || o.col !== col) st.ord[tab] = { col, dir: ini };
  else if (o.dir === ini) st.ord[tab] = { col, dir: -ini };
  else delete st.ord[tab];
}
function ordenar(linhas, tab, colunas) {
  const o = st.ord[tab]; if (!o) return linhas;
  const c = colunas.find((x) => x.chave === o.col);
  const val = (l) => (c?.valor ? c.valor(l) : l[o.col]);
  return [...linhas].sort((a, b) => {
    const x = val(a), y = val(b), nx = typeof x === "number" && !Number.isNaN(x), ny = typeof y === "number" && !Number.isNaN(y);
    if (nx && ny) return (x - y) * o.dir;
    if (nx !== ny) return nx ? -1 : 1;                     // vazios e textos (ex.: "Intervalo muito curto") no fim
    if (x == null || x === "") return 1; if (y == null || y === "") return -1;
    return String(x).localeCompare(String(y), "pt-BR") * o.dir;
  });
}

// ---------- agrupamento por categoria, com grupos recolhíveis (guardados neste navegador)
function agruparLinhas(linhas, tab, campo, info) {
  const grupos = new Map();
  for (const l of linhas) { const g = campo(l) || "Sem classificação"; if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(l); }
  const nomes = [...grupos.keys()].sort((a, b) => (a === "Sem classificação") - (b === "Sem classificação") || a.localeCompare(b, "pt-BR"));
  const out = [];
  for (const g of nomes) {
    const membros = grupos.get(g), chave = `${tab}|${st.agrupar}|${g}`;
    out.push({ _cab: true, chave, rotulo: g, info: info(membros), n: membros.length });
    for (const l of membros) out.push({ ...l, _g: chave });
  }
  return out;
}
function alternarGrupo(chave) {
  st.fechados.has(chave) ? st.fechados.delete(chave) : st.fechados.add(chave);
  salvar("gruposFechados", [...st.fechados]);
  renderResultado();
}

// ---------- tabela HTML: cabeçalho fixo, 1ª(s) colunas fixas, zebra, destaque, ordenação e grupos de linhas
function tabelaHTML({ colunas, linhas, fixas = 0, larguras = [260, 150], grupos = null, destacar = [], separadores = new Set(),
  altura = 460, ordenavel = null, classes = [] }) {
  const esq = larguras.map((_, j) => larguras.slice(0, j).reduce((s, x) => s + x, 0));
  const fx = (j, extra = "") => (j < fixas ? ` class="fx${extra}" style="left:${esq[j]}px;min-width:${larguras[j]}px;max-width:${larguras[j]}px"` : extra ? ` class="${extra.trim()}"` : "");
  const o = ordenavel ? st.ord[ordenavel] : null;
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
  colunas.forEach((c, j) => {
    if (!ordenavel || c.ord === false) { h += `<th${fx(j)}>${esc(c.nome)}</th>`; return; }
    const at = o && o.col === c.chave, texto = c.tipo === "txt" && !c.valor;
    h += `<th${fx(j)}${at ? ` aria-sort="${o.dir > 0 ? "ascending" : "descending"}"` : ""}><button class="ord" data-ord="${esc(ordenavel)}" data-col="${esc(c.chave)}"
      data-txt="${texto ? 1 : 0}" title="Ordenar">${esc(c.nome)}${at ? (o.dir > 0 ? " ▲" : " ▼") : ""}</button></th>`;
  });
  h += "</tr></thead><tbody>";
  linhas.forEach((l, i) => {
    if (l._cab) {
      const fech = st.fechados.has(l.chave);
      h += `<tr class="grupo${fech ? " fechado" : ""}" data-g="${esc(l.chave)}" tabindex="0" role="button" aria-expanded="${!fech}"
        title="${fech ? "Expandir" : "Recolher"} este grupo"><td colspan="${colunas.length}"><span class="g-rot"><span class="chev">${fech ? "▸" : "▾"}</span>
        ${esc(l.rotulo)}<span class="g-info"> · ${l.n} fundo${l.n > 1 ? "s" : ""}${l.info ? " · " + l.info : ""}</span></span></td></tr>`;
      return;
    }
    const oculta = l._g && st.fechados.has(l._g);
    const cls = [destacar[i] ? "dest" : "", separadores.has(i) ? "sep" : "", l._g ? "em-grupo" : "", oculta ? "oculta" : "", classes[i] || ""].join(" ").trim();
    h += `<tr${cls ? ` class="${cls}"` : ""}${l._g ? ` data-gm="${esc(l._g)}"` : ""}>`;
    colunas.forEach((c, j) => {
      const v = c.valor ? c.valor(l) : l[c.chave];
      if (separadores.has(i)) { h += c.chave === "Fundo" ? `<td class="t">${esc(v)}</td>` : "<td></td>"; return; }
      let txt = c.html ? c.html(v, l) : esc((FMT[c.tipo] || FMT.txt)(v));
      if (j === 0 && l._g) txt = `<span class="guia" data-guia="${esc(l._g)}" title="Recolher este grupo"></span>` + txt;
      const estilo = c.cor ? corSinal(v) : "";
      const alinh = c.tipo === "txt" || c.tipo === "data" || c.html ? " t" : "";
      if (j < fixas) h += `<td class="fx t" style="left:${esq[j]}px;min-width:${larguras[j]}px;max-width:${larguras[j]}px;${estilo}" title="${esc(typeof v === "number" ? "" : v)}">${txt}</td>`;
      else h += `<td class="${alinh.trim()}" style="${estilo}">${txt}</td>`;
    });
    h += "</tr>";
  });
  return h + "</tbody></table></div>";
}

// ---------- tabela de métricas
const CAMPOS_GRUPO = {
  "Classificação CVM": (l) => l["Classificação CVM"], "Classificação ANBIMA": (l) => l["Classificação ANBIMA"],
  "Objetivo de retorno": (l) => (l["Objetivo de retorno"] === "N/D" ? "" : l["Objetivo de retorno"]), "Gestor": (l) => l._gestor,
};
const nomeFundoHTML = (v, l) => `${marcaParado(l)}${l._selo || ""}<span data-mini="${esc(l._c)}">${esc(v ?? "")}</span>`;
function tabelaMetricas(dados) {
  const colunas = COLUNAS.map(([, n, t]) => {
    const c = { chave: n, nome: n, tipo: t, cor: t === "pct" };
    if (n === "Fundo") c.html = nomeFundoHTML;
    if (n === "Data Final") c.html = (v, l) => (l._parado
      ? `<span class="parado-dt" title="${esc(l._parado.txt)}">${esc(FMT.data(v))}</span>` : esc(FMT.data(v)));
    return c;
  });
  const grupos = COLUNAS.map(([g]) => g);
  // selos de maior e menor retorno no período (com 3 fundos ou mais)
  const comRet = dados.linhas.filter((l) => typeof l["% Acumulado"] === "number");
  dados.linhas.forEach((l) => delete l._selo);
  if (comRet.length >= 3) {
    const mx = comRet.reduce((a, b) => (b["% Acumulado"] > a["% Acumulado"] ? b : a)), mn = comRet.reduce((a, b) => (b["% Acumulado"] < a["% Acumulado"] ? b : a));
    mx._selo = `<span class="selo up" title="Maior retorno no período">▲</span>`;
    mn._selo = `<span class="selo down" title="Menor retorno no período">▼</span>`;
  }
  let linhas = ordenar(dados.linhas, "met", colunas);
  if (st.agrupar && CAMPOS_GRUPO[st.agrupar]) {
    linhas = agruparLinhas(linhas, "met", CAMPOS_GRUPO[st.agrupar], (m) => {
      const v = m.map((l) => l["% Acumulado"]).filter((x) => typeof x === "number");
      return v.length ? `média ${brPct(v.reduce((s, x) => s + x, 0) / v.length)} no período` : "";
    });
  }
  const dest = linhas.map((l) => !l._cab && casa(st.destaque, l.Fundo, l.CNPJ));
  const classes = linhas.map((l) => (l._selo ? (l._selo.includes("up") ? "top-up" : "top-down") : ""));
  const parados = dados.linhas.filter((l) => l._parado);
  const nota = parados.length ? `<p class="nota-parado"><span class="parado">⊘</span> ${parados.length} fundo(s) sem cotas até o fim do período
    (cancelado, em liquidação ou sem envio recente). O cálculo usa o mesmo início dos demais e vai até a última cota de cada um.
    Passe o mouse sobre o símbolo para ver a data.</p>` : "";
  return tabelaHTML({ colunas, linhas, fixas: 2, grupos, destacar: dest, classes, altura: 520, ordenavel: "met" }) + nota;
}

// ---------- tabela-legenda: cor, posição, fundo e valores, do maior para o menor; 5 maiores + 5 menores (+ destacados)
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
    { chave: "Fundo", nome: "Fundo", html: (v, l) => `<span class="sw" style="background:${l.cor}"></span>${marcaParado(l)}` +
      (l._c ? `<span data-mini="${esc(l._c)}">${esc(v)}</span>` : esc(v)) },
    ...colsValor.map((c) => ({ chave: c, nome: c, tipo: "pct", cor: true }))];
  const dest = vis.map((it, i) => !seps.has(i) && casa(st.destaque, it.Fundo));
  return `<label class="tog"><input type="checkbox" data-todos="${chave}" ${todos ? "checked" : ""} ${ord.length <= 10 ? "disabled" : ""}>
      Mostrar todos (${ord.length})</label>` + tabelaHTML({ colunas, linhas: vis, destacar: dest, separadores: seps, altura: 420 });
}

// ============================== gráficos ==============================
const corTexto = () => getComputedStyle(document.body).getPropertyValue("--txt").trim() || "#333";
const escuro = () => matchMedia("(prefers-color-scheme: dark)").matches;
const linhaRef = { id: "linhaRef", afterDraw(ch, _a, o) {
  const ctx = ch.ctx, { left, right, top, bottom } = ch.chartArea;
  ctx.save(); ctx.strokeStyle = escuro() ? OURO : ANIL; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
  if (o?.y != null) { const y = ch.scales.y.getPixelForValue(o.y); ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); }
  if (o?.x != null) { const x = ch.scales.x.getPixelForValue(o.x); ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); }
  ctx.restore(); } };
// nomes escritos ao lado dos pontos marcados (benchmarks e fundos destacados) no risco × retorno
const rotulos = { id: "rotulos", afterDatasetsDraw(ch) {
  const ctx = ch.ctx; ctx.save(); ctx.font = "600 11px Manrope, sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = corTexto();
  ch.data.datasets.forEach((ds, i) => {
    if (!ds.rotulo || ch.getDatasetMeta(i).hidden) return;
    const p = ch.getDatasetMeta(i).data[0]; if (p) ctx.fillText(ds.label, p.x, p.y - 11);
  });
  ctx.restore(); } };

function grafico(id, series, { fmtY = (v) => brPct(v, 1), ref = null, xMin, xMax, tituloX = fmtData } = {}) {
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
        tooltip: { callbacks: { title: (it) => tituloX(it[0].parsed.x), label: (it) => `${it.dataset.label}: ${fmtY(it.parsed.y)}` } },
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
// índices escolhidos como séries de retorno acumulado (base no dia anterior ao início, igual às cotas)
function seriesIndices(dIni, dFim, chaves = [...st.idxSel]) {
  return chaves.map((k) => { const s = serieIndice(st.idx, k, dIni, dFim); return s && { nome: nomeIndice(k), k, cor: corIndice(k), bench: true, ...s }; })
    .filter(Boolean);
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
const coresFundos = () => { const c = {}; (st.res?.sel || st.sel).forEach((x, i) => (c[x] = PALETA[i % PALETA.length])); return c; };

function renderResultado() {
  const res = st.res;
  aplicarMinimizados();
  if (!res) return;
  const pers = Object.keys(res.periodos);
  $("#barraPer").innerHTML = pers.map((p) => `<button data-per="${p}" aria-pressed="${p === st.perAtivo}">${p}</button>`).join("");
  desenharTravar();
  const dados = res.periodos[st.perAtivo];
  const cores = coresFundos();
  $("#semDados").innerHTML = dados.semDados.length
    ? `<details><summary>⏳ ${dados.semDados.length} fundo(s) sem dados neste período · ver quais</summary>${dados.semDados.map((c) => esc(st.porCnpj.get(c)?.NOME || c)).join("; ")}</details>` : "";
  $("#vazio").hidden = true;
  renderJM();
  if (!dados.linhas.length) { $("#resultado").hidden = true; return; }
  $("#resultado").hidden = false;
  $("#tituloMet").textContent = `Métricas · ${st.perAtivo}`;
  $("#agrupar").value = st.agrupar;
  $("#tabMetricas").innerHTML = tabelaMetricas(dados);

  // intervalo (slider) compartilhado pelos gráficos de datas
  const dIni = Math.min(...dados.linhas.map((l) => l["Data Inicial"])), dFim = Math.max(...dados.linhas.map((l) => l["Data Final"]));
  const z = st.zoom[st.perAtivo] || [dIni, dFim];
  st.zoom[st.perAtivo] = z;
  configurarSlider(dIni, dFim, z);
  const [zi, zf] = z;
  const corta = (s) => { const a = lowerBound(s.x, zi), b = upperBound(s.x, zf); return { ...s, x: s.x.slice(a, b), y: s.y.slice(a, b) }; };

  const fundosSeries = dados.linhas.map((l) => { const s = dados.series.get(l._c); return { c: l._c, nome: res.apelidos[l._c], cor: cores[l._c], x: s.d, acum: s.acum, dd: s.dd, parado: l._parado }; });

  // rentabilidade acumulada (normal ou relativa)
  const nomesIdx = st.idx.disponiveis.map(nomeIndice);
  const opcAlvo = [...nomesIdx, ...fundosSeries.map((s) => s.nome)];
  if (!opcAlvo.includes(st.rel.alvo)) st.rel.alvo = "CDI";
  $("#alvo").innerHTML = opcAlvo.map((n) => `<option ${n === st.rel.alvo ? "selected" : ""}>${esc(n)}</option>`).join("");
  $("#relOn").checked = st.rel.on;
  $("#relCtl").hidden = !st.rel.on;
  $$("#relModo button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.m === st.rel.modo));
  let seriesAcum = [...fundosSeries.map((s) => ({ nome: s.nome, c: s.c, cor: s.cor, x: s.x, y: s.acum, parado: s.parado })), ...seriesIndices(dIni, dFim)];
  let ref = null, fmtY = (v) => brPct(v, 1);
  if (st.rel.on) {
    const kAlvo = st.idx.disponiveis.find((k) => nomeIndice(k) === st.rel.alvo);
    const bench = kAlvo ? seriesIndices(dIni, dFim, [kAlvo])[0] : seriesAcum.find((s) => s.nome === st.rel.alvo);
    if (bench) {
      seriesAcum = seriesAcum.filter((s) => !s.bench && s.nome !== st.rel.alvo).map((s) => relativa(s, bench, st.rel.modo));
      ref = st.rel.modo === "dif" ? 0 : 1;
      if (st.rel.modo === "pct") fmtY = (v) => brPct(v, 0);
    }
    $("#relNota").textContent = st.rel.modo === "dif"
      ? `Rentabilidade acumulada do fundo menos a do ${st.rel.alvo} (ex.: ${st.rel.alvo} + 5%).`
      : `Rentabilidade do fundo ÷ a do ${st.rel.alvo} (ex.: 150% do ${st.rel.alvo}). Início omitido enquanto o benchmark está perto de zero.`;
  } else $("#relNota").textContent = "";
  seriesAcum = seriesAcum.map(corta);
  grafico("gAcum", seriesAcum, { fmtY, ref, xMin: zi, xMax: zf });
  const seriesDd = fundosSeries.map((s) => corta({ nome: s.nome, c: s.c, cor: s.cor, x: s.x, y: s.dd, parado: s.parado }));
  grafico("gDd", seriesDd, { xMin: zi, xMax: zf });

  const final = (s) => (s.y.length ? s.y[s.y.length - 1] : null);
  $("#legAcum").innerHTML = tabelaLegenda("acum", seriesAcum.map((s) => ({ Fundo: s.nome, _c: s.c, cor: s.cor, _parado: s.parado, Final: final(s) })), ["Final"]);
  const mdd = Object.fromEntries(dados.linhas.map((l) => [res.apelidos[l._c], l.Queda]));
  $("#legDd").innerHTML = tabelaLegenda("dd", seriesDd.map((s) => ({ Fundo: s.nome, _c: s.c, cor: s.cor, _parado: s.parado, Final: final(s), "Máx. queda": mdd[s.nome] })), ["Final", "Máx. queda"]);

  renderRisco(dados, cores, dIni, dFim);
  renderCorrelacao(dados, cores, dIni, dFim);
  avisoDesatualizado();
}

// ---------- risco × retorno: volatilidade no eixo Y; retorno a.a. ou Sharpe no eixo X
function renderRisco(dados, cores, dIni, dFim) {
  const eixo = st.riscoEixo, chaveX = eixo === "ret" ? "ret" : "sharpe";
  $$("#riscoEixo button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.e === eixo));
  const pts = dados.linhas.filter((l) => typeof l.Volatilidade === "number" && typeof l["% Anualizado"] === "number")
    .map((l) => ({ nome: st.res.apelidos[l._c], c: l._c, cnpj: l.CNPJ, cor: cores[l._c], ret: l["% Anualizado"], vol: l.Volatilidade,
      sharpe: typeof l["Sharpe Anualizado"] === "number" ? l["Sharpe Anualizado"] : null, parado: l._parado }));
  const cdi = retornoVol(st.idx, "CDI", dIni, dFim), avisos = [];
  for (const k of st.idxSel) {
    const rv = retornoVol(st.idx, k, dIni, dFim); if (!rv) continue;
    const sharpe = k === "CDI" ? 0 : INDICES[k].tipo === "preco" && rv.vol > 0 && cdi ? (rv.ret - cdi.ret) / rv.vol : null;
    if (rv.fim < dFim - 7) avisos.push(`${nomeIndice(k)} até ${fmtData(rv.fim)}`);
    pts.push({ nome: nomeIndice(k), cor: corIndice(k), ret: rv.ret, vol: rv.vol, sharpe, bench: true });
  }
  $("#riscoNota").textContent = `Período de ${fmtData(dIni)} a ${fmtData(dFim)} (o controle de datas dos gráficos acima não muda este quadro).` +
    (avisos.length ? ` Índices com dado só ${avisos.join(", ")} (divulgação mensal).` : "") +
    (eixo === "sharpe" ? " Sharpe = (retorno a.a. − CDI a.a.) ÷ volatilidade; inflação e taxas ficam de fora." : "");
  const algum = pts.some((p) => !p.bench && casa(st.destaque, p.nome, p.cnpj));
  const vis = pts.filter((p) => p[chaveX] != null);
  const fmtX = chaveX === "ret" ? (v) => brPct(v, 1) : (v) => br(v, 2);
  st.graficos.gRisco?.destroy();
  st.graficos.gRisco = new Chart($("#gRisco"), {
    type: "scatter",
    data: { datasets: vis.map((p) => {
      const ativo = !algum || p.bench || casa(st.destaque, p.nome, p.cnpj), forte = algum && ativo && !p.bench;
      return { label: p.nome, data: [{ x: p[chaveX], y: p.vol }], backgroundColor: p.cor + (ativo ? "" : "33"),
        borderColor: forte ? (escuro() ? "#fff" : ANIL) : p.bench ? OURO : "#ffffff", borderWidth: forte ? 2 : 1,
        pointStyle: p.bench ? "rectRot" : "circle", pointRadius: p.bench ? 8 : forte ? 9 : 6, pointHoverRadius: 10,
        rotulo: p.bench || forte, order: ativo ? 0 : 1 };
    }) },
    options: {
      animation: false, responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, linhaRef: { x: chaveX === "sharpe" ? 0 : null },
        tooltip: { callbacks: { label: (it) => `${it.dataset.label}: volatilidade ${brPct(it.parsed.y)} · ${chaveX === "ret" ? "retorno " + brPct(it.parsed.x) + " a.a." : "Sharpe " + br(it.parsed.x, 2)}` } } },
      scales: {
        x: { title: { display: true, text: chaveX === "ret" ? "Retorno (% a.a.)" : "Sharpe (sobre o CDI)", color: corTexto() },
          ticks: { callback: fmtX, color: corTexto() }, grid: { color: "rgba(128,128,128,.15)" } },
        y: { min: 0, title: { display: true, text: "Volatilidade (risco, % a.a.)", color: corTexto() },
          ticks: { callback: (v) => brPct(v, 1), color: corTexto() }, grid: { color: "rgba(128,128,128,.15)" } },
      },
    },
    plugins: [linhaRef, rotulos],
  });
  // tabela ao lado
  const colunas = [
    { chave: "nome", nome: "Fundo / índice", tipo: "txt", html: (v, l) => `<span class="sw${l.bench ? " losango" : ""}" style="background:${l.cor}"></span>${marcaParado({ _parado: l.parado })}` +
      (l.c ? `<span data-mini="${esc(l.c)}">${esc(v)}</span>` : `<i>${esc(v)}</i>`) },
    { chave: "ret", nome: "Retorno a.a.", tipo: "pct", cor: true }, { chave: "vol", nome: "Volatilidade", tipo: "pct" },
    { chave: "sharpe", nome: "Sharpe", tipo: "num2", cor: true }];
  let linhas = st.ord.risco ? ordenar(pts, "risco", colunas)
    : [...pts].sort((a, b) => (b[chaveX] ?? -Infinity) - (a[chaveX] ?? -Infinity));
  const dest = linhas.map((p) => !p.bench && casa(st.destaque, p.nome, p.cnpj));
  $("#tabRisco").innerHTML = tabelaHTML({ colunas, linhas, destacar: dest, altura: 420, ordenavel: "risco" });
}

// ---------- correlação dos retornos diários (fundos + índices de preço escolhidos)
function renderCorrelacao(dados, cores, dIni, dFim) {
  const itens = dados.linhas.map((l) => ({ nome: st.res.apelidos[l._c], c: l._c, cor: cores[l._c], cnpj: l.CNPJ,
    ret: retornosFundo(st.res.fundos.get(l._c), dIni, dFim) }));
  for (const k of st.idxSel) if (INDICES[k].tipo === "preco") itens.push({ nome: nomeIndice(k), cor: corIndice(k), bench: true, ret: retornosDiarios(st.idx, k, dIni, dFim) });
  if (itens.length < 2) { $("#tabCorr").innerHTML = `<p class="nota">Selecione pelo menos 2 fundos.</p>`; $("#corrNota").textContent = ""; return; }
  const m = matrizCorrelacao(itens.map((i) => i.ret)), n = itens.length;
  const marc = itens.map((it) => !it.bench && casa(st.destaque, it.nome, it.cnpj));
  const rot = (it, i) => `${i + 1}. ${curto(it.nome, 34)}`;
  const cel = (r, i, j) => {
    const hc = marc[j] || marc[i] ? " hc" : "";
    if (i === j) return `<td class="c eu${hc}">1</td>`;
    if (r == null) return `<td class="c nd${hc}" title="Menos de 20 dias em comum">n/a</td>`;
    const a = Math.min(0.8, Math.abs(r) * 0.8), fundo = r >= 0 ? `rgba(31,90,166,${a})` : `rgba(208,38,44,${a})`;
    return `<td class="c${hc}" style="background:${fundo};${Math.abs(r) > 0.6 ? "color:#fff" : ""}" title="${esc(itens[i].nome)} × ${esc(itens[j].nome)}: ${br(r, 2)}">${br(r, 2)}</td>`;
  };
  const corpo = itens.map((it, i) => `<tr${marc[i] ? ' class="hl"' : ""}><th class="rot" title="${esc(it.nome)}"><span class="sw${it.bench ? " losango" : ""}" style="background:${it.cor}"></span>` +
    (it.c ? `<span data-mini="${esc(it.c)}">${esc(rot(it, i))}</span>` : esc(rot(it, i))) + `</th>${m[i].map((r, j) => cel(r, i, j)).join("")}</tr>`).join("");
  const pe = `<tr><th class="canto"></th>${itens.map((it, j) => `<th class="col${marc[j] ? " hl" : ""}" title="${esc(it.nome)}"><span>${esc(rot(it, j))}</span></th>`).join("")}</tr>`;
  const alturaLinha = 29, rodape = 170;
  $("#tabCorr").innerHTML = `<div class="corr-wrap" style="max-height:${Math.min(n, 10) * alturaLinha + rodape}px"><table class="corr"><tbody>${corpo}</tbody><tfoot>${pe}</tfoot></table></div>`;
  $("#corrNota").textContent = `Retornos diários de ${fmtData(dIni)} a ${fmtData(dFim)}, nos dias em que os dois têm dado. 1 = andam juntos; 0 = sem relação; −1 = sentidos opostos.` +
    (n > 10 ? ` ${n} linhas: role dentro do quadro (os nomes das colunas ficam embaixo).` : "");
}

// ---------- janela móvel
function renderJM() {
  const jm = st.res?.jm;
  $("#secJM").hidden = !st.res;
  if (!jm) return;
  const B = jm.nomeB || "Benchmark", cores = coresFundos();
  const n = jm.porFundo.reduce((s, x) => s + x.linhas.length, 0);
  $("#jmCorpo").hidden = !jm.porFundo.length;
  if (!jm.porFundo.length) { $("#jmInfo").innerHTML = `<p class="nota">Nenhuma janela completa no intervalo escolhido. Aumente o intervalo ou diminua a duração.</p>`; return; }
  const prim = Math.min(...jm.porFundo.map((x) => x.resumo.primeira)), ult = Math.max(...jm.porFundo.map((x) => x.resumo.ultima));
  $("#jmInfo").innerHTML = [`<b>${jm.p.meses} meses</b> de aplicação`, `benchmark: <b>${esc(jm.nomeB || "nenhum")}</b>`,
    `aplicações de <b>${fmtData(prim)}</b> a <b>${fmtData(ult)}</b>`, `<b>${jm.porFundo.length}</b> fundo(s) · <b>${br(n, 0)}</b> janelas`]
    .map((t) => `<span>${t}</span>`).join("");
  const series = jm.porFundo.map(({ c, linhas }) => {
    const v = linhas.filter((l) => l.dif != null);
    return { nome: st.res.apelidos[c], c, cor: cores[c], x: v.map((l) => l.ini), y: v.map((l) => l.dif) };
  });
  grafico("gJM", series, { ref: 0, xMin: prim, xMax: ult, tituloX: (x) => `Aplicação em ${fmtData(x)}` });
  $("#legJM").innerHTML = tabelaLegenda("jm", jm.porFundo.map(({ c, resumo }, i) => ({ Fundo: series[i].nome, _c: c, cor: series[i].cor,
    Final: series[i].y.length ? series[i].y[series[i].y.length - 1] : null, Mediana: resumo.med.dif })), ["Final", "Mediana"]);

  // resumo por fundo
  const linhas = jm.porFundo.map(({ c, resumo: r }) => ({ _c: c, Fundo: st.porCnpj.get(c)?.NOME || c, CNPJ: cnpjFmt(c), prim: r.primeira, ult: r.ultima,
    ...Object.fromEntries(["min", "med", "max"].flatMap((f) => Object.entries(r[f]).map(([k, v]) => [`${f}.${k}`, v]))),
    total: r.total, abaixo: r.abaixo, acima: r.acima, negativas: r.negativas, positivas: r.positivas, pAcima: r.pAcima, pPositivas: r.pPositivas }));
  const faixa = (f, rot, comData) => [
    ...(comData ? [{ chave: `${f}.data`, nome: "Data de início", tipo: "data", g: rot }] : []),
    { chave: `${f}.ret`, nome: "Rentabilidade", tipo: "pct", cor: true, g: rot }, { chave: `${f}.retAA`, nome: "Fundo a.a.", tipo: "pct", cor: true, g: rot },
    { chave: `${f}.benchAA`, nome: `${B} a.a.`, tipo: "pct", cor: true, g: rot }, { chave: `${f}.dif`, nome: "Diferença", tipo: "pct", cor: true, g: rot }];
  const colunas = [
    { chave: "Fundo", nome: "Fundo", tipo: "txt", g: "Fundo", html: (v, l) => `<span data-mini="${esc(l._c)}">${esc(v)}</span>` }, { chave: "CNPJ", nome: "CNPJ", tipo: "txt", g: "Fundo" },
    { chave: "prim", nome: "Primeira aplicação", tipo: "data", g: "Período analisado" }, { chave: "ult", nome: "Última aplicação", tipo: "data", g: "Período analisado" },
    ...faixa("min", "Mínimo", true), ...faixa("med", "Mediana", false), ...faixa("max", "Máximo", true),
    ...["total:Total", "abaixo:Abaixo do " + B, "acima:Acima do " + B, "negativas:Negativas", "positivas:Positivas"]
      .map((x) => { const [k, nm] = x.split(":"); return { chave: k, nome: nm, tipo: "int", g: "Janelas" }; }),
    { chave: "pAcima", nome: `% acima do ${B}`, tipo: "pct", g: "Consistência" }, { chave: "pPositivas", nome: "% positivas", tipo: "pct", g: "Consistência" }];
  const ord = ordenar(linhas, "jm", colunas);
  $("#tabJM").innerHTML = tabelaHTML({ colunas, linhas: ord, fixas: 2, grupos: colunas.map((c) => c.g), ordenavel: "jm",
    destacar: ord.map((l) => casa(st.destaque, l.Fundo, l.CNPJ)), altura: 420 });
}

// lista completa de todas as janelas (CSV com ponto e vírgula e vírgula decimal: abre direto no Excel em português)
function baixarJM() {
  const jm = st.res?.jm; if (!jm) return;
  const B = jm.nomeB || "Benchmark", pct = (v) => (v == null ? "" : br(v * 100, 4) + "%");
  const cab = ["Fundo", "CNPJ", "Data Inicial", "Data Final", "Dias úteis (ANBIMA)", "Dias com cota na CVM", "Rentabilidade no período",
    `${B} anualizado`, "Fundo anualizado", `Diferença para o ${B}`];
  const linhas = [cab.join(";")];
  for (const { c, linhas: ls } of jm.porFundo) {
    const nome = (st.porCnpj.get(c)?.NOME || c).replace(/;/g, ",");
    for (const l of ls) linhas.push([nome, cnpjFmt(c), fmtData(l.ini), fmtData(l.fim), l.du, l.linhas, pct(l.ret), pct(l.benchAA), pct(l.retAA), pct(l.dif)].join(";"));
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff" + linhas.join("\r\n")], { type: "text/csv;charset=utf-8" }));
  a.download = `janela_movel_${jm.p.meses}m.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
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

// ---------- seções minimizadas (guardadas neste navegador)
function aplicarMinimizados() {
  $$("[data-sec]").forEach((s) => {
    const min = st.minimizados.has(s.dataset.sec);
    s.classList.toggle("min", min);
    const b = $(".btn-min", s);
    if (b) { b.textContent = min ? "+" : "−"; b.title = min ? "Mostrar esta seção" : "Minimizar esta seção"; b.setAttribute("aria-expanded", String(!min)); }
  });
}
// ---------- barra de período: acompanha a rolagem ou fica só no topo
function desenharTravar() {
  $(".barra").classList.toggle("solta", st.travar);
  const b = $("#btnTravar");
  b.textContent = st.travar ? "Acompanhar rolagem" : "Travar no topo";
  b.title = st.travar ? "A barra fica só no topo da página. Clique para ela acompanhar a rolagem." : "A barra acompanha a rolagem. Clique para deixá-la só no topo.";
}

// ---------- minigráfico ao passar o mouse sobre um fundo: cota dos últimos 12 meses (dados já carregados)
let miniTimer = null, miniAlvo = null;
function mostrarMini(el, x, y) {
  const c = el.dataset.mini, f = st.res?.fundos.get(c), box = $("#mini");
  if (!f || f.d.length < 3) return;
  const ult = f.d[f.d.length - 1], i0 = lowerBound(f.d, somarMeses(ult, -12));
  const q = Array.from(f.q.subarray(Math.max(0, i0 - 1)));
  if (q.length < 3) return;
  const W = 220, H = 60, p = 3, mn = Math.min(...q), mx = Math.max(...q), amp = mx - mn || 1;
  const pts = q.map((v, i) => [p + i * (W - 2 * p) / (q.length - 1), H - p - (v - mn) / amp * (H - 2 * p)]);
  const var12 = q[q.length - 1] / q[0] - 1, cor = var12 >= 0 ? VERDE : VERMELHO;
  const linha = pts.map((t) => t[0].toFixed(1) + "," + t[1].toFixed(1)).join(" ");
  box.innerHTML = `<div class="mini-tit">${esc(st.res.apelidos[c] || c)}</div>
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><path d="M${pts[0][0]},${H - p} L${linha.replace(/ /g, " L")} L${pts[pts.length - 1][0]},${H - p} Z" fill="${cor}" opacity=".13"/>
    <polyline points="${linha}" fill="none" stroke="${cor}" stroke-width="1.8" stroke-linejoin="round"/></svg>
    <div class="mini-rod">12 meses até ${fmtData(ult)}: <b style="color:${cor}">${brPct(var12)}</b></div>`;
  posicionarMini(x, y); box.hidden = false;
}
function posicionarMini(x, y) {
  const box = $("#mini"), w = 250, h = 120;
  let l = x + 16, t = y + 16;
  if (l + w > innerWidth - 8) l = x - w - 12;
  if (t + h > innerHeight - 8) t = y - h - 12;
  box.style.left = Math.max(8, l) + "px"; box.style.top = Math.max(8, t) + "px";
}
if (MINIGRAFICOS && matchMedia("(hover: hover)").matches) {
  document.addEventListener("mouseover", (e) => {
    const el = e.target.closest?.("[data-mini]");
    if (!el || el === miniAlvo) return;
    miniAlvo = el; clearTimeout(miniTimer);
    miniTimer = setTimeout(() => mostrarMini(el, e.clientX, e.clientY), 280);
  });
  document.addEventListener("mouseout", (e) => {
    const el = e.target.closest?.("[data-mini]");
    if (el && (!e.relatedTarget || !el.contains(e.relatedTarget))) { miniAlvo = null; clearTimeout(miniTimer); $("#mini").hidden = true; }
  });
  document.addEventListener("mousemove", (e) => { if (!$("#mini").hidden && miniAlvo) posicionarMini(e.clientX, e.clientY); }, { passive: true });
  addEventListener("scroll", () => { $("#mini").hidden = true; miniAlvo = null; }, { passive: true });
}

// ============================== eventos ==============================
document.addEventListener("click", (e) => {
  const t = e.target;
  // grupos de linhas: clique no título ou na linha-guia recolhe/expande
  const guia = t.closest(".guia"), cabG = !guia && t.closest("tr.grupo");
  if (guia || cabG) { alternarGrupo(guia ? guia.dataset.guia : cabG.dataset.g); return; }
  const ord = t.closest("button.ord");
  if (ord) { clicarOrdem(ord.dataset.ord, ord.dataset.col, ord.dataset.txt === "1"); renderResultado(); return; }
  const min = t.closest(".btn-min");
  if (min) {
    const k = min.dataset.min; st.minimizados.has(k) ? st.minimizados.delete(k) : st.minimizados.add(k);
    salvar("minimizados", [...st.minimizados]); aplicarMinimizados(); return;
  }
  const bIdx = t.closest("#idxChips button");
  if (bIdx) {
    const k = bIdx.dataset.idx; st.idxSel.has(k) ? st.idxSel.delete(k) : st.idxSel.add(k);
    salvar("indices", [...st.idxSel]); desenharChipsIndices(); renderResultado(); return;
  }
  if (t.closest("#riscoEixo button")) { st.riscoEixo = t.closest("button").dataset.e; salvar("riscoEixo", st.riscoEixo); delete st.ord.risco; renderResultado(); return; }
  if (t.id === "btnTravar") { st.travar = !st.travar; salvar("travar", st.travar); desenharTravar(); return; }
  if (t.id === "btnTopo") { scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); return; }
  if (t.id === "abrirFontes") { $("#dlgFontes").showModal(); return; }
  if (t.closest("[data-fechar]") || t.id === "dlgFontes") { $("#dlgFontes").close(); return; }
  if (t.id === "jmAtualizar") { calcularJM(); renderJM(); return; }
  if (t.id === "jmBaixar") { baixarJM(); return; }
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
document.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("tr.grupo")) { e.preventDefault(); alternarGrupo(e.target.dataset.g); }
});
// linha-guia do grupo: ao passar o mouse, destaca a guia do grupo inteiro
document.addEventListener("mouseover", (e) => {
  const g = e.target.closest?.(".guia");
  $$("tr.guia-ativa").forEach((r) => r.classList.remove("guia-ativa"));
  if (g) $$(`tr[data-gm="${CSS.escape(g.dataset.guia)}"]`).forEach((r) => r.classList.add("guia-ativa"));
});
document.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.matches("#dlgTabela input[type=checkbox]")) {
    const c = t.dataset.c;
    dlg.sel = t.checked ? [...new Set([...dlg.sel, c])] : dlg.sel.filter((x) => x !== c); renderSelDialogo();
  }
  else if (t.id === "dlgAtivos") renderSeletor();
  else if (t.dataset.todos) { st.todos[t.dataset.todos] = t.checked; renderResultado(); }
  else if (t.id === "agrupar") { st.agrupar = t.value; salvar("agrupar", st.agrupar); renderResultado(); }
  else if (t.id === "relOn") { st.rel.on = t.checked; renderResultado(); }
  else if (t.id === "alvo") { st.rel.alvo = t.value; renderResultado(); }
  else if (t.id === "guardar") { await D.definirGuardar(t.checked); atualizarEspaco(); }
  else if (t.id === "jmIni") st.jmIniAuto = false;
  else if (t.id === "jmFim") st.jmFimAuto = false;
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
addEventListener("scroll", () => { $("#btnTopo").hidden = scrollY < 400; }, { passive: true });
$("#guardar").checked = (() => { try { return JSON.parse(localStorage.getItem("fundos.guardar") ?? "true"); } catch { return true; } })();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { desenharChipsIndices(); renderResultado(); });

aplicarMinimizados();
desenharTravar();
iniciar();
