// Análise de Fundos — página principal (etapas 2 e 3)
import Chart from "https://cdn.jsdelivr.net/npm/chart.js@4.5.1/auto/+esm";
import * as D from "./dados.js";
import { COLUNAS, PERIODOS, calcularFundo, serieAcumulada, fmtData, diaDe, diaYMD, partes, lowerBound, upperBound, somarMeses } from "./calculos.js";
import { INDICES, corIndice, nomeIndice, serieIndice, retornoVol, nivelEm } from "./indices.js";
import { janelaMovel, resumoJanela, retornosFundo, retornosDiarios, matrizCorrelacao } from "./analises.js";
import { simularCarteira, estatisticas, curvaDrawdown } from "./carteira.js";

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
  jmBench: { tipo: "i", v: "CDI", rot: "CDI" },
  cart: Object.assign({ itens: [], rebal: 0, ref: { tipo: "i", v: "CDI", rot: "CDI" }, valor: 10000, ini: "", fim: "" }, pref("carteira", {})),
  ctx: null,                                            // contexto do último cálculo exibido (período, cores, datas)
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
    montarCombos();
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
  const b = st.jmBench;
  let bench = b.tipo === "n" ? "" : b.v, nomeB = b.tipo === "n" ? "" : b.rot, cBench = null;
  if (b.tipo === "f") {                                   // outro fundo como benchmark (precisa estar calculado)
    const g = res.fundos.get(b.v);
    if (!g) { st.jmBench = { tipo: "i", v: "CDI", rot: "CDI" }; definirCombo("cbJmBench", "CDI"); bench = "CDI"; nomeB = "CDI"; }
    else { bench = { fundo: g }; cBench = b.v; }
  }
  const p = { bench, meses, ini: diaDe(new Date(ini)), fim: diaDe(new Date(fim)) };
  const porFundo = [];
  for (const c of res.sel) {
    if (c === cBench) continue;                           // o próprio benchmark fica de fora
    const f = res.fundos.get(c); if (!f) continue;
    const linhas = janelaMovel(f, st.idx, p);
    const resumo = linhas.length ? resumoJanela(linhas) : null;
    if (resumo) porFundo.push({ c, linhas, resumo });
  }
  res.jm = { p, porFundo, nomeB };
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
  renderMetricas();
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
let _corTexto = null;                      // lida uma vez (ler o estilo a cada gráfico força o navegador a recalcular a página)
const corTexto = () => (_corTexto ||= getComputedStyle(document.body).getPropertyValue("--txt").trim() || "#333");
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { _corTexto = null; });
const escuro = () => matchMedia("(prefers-color-scheme: dark)").matches;
const linhaRef = { id: "linhaRef", afterDraw(ch, _a, o) {
  const ctx = ch.ctx, { left, right, top, bottom } = ch.chartArea;
  ctx.save(); ctx.strokeStyle = escuro() ? OURO : ANIL; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
  if (o?.y != null) { const y = ch.scales.y.getPixelForValue(o.y); ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); }
  if (o?.x != null) { const x = ch.scales.x.getPixelForValue(o.x); ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); }
  ctx.restore(); } };
// nomes escritos ao lado dos pontos marcados (benchmarks, carteira e fundos destacados) nos gráficos de risco × retorno
const rotulos = { id: "rotulos", afterDatasetsDraw(ch) {
  const ctx = ch.ctx; ctx.save(); ctx.font = "600 11px Manrope, sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = corTexto();
  ch.data.datasets.forEach((ds, i) => {
    const meta = ch.getDatasetMeta(i); if (meta.hidden) return;
    ds.data.forEach((p, k) => { if (p.rotulo && meta.data[k]) ctx.fillText(p.nome, meta.data[k].x, meta.data[k].y - 12); });
  });
  ctx.restore(); } };

// linhas no tempo. s.bench = tracejada; s.fraca = fina e clara (ativos da carteira); s.forte = grossa (carteira)
function grafico(id, series, { fmtY = (v) => brPct(v, 1), ref = null, xMin, xMax, tituloX = fmtData } = {}) {
  const algum = series.some((s) => !s.bench && !s.forte && casa(st.destaque, s.nome));
  const datasets = series.map((s) => {
    const ativo = !algum || s.bench || s.forte || casa(st.destaque, s.nome);
    const cor = s.cor + (!ativo ? "22" : s.fraca ? "88" : "");
    return { label: s.nome, data: s.x.map((x, i) => ({ x, y: s.y[i] })), borderColor: cor, backgroundColor: cor,
      borderWidth: s.forte ? 3.2 : s.fraca ? 1.1 : algum && ativo && !s.bench ? 3 : 1.4, borderDash: s.bench ? [6, 4] : [], pointRadius: 0,
      pointHoverRadius: 4, order: s.forte ? -1 : ativo ? 0 : 1 };
  });
  const ant = st.graficos[id];
  if (ant && ant.config.type === "line" && ant.canvas === $("#" + id)) {     // já existe: só troca os dados (bem mais rápido)
    ant.data.datasets = datasets;
    Object.assign(ant.options.scales.x, { min: xMin, max: xMax });
    ant.options.scales.y.ticks.callback = (v) => fmtY(v);
    ant.options.plugins.linhaRef = { y: ref };
    ant.options.plugins.tooltip.callbacks.title = (it) => tituloX(it[0].parsed.x);
    ant.options.plugins.tooltip.callbacks.label = (it) => `${it.dataset.label}: ${fmtY(it.parsed.y)}`;
    ant.update("none");
    return;
  }
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

// estrela de 4 pontas preenchida (marcador da carteira)
function estrela(cor, tam = 28) {
  const c = document.createElement("canvas"), r = devicePixelRatio || 1;
  c.width = c.height = tam * r; c.style.width = c.style.height = tam + "px";
  const g = c.getContext("2d"); g.scale(r, r);
  const m = tam / 2, a = tam / 2 - 1, q = a * 0.2;
  g.beginPath(); g.moveTo(m, m - a);
  g.quadraticCurveTo(m + q, m - q, m + a, m); g.quadraticCurveTo(m + q, m + q, m, m + a);
  g.quadraticCurveTo(m - q, m + q, m - a, m); g.quadraticCurveTo(m - q, m - q, m, m - a);
  g.closePath(); g.fillStyle = cor; g.fill(); g.lineWidth = 1.2; g.strokeStyle = escuro() ? "#0b0f2c" : "#ffffff"; g.stroke();
  return c;
}
// dispersão risco × retorno com poucos conjuntos de pontos (rápido mesmo com centenas de fundos)
// pts: { nome, cor, x, y, tipo: "fundo" | "bench" | "carteira", forte, apagado }
function graficoRR(id, pts, { fmtX, tituloX, refX = null }) {
  const grupo = (tipo, estilo) => {
    const ps = pts.filter((p) => p.tipo === tipo);
    return { label: tipo, data: ps.map((p) => ({ x: p.x, y: p.y, nome: p.nome, rotulo: p.tipo !== "fundo" || p.forte })),
      backgroundColor: ps.map((p) => p.cor + (p.apagado ? "33" : "")),
      borderColor: ps.map((p) => (p.forte ? (escuro() ? "#fff" : ANIL) : tipo === "fundo" ? "#ffffff" : OURO)),
      borderWidth: ps.map((p) => (p.forte ? 2 : 1)), pointRadius: ps.map((p) => (p.forte ? 9 : estilo.r)), pointHoverRadius: 10,
      pointStyle: estilo.forma === "estrela" ? ps.map((p) => estrela(p.cor)) : estilo.forma, order: estilo.ordem };
  };
  const datasets = [grupo("fundo", { r: 6, forma: "circle", ordem: 2 }), grupo("bench", { r: 8, forma: "rectRot", ordem: 1 }),
    grupo("carteira", { r: 12, forma: "estrela", ordem: 0 })];
  const ant = st.graficos[id];
  if (ant && ant.config.type === "scatter" && ant.canvas === $("#" + id)) {     // já existe: só troca os pontos
    ant.data.datasets = datasets;
    ant.options.scales.x.title.text = tituloX; ant.options.scales.x.ticks.callback = fmtX;
    ant.options.plugins.linhaRef = { x: refX };
    ant.options.plugins.tooltip.callbacks.label = (it) => `${it.raw.nome}: volatilidade ${brPct(it.parsed.y)} · ${tituloX.startsWith("Retorno") ? "retorno " + brPct(it.parsed.x) + " a.a." : "Sharpe " + br(it.parsed.x, 2)}`;
    ant.update("none");
    return;
  }
  st.graficos[id] = new Chart($("#" + id), {
    type: "scatter",
    data: { datasets },
    options: {
      animation: false, responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, linhaRef: { x: refX },
        tooltip: { callbacks: { label: (it) => `${it.raw.nome}: volatilidade ${brPct(it.parsed.y)} · ${tituloX.startsWith("Retorno") ? "retorno " + brPct(it.parsed.x) + " a.a." : "Sharpe " + br(it.parsed.x, 2)}` } } },
      scales: {
        x: { title: { display: true, text: tituloX, color: corTexto() }, ticks: { callback: fmtX, color: corTexto() }, grid: { color: "rgba(128,128,128,.15)" } },
        y: { min: 0, title: { display: true, text: "Volatilidade (risco, % a.a.)", color: corTexto() },
          ticks: { callback: (v) => brPct(v, 1), color: corTexto() }, grid: { color: "rgba(128,128,128,.15)" } },
      },
    },
    plugins: [linhaRef, rotulos],
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

// Redesenho completo (novo cálculo, troca de período ou destaque). As outras ações redesenham só a parte afetada.
function renderResultado() {
  const res = st.res;
  aplicarMinimizados();
  if (!res) return;
  const pers = Object.keys(res.periodos);
  $("#barraPer").innerHTML = pers.map((p) => `<button data-per="${p}" aria-pressed="${p === st.perAtivo}">${p}</button>`).join("");
  desenharTravar();
  const dados = res.periodos[st.perAtivo];
  $("#semDados").innerHTML = dados.semDados.length
    ? `<details><summary>⏳ ${dados.semDados.length} fundo(s) sem dados neste período · ver quais</summary>${dados.semDados.map((c) => esc(st.porCnpj.get(c)?.NOME || c)).join("; ")}</details>` : "";
  $("#vazio").hidden = true;
  renderJM();
  if (!dados.linhas.length) { $("#resultado").hidden = true; st.ctx = null; renderCarteira(); return; }
  $("#resultado").hidden = false;
  const cores = coresFundos();
  const dIni = Math.min(...dados.linhas.map((l) => l["Data Inicial"])), dFim = Math.max(...dados.linhas.map((l) => l["Data Final"]));
  const fundosSeries = dados.linhas.map((l) => { const s = dados.series.get(l._c); return { c: l._c, nome: res.apelidos[l._c], cor: cores[l._c], x: s.d, acum: s.acum, dd: s.dd, parado: l._parado }; });
  st.ctx = { dados, cores, dIni, dFim, fundosSeries };
  renderMetricas();
  const z = st.zoom[st.perAtivo] || [dIni, dFim];
  st.zoom[st.perAtivo] = z;
  configurarSlider(dIni, dFim, z);
  renderAcum(); renderDd(); renderRisco(); renderCorrelacao();
  renderCarteira();
  avisoDesatualizado();
}
function renderMetricas() {
  const c = st.ctx; if (!c) return;
  $("#tituloMet").textContent = `Métricas · ${st.perAtivo}`;
  $("#agrupar").value = st.agrupar;
  $("#tabMetricas").innerHTML = tabelaMetricas(c.dados);
}
const cortar = (s) => { const [zi, zf] = st.zoom[st.perAtivo]; const a = lowerBound(s.x, zi), b = upperBound(s.x, zf); return { ...s, x: s.x.slice(a, b), y: s.y.slice(a, b) }; };
const finalDe = (s) => (s.y.length ? s.y[s.y.length - 1] : null);

function renderAcum() {
  const c = st.ctx; if (!c) return;
  const [zi, zf] = st.zoom[st.perAtivo];
  $("#relOn").checked = st.rel.on;
  $("#relCtl").hidden = !st.rel.on;
  $$("#relModo button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.m === st.rel.modo));
  definirCombo("cbAlvo", st.rel.alvo);
  let series = [...c.fundosSeries.map((s) => ({ nome: s.nome, c: s.c, cor: s.cor, x: s.x, y: s.acum, parado: s.parado })), ...seriesIndices(c.dIni, c.dFim)];
  let ref = null, fmtY = (v) => brPct(v, 1);
  if (st.rel.on) {
    const kAlvo = st.idx.disponiveis.find((k) => nomeIndice(k) === st.rel.alvo);
    const bench = kAlvo ? seriesIndices(c.dIni, c.dFim, [kAlvo])[0] : series.find((s) => s.nome === st.rel.alvo);
    if (bench) {
      series = series.filter((s) => !s.bench && s.nome !== st.rel.alvo).map((s) => relativa(s, bench, st.rel.modo));
      ref = st.rel.modo === "dif" ? 0 : 1;
      if (st.rel.modo === "pct") fmtY = (v) => brPct(v, 0);
    }
    $("#relNota").textContent = st.rel.modo === "dif"
      ? `Rentabilidade acumulada do fundo menos a do ${st.rel.alvo} (ex.: ${st.rel.alvo} + 5%).`
      : `Rentabilidade do fundo ÷ a do ${st.rel.alvo} (ex.: 150% do ${st.rel.alvo}). Início omitido enquanto o benchmark está perto de zero.`;
  } else $("#relNota").textContent = "";
  series = series.map(cortar);
  grafico("gAcum", series, { fmtY, ref, xMin: zi, xMax: zf });
  $("#legAcum").innerHTML = tabelaLegenda("acum", series.map((s) => ({ Fundo: s.nome, _c: s.c, cor: s.cor, _parado: s.parado, Final: finalDe(s) })), ["Final"]);
}
function renderDd() {
  const c = st.ctx; if (!c) return;
  const [zi, zf] = st.zoom[st.perAtivo];
  const series = c.fundosSeries.map((s) => cortar({ nome: s.nome, c: s.c, cor: s.cor, x: s.x, y: s.dd, parado: s.parado }));
  grafico("gDd", series, { xMin: zi, xMax: zf });
  const mdd = Object.fromEntries(c.dados.linhas.map((l) => [st.res.apelidos[l._c], l.Queda]));
  $("#legDd").innerHTML = tabelaLegenda("dd", series.map((s) => ({ Fundo: s.nome, _c: s.c, cor: s.cor, _parado: s.parado, Final: finalDe(s), "Máx. queda": mdd[s.nome] })), ["Final", "Máx. queda"]);
}

// ---------- risco × retorno: volatilidade no eixo Y; retorno a.a. ou Sharpe no eixo X
function renderRisco() {
  const ctx = st.ctx; if (!ctx) return;
  const { dados, cores, dIni, dFim } = ctx;
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
  ctx.riscoPts = pts;
  $("#riscoNota").textContent = `Período de ${fmtData(dIni)} a ${fmtData(dFim)} (o controle de datas dos gráficos acima não muda este quadro).` +
    (avisos.length ? ` Índices com dado só ${avisos.join(", ")} (divulgação mensal).` : "") +
    (eixo === "sharpe" ? " Sharpe = (retorno a.a. − CDI a.a.) ÷ volatilidade; inflação e taxas ficam de fora." : "");
  const algum = pts.some((p) => !p.bench && casa(st.destaque, p.nome, p.cnpj));
  graficoRR("gRisco", pts.filter((p) => p[chaveX] != null).map((p) => {
    const marcado = !p.bench && algum && casa(st.destaque, p.nome, p.cnpj);
    return { nome: p.nome, cor: p.cor, x: p[chaveX], y: p.vol, tipo: p.bench ? "bench" : "fundo", forte: marcado, apagado: algum && !p.bench && !marcado };
  }), { fmtX: chaveX === "ret" ? (v) => brPct(v, 1) : (v) => br(v, 2), tituloX: chaveX === "ret" ? "Retorno (% a.a.)" : "Sharpe (sobre o CDI)",
    refX: chaveX === "sharpe" ? 0 : null });
  renderTabRisco();
}
function renderTabRisco() {
  const pts = st.ctx?.riscoPts; if (!pts) return;
  const chaveX = st.riscoEixo === "ret" ? "ret" : "sharpe";
  const colunas = [
    { chave: "nome", nome: "Fundo / índice", tipo: "txt", html: (v, l) => `<span class="sw${l.bench ? " losango" : ""}" style="background:${l.cor}"></span>${marcaParado({ _parado: l.parado })}` +
      (l.c ? `<span data-mini="${esc(l.c)}">${esc(v)}</span>` : `<i>${esc(v)}</i>`) },
    { chave: "ret", nome: "Retorno a.a.", tipo: "pct", cor: true }, { chave: "vol", nome: "Volatilidade", tipo: "pct" },
    { chave: "sharpe", nome: "Sharpe", tipo: "num2", cor: true }];
  const linhas = st.ord.risco ? ordenar(pts, "risco", colunas) : [...pts].sort((a, b) => (b[chaveX] ?? -Infinity) - (a[chaveX] ?? -Infinity));
  const dest = linhas.map((p) => !p.bench && casa(st.destaque, p.nome, p.cnpj));
  $("#tabRisco").innerHTML = tabelaHTML({ colunas, linhas, destacar: dest, altura: 420, ordenavel: "risco" });
}

// ---------- correlação dos retornos diários (fundos + índices de preço escolhidos)
const LIMITE_TABELA_CORR = 60;            // acima disso a matriz vira uma imagem (uma tabela enorme trava o navegador)
function renderCorrelacao() {
  const ctx = st.ctx; if (!ctx) return;
  const { dados, cores, dIni, dFim } = ctx;
  const idxPreco = [...st.idxSel].filter((k) => INDICES[k].tipo === "preco");
  const chave = idxPreco.join(",");
  if (!dados._corr || dados._corr.chave !== chave) {           // a matriz só é recalculada se mudar o período ou os índices
    const itens = dados.linhas.map((l) => ({ nome: st.res.apelidos[l._c], c: l._c, cor: cores[l._c], cnpj: l.CNPJ,
      ret: retornosFundo(st.res.fundos.get(l._c), dIni, dFim) }));
    for (const k of idxPreco) itens.push({ nome: nomeIndice(k), cor: corIndice(k), bench: true, ret: retornosDiarios(st.idx, k, dIni, dFim) });
    dados._corr = { chave, itens, m: itens.length >= 2 ? matrizCorrelacao(itens.map((i) => i.ret)) : null };
  }
  const { itens, m } = dados._corr, n = itens.length;
  if (n < 2) { $("#tabCorr").innerHTML = `<p class="nota">Selecione pelo menos 2 fundos.</p>`; $("#corrNota").textContent = ""; return; }
  const marc = itens.map((it) => !it.bench && casa(st.destaque, it.nome, it.cnpj));
  const r = (i, j) => { const v = m[i * n + j]; return Number.isNaN(v) ? null : v; };
  $("#corrNota").textContent = `Retornos diários de ${fmtData(dIni)} a ${fmtData(dFim)}, nos dias em que os dois têm dado. 1 = andam juntos; 0 = sem relação; −1 = sentidos opostos.` +
    (n > LIMITE_TABELA_CORR ? ` ${n} séries: passe o mouse sobre o quadro para ver cada par; destaque um fundo para ver os mais e os menos correlacionados com ele.`
      : n > 10 ? ` ${n} linhas: role dentro do quadro (os nomes das colunas ficam embaixo).` : "");
  // fundo destacado: os 5 mais e os 5 menos correlacionados com ele
  const alvo = marc.indexOf(true);
  let extremos = "";
  if (alvo >= 0) {
    const outros = itens.map((it, j) => ({ it, v: r(alvo, j) })).filter((x, j) => j !== alvo && x.v != null).sort((a, b) => b.v - a.v);
    const lin = (x) => `<tr><td class="t"><span class="sw${x.it.bench ? " losango" : ""}" style="background:${x.it.cor}"></span>${esc(x.it.nome)}</td><td>${br(x.v, 2)}</td></tr>`;
    if (outros.length) extremos = `<div class="corr-ext"><div><h3 class="sub">Mais correlacionados com ${esc(itens[alvo].nome)}</h3><table class="tb">${outros.slice(0, 5).map(lin).join("")}</table></div>
      <div><h3 class="sub">Menos correlacionados</h3><table class="tb">${outros.slice(-5).reverse().map(lin).join("")}</table></div></div>`;
  }
  if (n > LIMITE_TABELA_CORR) { corrCanvas(itens, r, marc, extremos); return; }
  const rot = (it, i) => `${i + 1}. ${curto(it.nome, 34)}`;
  const cel = (v, i, j) => {
    const hc = marc[j] || marc[i] ? " hc" : "";
    if (i === j) return `<td class="c eu${hc}">1</td>`;
    if (v == null) return `<td class="c nd${hc}" title="Menos de 20 dias em comum">n/a</td>`;
    return `<td class="c${hc}" style="background:${corCorr(v)};${Math.abs(v) > 0.6 ? "color:#fff" : ""}" title="${esc(itens[i].nome)} × ${esc(itens[j].nome)}: ${br(v, 2)}">${br(v, 2)}</td>`;
  };
  const corpo = itens.map((it, i) => `<tr${marc[i] ? ' class="hl"' : ""}><th class="rot" title="${esc(it.nome)}"><span class="sw${it.bench ? " losango" : ""}" style="background:${it.cor}"></span>` +
    (it.c ? `<span data-mini="${esc(it.c)}">${esc(rot(it, i))}</span>` : esc(rot(it, i))) + `</th>${itens.map((_, j) => cel(r(i, j), i, j)).join("")}</tr>`).join("");
  const pe = `<tr><th class="canto"></th>${itens.map((it, j) => `<th class="col${marc[j] ? " hl" : ""}" title="${esc(it.nome)}"><span>${esc(rot(it, j))}</span></th>`).join("")}</tr>`;
  $("#tabCorr").innerHTML = `<div class="corr-wrap" style="max-height:${Math.min(n, 10) * 29 + 170}px"><table class="corr"><tbody>${corpo}</tbody><tfoot>${pe}</tfoot></table></div>` + extremos;
}
const corCorr = (v) => { const a = Math.min(0.8, Math.abs(v) * 0.8); return v >= 0 ? `rgba(31,90,166,${a})` : `rgba(208,38,44,${a})`; };

// matriz grande: desenhada numa imagem (canvas); o par aparece ao passar o mouse
function corrCanvas(itens, r, marc, extremos) {
  const n = itens.length, cont = $("#tabCorr");
  const lado = Math.max(2, Math.min(14, Math.floor(((cont.clientWidth || 1000) - 30) / n))), tam = lado * n, dpr = devicePixelRatio || 1;
  cont.innerHTML = `<div class="corr-cv"><canvas id="cvCorr" width="${tam * dpr}" height="${tam * dpr}" style="width:${tam}px;height:${tam}px"></canvas></div>
    <div class="corr-escala"><span>−1</span><i></i><span>+1</span><span class="nota">· dourado = o próprio fundo · cinza = menos de 20 dias em comum</span></div>` + extremos;
  const cv = $("#cvCorr"), g = cv.getContext("2d"), W = Math.round(tam * dpr), px = W / n;
  const img = g.createImageData(W, W), buf = img.data;
  const pinta = (i, j, rr, gg, bb, aa) => {
    const y0 = Math.round(i * px), y1 = Math.round((i + 1) * px), x0 = Math.round(j * px), x1 = Math.round((j + 1) * px);
    for (let y = y0; y < y1; y++) for (let x = x0, o = (y * W + x0) * 4; x < x1; x++, o += 4) { buf[o] = rr; buf[o + 1] = gg; buf[o + 2] = bb; buf[o + 3] = aa; }
  };
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = i === j ? 1 : r(i, j);
    if (i === j) pinta(i, j, 201, 162, 58, 255);
    else if (v == null) pinta(i, j, 127, 127, 127, 64);
    else if (v >= 0) pinta(i, j, 31, 90, 166, Math.round(255 * (0.08 + Math.min(0.92, v))));
    else pinta(i, j, 208, 38, 44, Math.round(255 * (0.08 + Math.min(0.92, -v))));
  }
  g.putImageData(img, 0, 0);
  g.scale(dpr, dpr);
  g.strokeStyle = OURO; g.lineWidth = 2;
  marc.forEach((mk, i) => { if (mk) { g.strokeRect(0, i * lado, tam, lado); g.strokeRect(i * lado, 0, lado, tam); } });
  const tip = $("#corrTip");
  cv.onmousemove = (e) => {
    const b = cv.getBoundingClientRect(), i = Math.floor((e.clientY - b.top) / lado), j = Math.floor((e.clientX - b.left) / lado);
    if (i < 0 || j < 0 || i >= n || j >= n) { tip.hidden = true; return; }
    const v = i === j ? 1 : r(i, j);
    tip.innerHTML = `<div class="mini-tit">${esc(itens[i].nome)}</div><div class="mini-tit">× ${esc(itens[j].nome)}</div>
      <div class="mini-rod">Correlação: <b>${v == null ? "n/a" : br(v, 2)}</b></div>`;
    tip.style.left = Math.min(e.clientX + 14, innerWidth - 270) + "px"; tip.style.top = (e.clientY + 14) + "px"; tip.hidden = false;
  };
  cv.onmouseleave = () => { tip.hidden = true; };
}

// ---------- janela móvel
function renderJM() {
  const jm = st.res?.jm;
  $("#secJM").hidden = !st.res;
  if (!jm) return;
  const cores = coresFundos();
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
  renderTabJM();
}
function renderTabJM() {
  const jm = st.res?.jm; if (!jm || !jm.porFundo.length) return;
  const B = curto(jm.nomeB || "Benchmark", 24);
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
    `${B} anualizado`, "Fundo anualizado", `Diferença para o ${B}`].map((x) => x.replace(/;/g, ","));
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

// ============================== caixa de escolha com busca (combo) ==============================
// Usada em "Relativa a", no benchmark da janela móvel e na carteira. Digite para filtrar; ↑ ↓ Enter escolhem; Esc fecha.
const combos = {};
const semAcento = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const LIMITE_COMBO = 80;
function criarCombo(id, { opcoes, aoEscolher, placeholder = "Digite para buscar…", limpar = false }) {
  const el = $("#" + id); if (!el) return;
  el.innerHTML = `<input class="combo-in" type="text" autocomplete="off" spellcheck="false" placeholder="${esc(placeholder)}" aria-autocomplete="list">
    <span class="combo-seta" aria-hidden="true">▾</span><div class="combo-lista" role="listbox" hidden></div>`;
  combos[id] = { opcoes, aoEscolher, limpar, rot: "", vis: [], ativo: -1 };
}
function definirCombo(id, rot) { const cb = combos[id]; if (!cb) return; cb.rot = rot; const i = $(`#${id} .combo-in`); if (i && document.activeElement !== i) i.value = rot; }
function abrirCombo(id, filtro) {
  const cb = combos[id], lista = $(`#${id} .combo-lista`);
  const q = semAcento(filtro).trim(), dig = q.replace(/\D/g, "");
  const ok = cb.opcoes().filter((o) => !q || semAcento(o.rot).includes(q) || (dig.length >= 4 && (o.cnpj || "").includes(dig)));
  cb.vis = ok.slice(0, LIMITE_COMBO); cb.ativo = cb.vis.length ? 0 : -1;
  let h = "", grupo = null;
  cb.vis.forEach((o, i) => {
    if (o.grupo !== grupo) { h += `<div class="combo-g">${esc(o.grupo)}</div>`; grupo = o.grupo; }
    h += `<div class="combo-op${i === 0 ? " at" : ""}${o.rot === cb.rot ? " atual" : ""}" data-i="${i}" role="option">` +
      `${o.cor ? `<span class="sw${o.losango ? " losango" : ""}" style="background:${o.cor}"></span>` : ""}${esc(o.rot)}</div>`;
  });
  if (ok.length > LIMITE_COMBO) h += `<div class="combo-mais">+${ok.length - LIMITE_COMBO} itens · digite para filtrar</div>`;
  if (!ok.length) h = `<div class="combo-mais">Nada encontrado</div>`;
  lista.innerHTML = h; lista.hidden = false;
}
function fecharCombo(id) {
  const cb = combos[id]; if (!cb) return;
  $(`#${id} .combo-lista`).hidden = true;
  $(`#${id} .combo-in`).value = cb.limpar ? "" : cb.rot;
}
function escolherCombo(id, i) {
  const cb = combos[id], o = cb.vis[i]; if (!o) return;
  if (!cb.limpar) cb.rot = o.rot;
  $(`#${id} .combo-in`).blur(); fecharCombo(id);
  cb.aoEscolher(o);
}
function moverCombo(id, passo) {
  const cb = combos[id]; if (!cb.vis.length) return;
  cb.ativo = (cb.ativo + passo + cb.vis.length) % cb.vis.length;
  $$(`#${id} .combo-op`).forEach((e) => e.classList.toggle("at", Number(e.dataset.i) === cb.ativo));
  $(`#${id} .combo-op[data-i="${cb.ativo}"]`)?.scrollIntoView({ block: "nearest" });
}
document.addEventListener("focusin", (e) => { const c = e.target.closest?.(".combo"); if (c && e.target.matches(".combo-in")) { e.target.select(); abrirCombo(c.id, ""); } });
document.addEventListener("focusout", (e) => { const c = e.target.closest?.(".combo"); if (c && e.target.matches(".combo-in")) setTimeout(() => fecharCombo(c.id), 150); });
document.addEventListener("input", (e) => { const c = e.target.closest?.(".combo"); if (c && e.target.matches(".combo-in")) abrirCombo(c.id, e.target.value); });
document.addEventListener("keydown", (e) => {
  const c = e.target.closest?.(".combo"); if (!c || !e.target.matches(".combo-in")) return;
  if (e.key === "ArrowDown") { e.preventDefault(); moverCombo(c.id, 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); moverCombo(c.id, -1); }
  else if (e.key === "Enter") { e.preventDefault(); escolherCombo(c.id, combos[c.id].ativo); }
  else if (e.key === "Escape") { e.target.blur(); }
});
document.addEventListener("mousedown", (e) => {
  const op = e.target.closest?.(".combo-op"); if (!op) return;
  e.preventDefault(); escolherCombo(op.closest(".combo").id, Number(op.dataset.i));
});

// opções comuns: índices e fundos calculados
const opcoesIndices = () => st.idx.disponiveis.map((k) => ({ tipo: "i", v: k, rot: nomeIndice(k), grupo: "Índices", cor: corIndice(k), losango: true }));
const opcoesFundos = (lista = st.res?.sel || []) => { const cores = coresFundos();
  return lista.filter((c) => st.res?.fundos.get(c)).map((c) => ({ tipo: "f", v: c, rot: st.res.apelidos[c], cnpj: c, grupo: "Fundos calculados", cor: cores[c] })); };

function montarCombos() {
  criarCombo("cbAlvo", { opcoes: () => [...opcoesIndices(), ...opcoesFundos((st.ctx?.dados.linhas || []).map((l) => l._c))],
    aoEscolher: (o) => { st.rel.alvo = o.rot; renderAcum(); } });
  criarCombo("cbJmBench", { opcoes: () => [{ tipo: "n", v: "", rot: "Nenhum (retorno absoluto)", grupo: "Sem comparação" }, ...opcoesIndices(), ...opcoesFundos()],
    aoEscolher: (o) => { st.jmBench = { tipo: o.tipo, v: o.v, rot: o.rot }; calcularJM(); renderJM(); } });
  criarCombo("cbCartAdd", { limpar: true, placeholder: "Digite o nome, CNPJ ou índice…",
    opcoes: () => { const tem = new Set(st.cart.itens.map((x) => x.tipo + x.v)); return [...opcoesFundos(), ...opcoesIndices()].filter((o) => !tem.has(o.tipo + o.v)); },
    aoEscolher: (o) => { st.cart.itens.push({ tipo: o.tipo, v: o.v, peso: st.cart.itens.length ? 10 : 100 }); salvarCart(); renderCarteira(); } });
  criarCombo("cbCartRef", { opcoes: () => [...opcoesIndices(), ...opcoesFundos()],
    aoEscolher: (o) => { st.cart.ref = { tipo: o.tipo, v: o.v, rot: o.rot }; salvarCart(); calcularCarteira(); } });
  definirCombo("cbAlvo", st.rel.alvo); definirCombo("cbJmBench", st.jmBench.rot); definirCombo("cbCartRef", st.cart.ref.rot);
}

// ============================== montagem de carteira ==============================
const salvarCart = () => salvar("carteira", st.cart);
const nomeItem = (it) => (it.tipo === "i" ? nomeIndice(it.v) : st.res?.apelidos[it.v] || curto(st.porCnpj.get(it.v)?.NOME || cnpjFmt(it.v)));
const corItem = (it) => (it.tipo === "i" ? corIndice(it.v) : coresFundos()[it.v] || "#888888");
function serieItem(it) {
  if (it.tipo === "i") return st.idx.niveis[it.v] || null;
  const f = st.res?.fundos.get(it.v); return f && f.d.length ? { d: f.d, L: f.q } : null;
}
const REBAL = { 0: "", 1: "mensal", 3: "trimestral", 6: "semestral", 12: "anual" };

function renderCarteira() {
  $("#secCart").hidden = !st.res;
  if (!st.res) return;
  const c = st.cart;
  if (!c.ini || !c.fim) usarPeriodoAtivo(false);
  $("#cartRebal").value = String(c.rebal); $("#cartValor").value = c.valor; $("#cartIni").value = c.ini; $("#cartFim").value = c.fim;
  definirCombo("cbCartRef", c.ref.rot);
  $("#cartItens").innerHTML = !c.itens.length ? `<p class="nota">Nenhum ativo ainda. Use "Adicionar fundo ou índice" acima ou "Adicionar todos os fundos calculados".</p>` :
    `<div class="tb-wrap cart-lista"><table class="tb"><thead><tr><th class="t">Ativo</th><th>Peso (%)</th><th></th></tr></thead><tbody>${c.itens.map((it, i) => {
      const ok = serieItem(it);
      return `<tr${ok ? "" : ' class="indisp"'}><td class="t"><span class="sw${it.tipo === "i" ? " losango" : ""}" style="background:${corItem(it)}"></span>` +
        (it.tipo === "f" && ok ? `<span data-mini="${esc(it.v)}">${esc(nomeItem(it))}</span>` : esc(nomeItem(it))) +
        (ok ? "" : ` <small>· não calculado: selecione o fundo ao lado e clique em Calcular</small>`) + `</td>
        <td><input class="cart-peso" data-i="${i}" type="number" min="0" step="1" value="${it.peso}" aria-label="Peso de ${esc(nomeItem(it))}"></td>
        <td><button class="cart-rm" data-i="${i}" type="button" title="Tirar da carteira">×</button></td></tr>`; }).join("")}</tbody></table></div>`;
  atualizarSoma();
  calcularCarteira();
}
function atualizarSoma() {
  const s = st.cart.itens.reduce((a, it) => a + (Number(it.peso) || 0), 0);
  $("#cartSoma").innerHTML = st.cart.itens.length ? `Soma dos pesos: <b style="color:${Math.abs(s - 100) < 0.01 ? VERDE : VERMELHO}">${br(s, 1)}%</b>` +
    (Math.abs(s - 100) < 0.01 ? "" : " (o cálculo usa os pesos proporcionais, como se somassem 100%)") : "";
}
function usarPeriodoAtivo(recalcular = true) {
  const c = st.cart, ctx = st.ctx;
  const fim = ctx ? ctx.dFim : st.res.fimComum, ini = ctx ? ctx.dIni : somarMeses(fim, -36);
  c.ini = isoDe(ini); c.fim = isoDe(fim); salvarCart();
  if (recalcular) renderCarteira();
}

function calcularCarteira() {
  const c = st.cart, res = $("#cartRes");
  const validos = c.itens.filter((it) => (Number(it.peso) || 0) > 0 && serieItem(it));
  $("#cartGraf").hidden = true;
  ["gCartEvol", "gCartDD", "gCartRR"].forEach((g) => { st.graficos[g]?.destroy(); delete st.graficos[g]; });
  if (!validos.length) { res.innerHTML = c.itens.length ? `<p class="nota">Dê peso maior que zero a pelo menos um ativo calculado.</p>` : ""; return; }
  const soma = validos.reduce((a, it) => a + Number(it.peso), 0), pesos = validos.map((it) => Number(it.peso) / soma);
  const ini = diaDe(new Date(c.ini)), fim = diaDe(new Date(c.fim));
  const ativos = validos.map((it) => ({ s: serieItem(it), nome: nomeItem(it) }));
  const sim = simularCarteira(ativos, pesos, { ini, fim, rebal: Number(c.rebal) });
  if (!sim) { res.innerHTML = `<p class="nota">Sem dias em comum suficientes para todos os ativos entre ${esc(fmtData(ini))} e ${esc(fmtData(fim))}. Tente outro período ou tire o ativo mais novo.</p>`; return; }
  const d0 = sim.dias[0], dN = sim.dias[sim.dias.length - 1];
  const umSo = (s, nome) => (s ? simularCarteira([{ s, nome }], [1], { ini: d0, fim: dN }) : null);
  const simCdi = umSo(st.idx.niveis.CDI, "CDI"), cdiAnual = simCdi ? estatisticas(simCdi.dias, simCdi.valor).anual : null;
  // índices de taxa e de inflação quase não oscilam: o Sharpe deles não tem sentido e fica de fora
  const semSharpe = (it) => it.tipo === "i" && INDICES[it.v]?.tipo !== "preco";
  const est = (it, dias, v) => { const e = estatisticas(dias, v, cdiAnual); if (e && semSharpe(it)) e.sharpe = null; return e; };
  const eT = estatisticas(sim.dias, sim.valor, cdiAnual), eA = sim.porAtivo.map((v, k) => est(validos[k], sim.dias, v));
  const simRef = umSo(serieItem(c.ref), c.ref.rot), eRef = simRef ? est(c.ref, simRef.dias, simRef.valor) : null;
  const rebal = Number(c.rebal), simBH = rebal ? simularCarteira(ativos, pesos, { ini, fim, rebal: 0 }) : null;
  const eBH = simBH ? estatisticas(simBH.dias, simBH.valor, cdiAnual) : null;
  const v0 = Number(c.valor) || 0, pp = (v) => (v == null ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + br(Math.abs(v) * 100, 2) + " p.p.");
  const kpi = (rot, val, cor, dest) => `<div class="kpi${dest ? " dest" : ""}"><div class="l">${rot}</div><div class="v" style="${cor || ""}">${val}</div></div>`;
  const exc = eRef && eT.anual != null && eRef.anual != null ? eT.anual - eRef.anual : null;
  let h = `<div class="kpis">` +
    kpi("Retorno no período", brPct(eT.total), corSinal(eT.total)) + kpi("Ao ano", brPct(eT.anual), corSinal(eT.anual)) +
    kpi(`R$ ${br(v0, 0)} viram`, "R$ " + br(v0 * (1 + eT.total), 2), "", true) +
    kpi(`Contra ${esc(curto(c.ref.rot, 22))} (ao ano)`, pp(exc), corSinal(exc), true) +
    kpi("Volatilidade (ao ano)", brPct(eT.vol)) + kpi("Índice de Sharpe", eT.sharpe == null ? "–" : br(eT.sharpe, 2), corSinal(eT.sharpe)) +
    kpi("Máxima queda", brPct(eT.mdd), corSinal(eT.mdd)) +
    kpi("Meses positivos", eT.mesesPos == null ? "–" : `${br(eT.mesesPos * 100, 0)}% de ${eT.nMeses}`) +
    kpi("Melhor / pior mês", `${brPct(eT.melhorMes)} / ${brPct(eT.piorMes)}`) + `</div>`;
  // tabela por ativo, com a contribuição de cada um (a soma das contribuições é o retorno da carteira)
  const maxC = Math.max(1e-9, ...sim.contrib.map(Math.abs));
  const celP = (v) => `<td style="${corSinal(v)}">${brPct(v)}</td>`;
  const linhasA = validos.map((it, k) => `<tr><td class="t"><span class="sw${it.tipo === "i" ? " losango" : ""}" style="background:${corItem(it)}"></span>${esc(nomeItem(it))}</td>
    <td>${br(pesos[k] * 100, 1)}%</td>${celP(eA[k].total)}${celP(eA[k].anual)}<td>${brPct(eA[k].vol)}</td><td style="${corSinal(eA[k].sharpe)}">${eA[k].sharpe == null ? "–" : br(eA[k].sharpe, 2)}</td>
    ${celP(eA[k].mdd)}<td class="contrib"><b style="${corSinal(sim.contrib[k])}">${brPct(sim.contrib[k])}</b>
    <span class="minibar"><i class="${sim.contrib[k] >= 0 ? "up" : "down"}" style="width:${(Math.abs(sim.contrib[k]) / maxC * 50).toFixed(1)}%"></i></span></td></tr>`).join("");
  const linhaE = (cls, rot, e, extra = "") => `<tr class="${cls}"><td class="t">${rot}</td><td>${extra}</td>${celP(e.total)}${celP(e.anual)}<td>${brPct(e.vol)}</td>
    <td style="${corSinal(e.sharpe)}">${e.sharpe == null ? "–" : br(e.sharpe, 2)}</td>${celP(e.mdd)}<td></td></tr>`;
  const somaC = sim.contrib.reduce((a, b) => a + b, 0);
  h += `<div class="tb-wrap"><table class="tb cart-tab"><thead><tr><th class="t">Ativo</th><th>Peso</th><th>Retorno</th><th>Ao ano</th><th>Volatilidade</th><th>Sharpe</th>
    <th>Máx. queda</th><th>Contribuição para o retorno</th></tr></thead><tbody>${linhasA}
    <tr class="cart-total"><td class="t">Carteira${rebal ? ` (rebalanceamento ${REBAL[rebal]})` : " (comprar e manter)"}</td><td>100%</td>${celP(eT.total)}${celP(eT.anual)}
      <td>${brPct(eT.vol)}</td><td style="${corSinal(eT.sharpe)}">${eT.sharpe == null ? "–" : br(eT.sharpe, 2)}</td>${celP(eT.mdd)}<td style="${corSinal(somaC)}"><b>${brPct(somaC)}</b></td></tr>` +
    (eRef ? linhaE("cart-ref", `Referência: ${esc(c.ref.rot)}`, eRef) +
      `<tr class="cart-ref ef"><td class="t">Carteira contra a referência</td><td></td><td style="${corSinal(eT.total - eRef.total)}">${pp(eT.total - eRef.total)}</td>
       <td style="${corSinal(exc)}">${pp(exc)}</td><td colspan="4"></td></tr>` : "") +
    (eBH ? linhaE("cart-ref", "Mesma carteira sem rebalancear", eBH, "100%") +
      `<tr class="cart-ref ef"><td class="t">Efeito do rebalanceamento ${REBAL[rebal]}</td><td></td><td style="${corSinal(eT.total - eBH.total)}">${pp(eT.total - eBH.total)}</td><td colspan="5"></td></tr>` : "") +
    `</tbody></table></div>`;
  const avisos = [];
  if (sim.cortadoIni) avisos.push(`começa em ${fmtData(d0)} porque algum ativo não tem dado antes disso`);
  if (sim.cortadoFim) avisos.push(`termina em ${fmtData(dN)}, último dia com dado de ${esc(sim.limitante)}`);
  if (simRef && simRef.dias[simRef.dias.length - 1] < dN) avisos.push(`a referência só tem dado até ${fmtData(simRef.dias[simRef.dias.length - 1])}`);
  h += `<p class="nota">Período: ${fmtData(d0)} a ${fmtData(dN)} (${sim.dias.length} dias úteis)${avisos.length ? "; " + avisos.join("; ") : ""}.
    Contribuição = quanto cada ativo gerou de resultado sobre o valor inicial, considerando o peso que ele tinha a cada dia; a soma é o retorno da carteira.
    Sharpe sobre o CDI do mesmo período. Não considera impostos, taxas de saída nem prazos de resgate.</p>`;
  res.innerHTML = h;

  // gráficos
  $("#cartGraf").hidden = false;
  const corCart = escuro() ? "#ffffff" : "#141a4a", x = sim.dias;
  const fracas = validos.map((it, k) => ({ nome: nomeItem(it), cor: corItem(it), x, y: Array.from(sim.porAtivo[k], (v) => v * 100), fraca: true }));
  const refS = simRef ? [{ nome: "Referência: " + c.ref.rot, cor: corItem(c.ref), x: simRef.dias, y: Array.from(simRef.valor, (v) => v * 100), bench: true }] : [];
  grafico("gCartEvol", [...fracas, ...refS, { nome: "Carteira", cor: corCart, x, y: Array.from(sim.valor, (v) => v * 100), forte: true }],
    { fmtY: (v) => br(v, 1), xMin: d0, xMax: dN });
  grafico("gCartDD", [...validos.map((it, k) => ({ nome: nomeItem(it), cor: corItem(it), x, y: curvaDrawdown(sim.porAtivo[k]), fraca: true })),
    { nome: "Carteira", cor: corCart, x, y: curvaDrawdown(sim.valor), forte: true }], { xMin: d0, xMax: dN });
  graficoRR("gCartRR", [...validos.map((it, k) => ({ nome: nomeItem(it), cor: corItem(it), x: eA[k].anual, y: eA[k].vol, tipo: it.tipo === "i" ? "bench" : "fundo" })),
    ...(eRef ? [{ nome: c.ref.rot, cor: corItem(c.ref), x: eRef.anual, y: eRef.vol, tipo: "bench" }] : []),
    { nome: "Carteira", cor: OURO, x: eT.anual, y: eT.vol, tipo: "carteira" }], { fmtX: (v) => brPct(v, 1), tituloX: "Retorno (% a.a.)" });
}
let tCart;
const recalcularCarteiraDepois = () => { clearTimeout(tCart); tCart = setTimeout(calcularCarteira, 350); };

document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.matches(".cart-peso")) { st.cart.itens[Number(t.dataset.i)].peso = Math.max(0, Number(t.value) || 0); salvarCart(); atualizarSoma(); recalcularCarteiraDepois(); }
});
document.addEventListener("change", (e) => {
  const t = e.target, c = st.cart;
  if (t.id === "cartRebal") { c.rebal = Number(t.value); salvarCart(); calcularCarteira(); }
  else if (t.id === "cartValor") { c.valor = Math.max(0, Number(t.value) || 0); salvarCart(); calcularCarteira(); }
  else if (t.id === "cartIni" || t.id === "cartFim") { c[t.id === "cartIni" ? "ini" : "fim"] = t.value; salvarCart(); if (c.ini && c.fim) calcularCarteira(); }
});
document.addEventListener("click", (e) => {
  const t = e.target, c = st.cart;
  if (t.matches(".cart-rm")) { c.itens.splice(Number(t.dataset.i), 1); salvarCart(); renderCarteira(); }
  else if (t.id === "cartIguais" || t.id === "cartNormalizar") {
    const n = c.itens.length, s = c.itens.reduce((a, it) => a + (Number(it.peso) || 0), 0);
    if (!n) return;
    c.itens.forEach((it) => (it.peso = t.id === "cartIguais" || !s ? Math.round(10000 / n) / 100 : Math.round(Number(it.peso) / s * 10000) / 100));
    salvarCart(); renderCarteira();
  }
  else if (t.id === "cartTodos") {
    const tem = new Set(c.itens.filter((x) => x.tipo === "f").map((x) => x.v));
    (st.res?.sel || []).forEach((x) => { if (!tem.has(x) && st.res.fundos.get(x)) c.itens.push({ tipo: "f", v: x, peso: 0 }); });
    const n = c.itens.length; c.itens.forEach((it) => (it.peso = Math.round(10000 / n) / 100));
    salvarCart(); renderCarteira();
  }
  else if (t.id === "cartLimpar") { if (c.itens.length && !confirm("Tirar todos os ativos da carteira?")) return; c.itens = []; salvarCart(); renderCarteira(); }
  else if (t.id === "cartPeriodo") usarPeriodoAtivo(true);
});

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
  clearTimeout(tSlider); tSlider = setTimeout(() => { renderAcum(); renderDd(); }, 120);
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
  if (ord) {
    const tab = ord.dataset.ord; clicarOrdem(tab, ord.dataset.col, ord.dataset.txt === "1");
    ({ met: renderMetricas, risco: renderTabRisco, jm: renderTabJM })[tab]?.(); return;
  }
  const min = t.closest(".btn-min");
  if (min) {
    const k = min.dataset.min; st.minimizados.has(k) ? st.minimizados.delete(k) : st.minimizados.add(k);
    salvar("minimizados", [...st.minimizados]); aplicarMinimizados(); return;
  }
  const bIdx = t.closest("#idxChips button");
  if (bIdx) {
    const k = bIdx.dataset.idx; st.idxSel.has(k) ? st.idxSel.delete(k) : st.idxSel.add(k);
    salvar("indices", [...st.idxSel]); desenharChipsIndices(); renderAcum(); renderRisco(); renderCorrelacao(); return;
  }
  if (t.closest("#riscoEixo button")) { st.riscoEixo = t.closest("button").dataset.e; salvar("riscoEixo", st.riscoEixo); delete st.ord.risco; renderRisco(); return; }
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
  else if (t.closest("#relModo button")) { st.rel.modo = t.closest("button").dataset.m; renderAcum(); }
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
  else if (t.dataset.todos) { st.todos[t.dataset.todos] = t.checked; ({ acum: renderAcum, dd: renderDd, jm: renderJM })[t.dataset.todos]?.(); }
  else if (t.id === "agrupar") { st.agrupar = t.value; salvar("agrupar", st.agrupar); renderMetricas(); }
  else if (t.id === "relOn") { st.rel.on = t.checked; renderAcum(); }
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
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {      // troca de tema: recria os gráficos com as cores novas
  Object.values(st.graficos).forEach((g) => g?.destroy()); st.graficos = {};
  desenharChipsIndices(); renderResultado();
});

aplicarMinimizados();
desenharTravar();
iniciar();
