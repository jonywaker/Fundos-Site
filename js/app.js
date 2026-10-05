// Análise de Fundos — página principal (etapas 2 e 3)
import Chart from "https://cdn.jsdelivr.net/npm/chart.js@4.5.1/auto/+esm";
import * as D from "./dados.js";
import { COLUNAS, PERIODOS, calcularFundo, prepararFundo, serieAcumulada, fmtData, diaDe, diaYMD, partes, lowerBound, upperBound, somarMeses } from "./calculos.js";
import { INDICES, corIndice, nomeIndice, serieIndice, retornoVol, nivelEm } from "./indices.js";
import { janelaMovel, resumoJanela, retornosFundo, retornosDiarios, matrizCorrelacao } from "./analises.js";
import { simularCarteira, estatisticas, curvaDrawdown } from "./carteira.js";
import { GRUPOS_RANK, metricaRank, MODELOS_RANK, JM_ANOS, indiceObjetivo, pontuar, ordenarRanking } from "./ranking.js";

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
  cartRes: null,                                        // último cálculo da carteira
  cartUI: { rel: { on: false, alvo: "CDI", modo: "dif" }, eixo: "ret", jmBench: { tipo: "i", v: "CDI", rot: "CDI" }, jmMeses: 12, pts: null },
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
function avisoSel(html) { const el = $("#avisoSel"); el.innerHTML = html; clearTimeout(avisoSel.t); avisoSel.t = setTimeout(() => (el.innerHTML = ""), 9000); }

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

// ---------- janela de pergunta com botões (substitui o confirm do navegador)
function perguntar(titulo, texto, botoes) {
  const d = $("#dlgPergunta");
  $("#pergTit").textContent = titulo; $("#pergTexto").innerHTML = texto;
  $("#pergBotoes").innerHTML = botoes.map((b, i) => `<button type="button" class="${b.classe || "sec"}" data-i="${i}">${esc(b.rot)}</button>`).join("");
  d.showModal();
  $("#pergBotoes button:last-child").focus();
  return new Promise((ok) => {
    const fim = (v) => { d.close(); d.onclick = null; d.oncancel = null; ok(v); };
    d.onclick = (e) => { const b = e.target.closest("#pergBotoes button"); if (b) fim(botoes[Number(b.dataset.i)].v); else if (e.target === d) fim(null); };
    d.oncancel = () => fim(null);
  });
}

// ---------- tabela de fundos (lista, colar CNPJs e janela de seleção)
const COLS_FUNDO = [
  { k: "NOME", nome: "Fundo", tipo: "txt", filtro: "txt" },
  { k: "CNPJ", nome: "CNPJ", tipo: "cnpj", filtro: "txt" },
  { k: "CLASSIFICACAO_CVM", nome: "Classificação CVM", tipo: "txt", filtro: "lista" },
  { k: "CLASSIFICACAO_ANBIMA", nome: "Classificação ANBIMA", tipo: "txt", filtro: "lista" },
  { k: "GESTOR", nome: "Gestor", tipo: "txt", filtro: "txt" },
  { k: "_ini", nome: "1ª cota", tipo: "data" },
  { k: "_dia", nome: "Última cota", tipo: "data" },
  { k: "RET_12M", nome: "12 meses", tipo: "pct", filtro: "min" },
  { k: "ACUMULADO", nome: "Desde a 1ª cota", tipo: "pct", filtro: "min" },
  { k: "VL_PATRIM_LIQ", nome: "PL (R$ mi)", tipo: "mi", filtro: "min" },
];
const valFundo = (f, k) => { if (k === "_ini") return (f._ini ??= f.DATA_PRIMEIRA_COTA ? diaDe(f.DATA_PRIMEIRA_COTA) : null); return f[k]; };
function celFundo(f, c) {
  const v = valFundo(f, c.k);
  if (c.tipo === "cnpj") return `<td>${cnpjFmt(v)}</td>`;
  if (c.tipo === "data") return `<td>${v ? fmtData(v) : ""}</td>`;
  if (c.tipo === "pct") return `<td style="${corSinal(v)}">${brPct(v)}</td>`;
  if (c.tipo === "mi") return `<td>${v != null ? br(v / 1e6, 1) : ""}</td>`;
  return `<td class="t" title="${esc(v || "")}">${c.k === "NOME" ? esc(v || "") : esc(v || "")}</td>`;
}
// cabeçalho clicável (ordenar: 1º clique maior primeiro / A→Z, 2º inverte, 3º volta ao padrão por PL)
function cabFundos(tab, comFiltros, extraIni = "", extraFim = "") {
  const o = st.ord[tab];
  let h = `<thead><tr>${extraIni ? "<th></th>" : ""}${COLS_FUNDO.map((c) => {
    const at = o && o.col === c.k;
    return `<th class="${c.tipo === "txt" ? "t" : ""}"${at ? ` aria-sort="${o.dir > 0 ? "ascending" : "descending"}"` : ""}><button class="ord-f" data-tab="${tab}" data-col="${c.k}"
      data-txt="${c.tipo === "txt" || c.tipo === "cnpj" ? 1 : 0}" title="Ordenar">${esc(c.nome)}${at ? (o.dir > 0 ? " ▲" : " ▼") : ""}</button></th>`; }).join("")}${extraFim ? "<th></th>" : ""}</tr>`;
  if (comFiltros) {
    const f = dlg.f;
    h += `<tr class="filtros">${COLS_FUNDO.map((c) => {
      if (c.filtro === "txt") return `<th><input data-filtro="${c.k}" type="search" placeholder="filtrar…" value="${esc(f[c.k] || "")}"></th>`;
      if (c.filtro === "lista") return `<th><select data-filtro="${c.k}"><option value="">Todas</option>${(dlg.opcoes[c.k] || []).map((x) =>
        `<option${f[c.k] === x ? " selected" : ""}>${esc(x)}</option>`).join("")}</select></th>`;
      if (c.filtro === "min") return `<th><input data-filtro="${c.k}" type="number" step="any" placeholder="mín. ${c.tipo === "mi" ? "R$ mi" : "%"}" value="${esc(f[c.k] ?? "")}"></th>`;
      return "<th></th>";
    }).join("")}</tr>`;
  }
  return h + "</thead>";
}
function ordenarFundos(lista, tab) {
  const o = st.ord[tab]; if (!o) return lista;
  return [...lista].sort((a, b) => {
    const x = valFundo(a, o.col), y = valFundo(b, o.col);
    if (x == null || x === "") return 1; if (y == null || y === "") return -1;
    return (typeof x === "number" ? x - y : String(x).localeCompare(String(y), "pt-BR")) * o.dir;
  });
}

// ---------- janela "Lista de fundos": filtros por coluna, ordenação e clique na linha para selecionar
const dlg = { sel: [], f: {}, opcoes: {} };
const LIMITE_LISTA = 300;
// inicial / aoAplicar: usados quando a lista serve a outra coisa (ex.: os fundos de um ranking); sem eles, mexe na seleção principal
function abrirSeletor(inicial = null, aoAplicar = null, titulo = "Lista de fundos") {
  dlg.sel = [...(inicial || st.sel)]; dlg.aoAplicar = aoAplicar;
  $("#selTit").textContent = titulo;
  if (!dlg.opcoes.CLASSIFICACAO_CVM) for (const k of ["CLASSIFICACAO_CVM", "CLASSIFICACAO_ANBIMA"])
    dlg.opcoes[k] = [...new Set(st.lista.map((f) => f[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  $("#dlgSoSel").checked = false;
  renderSeletor(); renderSelDialogo();
  $("#seletor").showModal(); $("#dlgBusca").focus();
}
function filtrarLista() {
  const f = dlg.f, q = $("#dlgBusca").value.trim().toUpperCase(), dig = q.replace(/\D/g, "");
  const limiteDia = st.idx.cdi.d[st.idx.cdi.d.length - 1] - 30, ativos = $("#dlgAtivos").checked;
  const soSel = $("#dlgSoSel").checked, marcados = new Set(dlg.sel);
  const txt = COLS_FUNDO.filter((c) => c.filtro === "txt" && f[c.k]).map((c) => [c.k, f[c.k].toUpperCase(), f[c.k].replace(/\D/g, "")]);
  const lst = COLS_FUNDO.filter((c) => c.filtro === "lista" && f[c.k]).map((c) => [c.k, f[c.k]]);
  const mins = COLS_FUNDO.filter((c) => c.filtro === "min" && f[c.k] !== "" && f[c.k] != null && !Number.isNaN(Number(f[c.k])))
    .map((c) => [c.k, c.tipo === "mi" ? Number(f[c.k]) * 1e6 : Number(f[c.k]) / 100]);
  return st.lista.filter((x) => {
    if (soSel) return marcados.has(x.CNPJ);
    if (ativos && !(x._dia && x._dia >= limiteDia)) return false;
    if (q.length >= 3 && !(x._busca.includes(q) || (dig.length >= 3 && x.CNPJ.includes(dig)))) return false;
    for (const [k, t, d] of txt) { const v = k === "CNPJ" ? x.CNPJ : String(x[k] || "").toUpperCase(); if (!(v.includes(t) || (k === "CNPJ" && d && v.includes(d)))) return false; }
    for (const [k, v] of lst) if (x[k] !== v) return false;
    for (const [k, m] of mins) if (!(typeof x[k] === "number" && x[k] >= m)) return false;
    return true;
  });
}
function renderSeletor() {
  const todos = ordenarFundos(filtrarLista(), "sel"), linhas = todos.slice(0, LIMITE_LISTA), marcados = new Set(dlg.sel);
  dlg.visiveis = linhas.map((f) => f.CNPJ);
  $("#dlgInfo").innerHTML = `<b>${br(todos.length, 0)}</b> fundo(s)` + (todos.length > LIMITE_LISTA ? ` · mostrando os ${LIMITE_LISTA} primeiros (use os filtros ou a ordenação)` : "") +
    ` · clique no título da coluna para ordenar`;
  // preserva o foco num campo de filtro enquanto se digita
  const foco = document.activeElement?.dataset?.filtro, pos = document.activeElement?.selectionStart;
  $("#dlgTabela").innerHTML = `<table class="tb tab-fundos">${cabFundos("sel", true)}<tbody>${linhas.map((f) =>
    `<tr class="linha-f${marcados.has(f.CNPJ) ? " marcado" : ""}" data-c="${f.CNPJ}" tabindex="0" title="${marcados.has(f.CNPJ) ? "Selecionado · clique para tirar" : "Clique para selecionar"}">` +
    COLS_FUNDO.map((c) => celFundo(f, c)).join("") + "</tr>").join("")}</tbody></table>` + (linhas.length ? "" : `<p class="nota" style="padding:12px">Nenhum fundo com esses filtros.</p>`);
  if (foco) { const el = $(`#dlgTabela [data-filtro="${foco}"]`); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { /* number */ } } }
  $("#dlgMarcarVis").textContent = `Selecionar todos os mostrados (${linhas.length})`;
}
function renderSelDialogo() {
  const lista = ordenarFundos(dlg.sel.map((c) => st.porCnpj.get(c)).filter(Boolean), "selB");
  $("#dlgSel").innerHTML = lista.length ? `<table class="tb tab-fundos">${cabFundos("selB", false, "", "x")}<tbody>${lista.map((f) =>
    `<tr>${COLS_FUNDO.map((c) => celFundo(f, c)).join("")}<td><button class="cart-rm" data-dlgrm="${f.CNPJ}" type="button" title="Tirar da seleção">×</button></td></tr>`).join("")}</tbody></table>`
    : `<p class="nota" style="padding:10px">Nenhum fundo selecionado. Clique nas linhas da tabela de cima.</p>`;
  $("#dlgN").textContent = dlg.sel.length;
  $("#dlgAplicar").textContent = `Aplicar seleção (${dlg.sel.length} fundo${dlg.sel.length === 1 ? "" : "s"})`;
}
function alternarDlg(c) {
  dlg.sel = dlg.sel.includes(c) ? dlg.sel.filter((x) => x !== c) : [...dlg.sel, c];
  const tr = $(`#dlgTabela tr[data-c="${c}"]`);
  if (tr) { tr.classList.toggle("marcado", dlg.sel.includes(c)); tr.title = dlg.sel.includes(c) ? "Selecionado · clique para tirar" : "Clique para selecionar"; }
  if ($("#dlgSoSel").checked && !dlg.sel.includes(c)) renderSeletor();
  renderSelDialogo();
}

// ---------- janela "Colar CNPJs": confere os fundos antes de importar
const col = { lista: [], faltam: [] };
// base / aoConfirmar: para importar em outro lugar (ex.: os fundos de um ranking) em vez da seleção principal
function abrirColar(base = null, aoConfirmar = null) {
  col.base = base; col.aoConfirmar = aoConfirmar;
  $("#colPasso1").hidden = false; $("#colPasso2").hidden = true; $("#colTexto").value = ""; $("#dlgColar").showModal(); $("#colTexto").focus();
}
function lerCnpjs(txt) {
  const out = [];
  for (const m of txt.matchAll(/\d[\d.\/\-]{6,20}\d/g)) { const d = m[0].replace(/\D/g, ""); if (d.length >= 8 && d.length <= 14) out.push(d.padStart(14, "0")); }
  return [...new Set(out)];
}
function buscarColagem() {
  const cnpjs = lerCnpjs($("#colTexto").value);
  if (!cnpjs.length) { $("#colTexto").focus(); return; }
  col.lista = cnpjs.filter((c) => st.porCnpj.has(c)); col.faltam = cnpjs.filter((c) => !st.porCnpj.has(c));
  $("#colPasso1").hidden = true; $("#colPasso2").hidden = false; $("#colBusca").value = ""; $("#colRes").innerHTML = "";
  renderColagem();
}
function renderColagem() {
  const lista = ordenarFundos(col.lista.map((c) => st.porCnpj.get(c)), "col"), jaSel = new Set(col.base || st.sel);
  $("#colInfo").innerHTML = `<b>${col.lista.length}</b> fundo(s) encontrado(s)` + (col.lista.some((c) => jaSel.has(c)) ? ` · ${col.lista.filter((c) => jaSel.has(c)).length} já estão ${col.aoConfirmar ? "no ranking" : "selecionados"}` : "") +
    (col.faltam.length ? `<br><span class="neg">Não encontrados na base (${col.faltam.length}): ${col.faltam.map(cnpjFmt).join(", ")}</span>` : "");
  $("#colTabela").innerHTML = lista.length ? `<table class="tb tab-fundos">${cabFundos("col", false, "", "x")}<tbody>${lista.map((f) =>
    `<tr${jaSel.has(f.CNPJ) ? ' class="marcado" title="Já está selecionado"' : ""}>${COLS_FUNDO.map((c) => celFundo(f, c)).join("")}
      <td><button class="cart-rm" data-colrm="${f.CNPJ}" type="button" title="Tirar desta importação">×</button></td></tr>`).join("")}</tbody></table>`
    : `<p class="nota" style="padding:10px">Nenhum fundo para importar.</p>`;
  $("#colAcrescentar").disabled = $("#colSubstituir").disabled = !col.lista.length;
  const doRk = !!col.aoConfirmar;
  $("#colAcrescentar").textContent = `＋ Acrescentar ${doRk ? "ao ranking" : "aos selecionados"} (${col.lista.length})`;
  $("#colSubstituir").textContent = `${doRk ? "Substituir os fundos do ranking" : "Substituir a seleção"} (${col.lista.length})`;
}

// ---------- grupos salvos (neste navegador)
const lerGrupos = () => pref("grupos", {});
const gravarGrupos = (g) => salvar("grupos", g);
function abrirGrupos() { renderGrupos(); $("#dlgGrupos").showModal(); }
function renderGrupos() {
  const g = lerGrupos(), nomes = Object.keys(g).sort((a, b) => a.localeCompare(b, "pt-BR"));
  $("#grN").textContent = st.sel.length;
  $("#grSalvar").disabled = !st.sel.length;
  $("#grNomes").innerHTML = nomes.map((n) => `<option value="${esc(n)}">`).join("");
  $("#grLista").innerHTML = !nomes.length ? `<p class="nota">Nenhum grupo salvo ainda. Selecione fundos e salve acima.</p>` :
    `<table class="tb gr-tab"><thead><tr><th class="t">Grupo</th><th>Fundos</th><th>Atualizado em</th><th class="t">Carregar</th><th></th></tr></thead><tbody>${nomes.map((n) => {
      const x = g[n], aberto = renderGrupos.aberto === n;
      return `<tr><td class="t"><button class="link gr-ver" data-gr="${esc(n)}" title="Ver os fundos">${aberto ? "▾" : "▸"} <b>${esc(n)}</b></button></td><td>${x.cnpjs.length}</td>
        <td>${x.atualizado ? new Date(x.atualizado).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}</td>
        <td class="t gr-acoes"><button class="sec mini-btn" data-gr-add="${esc(n)}" type="button" title="Junta estes fundos aos já selecionados">＋ Acrescentar</button>
          <button class="prim mini-btn" data-gr-sub="${esc(n)}" type="button" title="Tira os selecionados e coloca só os do grupo">Substituir</button></td>
        <td><button class="cart-rm" data-gr-del="${esc(n)}" type="button" title="Excluir grupo">🗑</button></td></tr>` +
        (aberto ? `<tr class="gr-det"><td colspan="5"><div class="chips">${x.cnpjs.map((c) => `<span class="chip" title="${cnpjFmt(c)}">${esc(curto(st.porCnpj.get(c)?.NOME || cnpjFmt(c) + " (fora da base)", 40))}</span>`).join("")}</div></td></tr>` : "");
    }).join("")}</tbody></table>`;
}
async function salvarGrupo() {
  const nome = $("#grNome").value.trim();
  if (!nome) { $("#grNome").focus(); return; }
  if (!st.sel.length) return;
  const g = lerGrupos();
  if (g[nome]) {
    const r = await perguntar("Substituir o grupo?", `Já existe o grupo <b>${esc(nome)}</b> com ${g[nome].cnpjs.length} fundo(s). Substituir pelos ${st.sel.length} fundos selecionados agora?`,
      [{ rot: "Cancelar", v: false }, { rot: "Substituir", v: true, classe: "prim" }]);
    if (!r) return;
  }
  g[nome] = { cnpjs: [...st.sel], atualizado: new Date().toISOString() };
  gravarGrupos(g); $("#grNome").value = ""; renderGrupos();
  avisoSel(`<span class="ok">Grupo "${esc(nome)}" salvo com ${st.sel.length} fundo(s).</span>`);
}
function carregarGrupo(nome, substituir) {
  const x = lerGrupos()[nome]; if (!x) return;
  if (substituir) st.sel = [];
  const { ok, faltam } = adicionar(x.cnpjs);
  $("#dlgGrupos").close();
  avisoSel(`<span class="ok">Grupo "${esc(nome)}": ${ok} fundo(s) ${substituir ? "carregado(s)" : "acrescentado(s)"}.</span>` +
    (faltam.length ? `<br><span class="neg">${faltam.length} fora da base atual: ${faltam.map(cnpjFmt).join(", ")}</span>` : ""));
}
function exportarGrupos() {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ tipo: "grupos-de-fundos", versao: 1, grupos: lerGrupos() }, null, 1)], { type: "application/json" }));
  a.download = `grupos_de_fundos_${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function importarGrupos(arquivo) {
  let dados;
  try { dados = JSON.parse(await arquivo.text()); } catch { await perguntar("Arquivo inválido", "Não foi possível ler este arquivo de grupos.", [{ rot: "OK", v: 1, classe: "prim" }]); return; }
  const novos = dados?.grupos || {}, g = lerGrupos();
  const validos = Object.entries(novos).filter(([n, x]) => n && Array.isArray(x?.cnpjs));
  const repetidos = validos.filter(([n]) => g[n]).map(([n]) => n);
  let sobrescrever = true;
  if (repetidos.length) {
    const r = await perguntar("Grupos com o mesmo nome", `Já existem ${repetidos.length} grupo(s) com o mesmo nome: <b>${repetidos.map(esc).join(", ")}</b>.`,
      [{ rot: "Cancelar", v: null }, { rot: "Manter os meus", v: false }, { rot: "Substituir pelos do arquivo", v: true, classe: "prim" }]);
    if (r == null) return; sobrescrever = r;
  }
  let n = 0;
  for (const [nome, x] of validos) if (!g[nome] || sobrescrever) { g[nome] = { cnpjs: x.cnpjs.map((c) => String(c).replace(/\D/g, "").padStart(14, "0")), atualizado: x.atualizado || new Date().toISOString() }; n++; }
  gravarGrupos(g); renderGrupos();
  avisoSel(`<span class="ok">${n} grupo(s) importado(s).</span>`);
}

// ---------- eventos da seleção
document.addEventListener("click", async (e) => {
  const t = e.target;
  if (t.id === "abrirSeletor") return abrirSeletor();
  if (t.id === "abrirColar") return abrirColar();
  if (t.id === "abrirGrupos") return abrirGrupos();
  if (t.closest?.("[data-fechar-dlg]")) return t.closest("dialog").close();
  const bo = t.closest?.("button.ord-f");
  if (bo) { clicarOrdem(bo.dataset.tab, bo.dataset.col, bo.dataset.txt === "1"); ({ sel: renderSeletor, selB: renderSelDialogo, col: renderColagem, relDest: renderDestRel, rkEd: renderEditorRk })[bo.dataset.tab]?.(); return; }
  // janela da lista
  const lf = t.closest?.("#dlgTabela tr.linha-f");
  if (lf && !t.closest("input, select, button")) return alternarDlg(lf.dataset.c);
  if (t.dataset?.dlgrm) { dlg.sel = dlg.sel.filter((c) => c !== t.dataset.dlgrm); renderSeletor(); renderSelDialogo(); return; }
  if (t.id === "dlgMarcarVis") { dlg.sel = [...new Set([...dlg.sel, ...(dlg.visiveis || [])])]; renderSeletor(); renderSelDialogo(); return; }
  if (t.id === "dlgLimparSel") { if (dlg.sel.length && !(await perguntar("Limpar a seleção?", `Tirar os ${dlg.sel.length} fundos marcados?`, [{ rot: "Cancelar", v: false }, { rot: "Limpar", v: true, classe: "prim" }]))) return;
    dlg.sel = []; renderSeletor(); renderSelDialogo(); return; }
  if (t.id === "dlgLimparFiltros") { dlg.f = {}; $("#dlgBusca").value = ""; $("#dlgSoSel").checked = false; delete st.ord.sel; renderSeletor(); return; }
  if (t.id === "dlgAplicar") {
    const lista = dlg.sel.filter((c) => st.porCnpj.has(c));
    $("#seletor").close();
    if (dlg.aoAplicar) { const f = dlg.aoAplicar; dlg.aoAplicar = null; return f(lista); }
    st.sel = lista; atualizarSidebar(); avisoSel(`<span class="ok">${st.sel.length} fundo(s) selecionado(s).</span>`); return;
  }
  if (t.id === "dlgCancelar") return $("#seletor").close();
  // janela de colar
  if (t.id === "colBuscar") return buscarColagem();
  if (t.id === "colVoltar") { $("#colPasso1").hidden = false; $("#colPasso2").hidden = true; return; }
  if (t.dataset?.colrm) { col.lista = col.lista.filter((c) => c !== t.dataset.colrm); return renderColagem(); }
  const ca = t.closest?.("#colRes button.add");
  if (ca) { if (!col.lista.includes(ca.dataset.c)) col.lista.push(ca.dataset.c); $("#colBusca").value = ""; $("#colRes").innerHTML = ""; return renderColagem(); }
  if (t.id === "colAcrescentar" || t.id === "colSubstituir") {
    if (col.aoConfirmar) { const f = col.aoConfirmar; col.aoConfirmar = null; $("#dlgColar").close(); return f([...col.lista], t.id === "colSubstituir"); }
    if (t.id === "colSubstituir") st.sel = [];
    const { ok } = adicionar(col.lista); $("#dlgColar").close();
    avisoSel(`<span class="ok">${ok} fundo(s) ${t.id === "colSubstituir" ? "importado(s), substituindo a seleção anterior" : "acrescentado(s)"}.</span>`); return;
  }
  // grupos
  if (t.id === "grSalvar") return salvarGrupo();
  if (t.id === "grExportar") return exportarGrupos();
  const gv = t.closest?.("[data-gr]");
  if (gv) { renderGrupos.aberto = renderGrupos.aberto === gv.dataset.gr ? null : gv.dataset.gr; return renderGrupos(); }
  if (t.dataset?.grAdd) return carregarGrupo(t.dataset.grAdd, false);
  if (t.dataset?.grSub) {
    const n = t.dataset.grSub;
    if (st.sel.length && !(await perguntar("Substituir a seleção?", `Os ${st.sel.length} fundos selecionados agora saem e entram os ${lerGrupos()[n]?.cnpjs.length || 0} do grupo <b>${esc(n)}</b>.`,
      [{ rot: "Cancelar", v: false }, { rot: "Substituir", v: true, classe: "prim" }]))) return;
    return carregarGrupo(n, true);
  }
  if (t.dataset?.grDel) {
    const n = t.dataset.grDel;
    if (!(await perguntar("Excluir o grupo?", `Excluir o grupo <b>${esc(n)}</b>? Os fundos selecionados agora não mudam.`, [{ rot: "Cancelar", v: false }, { rot: "Excluir", v: true, classe: "prim" }]))) return;
    const g = lerGrupos(); delete g[n]; gravarGrupos(g); return renderGrupos();
  }
});
document.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("#dlgTabela tr.linha-f")) { e.preventDefault(); alternarDlg(e.target.dataset.c); }
  if (e.key === "Enter" && e.target.id === "grNome") { e.preventDefault(); salvarGrupo(); }
});
let tFiltro;
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "dlgBusca" || (t.dataset?.filtro && t.closest("#dlgTabela") && t.tagName === "INPUT")) {
    if (t.dataset?.filtro) dlg.f[t.dataset.filtro] = t.value;
    clearTimeout(tFiltro); tFiltro = setTimeout(renderSeletor, 220);
  }
  if (t.id === "colBusca") {
    const r = buscar(t.value, 8, (f) => !col.lista.includes(f.CNPJ));
    $("#colRes").innerHTML = t.value.trim().length < 3 ? "" : r.length ? r.map((f) => `<button class="add" data-c="${f.CNPJ}" title="${esc(f.NOME)}">＋ ${esc(curto(f.NOME, 60))}<small>${cnpjFmt(f.CNPJ)}</small></button>`).join("")
      : `<p class="nota">Nada encontrado.</p>`;
  }
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.dataset?.filtro && t.tagName === "SELECT") { dlg.f[t.dataset.filtro] = t.value; renderSeletor(); }
  else if (t.id === "dlgAtivos" || t.id === "dlgSoSel") renderSeletor();
  else if (t.id === "grImportar" && t.files[0]) { importarGrupos(t.files[0]); t.value = ""; }
});

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
    abrirCarga(sel);
    const fundos = await D.carregarFundos(sel, st.idx.cdiAnterior, (feitos, total, ev) => {
      barra.firstElementChild.style.width = `${5 + 75 * feitos / total}%`;
      $("#progTxt").textContent = `baixando cotas · ${feitos}/${total} fundo(s)`;
      atualizarCarga(feitos, total, ev);
    });
    $("#progTxt").textContent = "calculando…";
    faseCarga("calculando as métricas…", 92);
    await new Promise((r) => setTimeout(r, 30));
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
    st.res = res; st.params = paramsAtuais(); st.zoom = {}; st.zoomG = {};
    if (!res.periodos[st.perAtivo]) st.perAtivo = Object.keys(res.periodos)[0];
    // janela móvel: padrão de 5 anos de aplicações até a última cota
    if (fimComum != null) {
      if (!$("#jmFim").value || st.jmFimAuto !== false) $("#jmFim").value = isoDe(fimComum);
      if (!$("#jmIni").value || st.jmIniAuto !== false) $("#jmIni").value = isoDe(somarMeses(fimComum, -60));
      calcularJM();
    }
    const url = new URL(location.href); url.searchParams.set("fundos", sel.join(",")); history.replaceState(null, "", url);
    barra.firstElementChild.style.width = "100%";
    faseCarga("montando tabelas e gráficos…", 96);
    await new Promise((r) => setTimeout(r, 30));
    renderResultado();
    $("#progTxt").textContent = `pronto em ${br((performance.now() - t0) / 1000, 1)} s`;
    fecharCarga();
    atualizarEspaco();
  } catch (e) {
    $("#progTxt").textContent = "erro: " + e.message;
    fecharCarga(e.message);
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
// destaque: o texto digitado no topo ou, durante a geração de um relatório, a lista de fundos escolhida na janela de download
const casa = (termo, ...textos) => {
  if (st.destExtra && textos.some((x) => st.destExtra.has(String(x ?? "")))) return true;
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
      Mostrar todos (${ord.length})</label>` + tabelaHTML({ colunas, linhas: vis, fixas: 2, larguras: [34, 210], destacar: dest, separadores: seps, altura: 420 });
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
    ant.$base = { x: [xMin, xMax], y: [undefined, undefined] };
    aplicarZoomG(ant, id);
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
  posCriar(id, { x: [xMin, xMax], y: [undefined, undefined] });
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
    ant.$base = { x: [undefined, undefined], y: [0, undefined] };
    aplicarZoomG(ant, id);
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
  posCriar(id, { x: [undefined, undefined], y: [0, undefined] });
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
  $("#tabRisco").innerHTML = tabelaHTML({ colunas, linhas, fixas: 1, larguras: [210], destacar: dest, altura: 420, ordenavel: "risco" });
}

// ---------- correlação dos retornos diários (fundos + índices de preço escolhidos)
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
  const { itens, m } = dados._corr;
  $("#corrNota").textContent = `Retornos diários de ${fmtData(dIni)} a ${fmtData(dFim)}, nos dias em que os dois têm dado. 1 = andam juntos; 0 = sem relação; −1 = sentidos opostos. ` +
    `Role dentro do quadro para ver os outros fundos; os nomes ficam fixos à esquerda e embaixo. Destaque um fundo (no topo) para ir direto a ele.`;
  renderMatrizCorr("tabCorr", "corr", itens, m);
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
  $("#tabJM").innerHTML = htmlResumoJM(jm.porFundo.map(({ c, resumo }) => ({ _c: c, Fundo: st.porCnpj.get(c)?.NOME || c, CNPJ: cnpjFmt(c), resumo })), jm.nomeB, "jm");
}
// tabela-resumo da janela móvel. lista: [{ Fundo, CNPJ, _c?, resumo }]
function htmlResumoJM(lista, nomeB, tab) {
  const B = curto(nomeB || "Benchmark", 24);
  const linhas = lista.map(({ resumo: r, ...x }) => ({ ...x, prim: r.primeira, ult: r.ultima,
    ...Object.fromEntries(["min", "med", "max"].flatMap((f) => Object.entries(r[f]).map(([k, v]) => [`${f}.${k}`, v]))),
    total: r.total, abaixo: r.abaixo, acima: r.acima, negativas: r.negativas, positivas: r.positivas, pAcima: r.pAcima, pPositivas: r.pPositivas }));
  const faixa = (f, rot, comData) => [
    ...(comData ? [{ chave: `${f}.data`, nome: "Data de início", tipo: "data", g: rot }] : []),
    { chave: `${f}.ret`, nome: "Rentabilidade", tipo: "pct", cor: true, g: rot }, { chave: `${f}.retAA`, nome: "Fundo a.a.", tipo: "pct", cor: true, g: rot },
    { chave: `${f}.benchAA`, nome: `${B} a.a.`, tipo: "pct", cor: true, g: rot }, { chave: `${f}.dif`, nome: "Diferença", tipo: "pct", cor: true, g: rot }];
  const colunas = [
    { chave: "Fundo", nome: "Fundo", tipo: "txt", g: "Fundo", html: (v, l) => (l._c ? `<span data-mini="${esc(l._c)}">${esc(v)}</span>` : `<b>${esc(v)}</b>`) },
    { chave: "CNPJ", nome: "CNPJ", tipo: "txt", g: "Fundo" },
    { chave: "prim", nome: "Primeira aplicação", tipo: "data", g: "Período analisado" }, { chave: "ult", nome: "Última aplicação", tipo: "data", g: "Período analisado" },
    ...faixa("min", "Mínimo", true), ...faixa("med", "Mediana", false), ...faixa("max", "Máximo", true),
    ...["total:Total", "abaixo:Abaixo do " + B, "acima:Acima do " + B, "negativas:Negativas", "positivas:Positivas"]
      .map((x) => { const [k, nm] = x.split(":"); return { chave: k, nome: nm, tipo: "int", g: "Janelas" }; }),
    { chave: "pAcima", nome: `% acima do ${B}`, tipo: "pct", g: "Consistência" }, { chave: "pPositivas", nome: "% positivas", tipo: "pct", g: "Consistência" }];
  const ord = ordenar(linhas, tab, colunas);
  return tabelaHTML({ colunas, linhas: ord, fixas: 2, grupos: colunas.map((c) => c.g), ordenavel: tab,
    destacar: ord.map((l) => casa(st.destaque, l.Fundo, l.CNPJ)), altura: 420 });
}

// lista completa de todas as janelas (CSV com ponto e vírgula e vírgula decimal: abre direto no Excel em português)
// lista: [{ nome, cnpj, linhas }]
function baixarCSVJM(lista, nomeB, meses, arquivo) {
  const B = nomeB || "Benchmark", pct = (v) => (v == null ? "" : br(v * 100, 4) + "%");
  const cab = ["Fundo", "CNPJ", "Data Inicial", "Data Final", "Dias úteis (ANBIMA)", "Dias com cota na CVM", "Rentabilidade no período",
    `${B} anualizado`, "Fundo anualizado", `Diferença para o ${B}`].map((x) => x.replace(/;/g, ","));
  const linhas = [cab.join(";")];
  for (const { nome, cnpj, linhas: ls } of lista) {
    const nm = String(nome).replace(/;/g, ",");
    for (const l of ls) linhas.push([nm, cnpj || "", fmtData(l.ini), fmtData(l.fim), l.du, l.linhas, pct(l.ret), pct(l.benchAA), pct(l.retAA), pct(l.dif)].join(";"));
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff" + linhas.join("\r\n")], { type: "text/csv;charset=utf-8" }));
  a.download = `${arquivo}_${meses}m.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function baixarJM() {
  const jm = st.res?.jm; if (!jm) return;
  baixarCSVJM(jm.porFundo.map(({ c, linhas }) => ({ nome: st.porCnpj.get(c)?.NOME || c, cnpj: cnpjFmt(c), linhas })), jm.nomeB, jm.p.meses, "janela_movel");
}

// ============================== painel de carregamento (lista de fundos com situação) ==============================
const carga = { itens: new Map(), timer: null };
function abrirCarga(cnpjs) {
  const lista = $("#cargaLista");
  lista.innerHTML = cnpjs.map((c) => `<div class="pc-item pend" data-c="${c}" title="Na fila"><span class="pc-st" aria-hidden="true"></span>` +
    `<span class="pc-nome">${esc(st.porCnpj.get(c)?.NOME || c)}</span><span class="pc-cnpj">${cnpjFmt(c)}</span></div>`).join("");
  carga.itens = new Map($$(".pc-item", lista).map((e) => [e.dataset.c, e]));
  $("#cargaTit").textContent = `Carregando ${cnpjs.length} fundo${cnpjs.length > 1 ? "s" : ""}`;
  $("#cargaFase").textContent = "baixando as cotas…";
  $("#painelCarga").classList.remove("erro");
  atualizarCarga(0, cnpjs.length, null);
  clearTimeout(carga.timer);
  carga.timer = setTimeout(() => { $("#painelCarga").hidden = false; }, 300);   // não aparece se vier tudo do cache em menos de 0,3 s
}
function atualizarCarga(feitos, total, ev) {
  if (ev) for (const c of ev.cnpjs) {
    const e = carga.itens.get(c); if (!e) continue;
    const tipo = ev.tipo === "inicio" ? "baix" : ev.ok.has(c) ? "ok" : "sem";
    e.className = "pc-item " + tipo;
    e.title = { baix: "Baixando…", ok: "Carregado", sem: "Sem cotas na base (fundo novo, sem envio à CVM ou CNPJ de outra classe)" }[tipo];
  }
  let baix = 0, sem = 0;
  for (const e of carga.itens.values()) { if (e.classList.contains("baix")) baix++; else if (e.classList.contains("sem")) sem++; }
  $("#cargaBarra").style.width = `${total ? 4 + 86 * feitos / total : 4}%`;
  $("#cargaResumo").innerHTML = `<b>${feitos}</b> de <b>${total}</b> carregados` + (baix ? ` · <span class="baix">${baix} baixando</span>` : "") +
    (total - feitos - baix > 0 ? ` · ${total - feitos - baix} na fila` : "") + (sem ? ` · <span class="sem">${sem} sem cotas</span>` : "");
}
function faseCarga(txt, pct) { $("#cargaFase").textContent = txt; if (pct != null) $("#cargaBarra").style.width = pct + "%"; }
function fecharCarga(erro) {
  clearTimeout(carga.timer);
  const p = $("#painelCarga");
  if (erro) {
    p.hidden = false; p.classList.add("erro");
    faseCarga("erro: " + erro);
    if (!$("#cargaFechar")) $(".pc-cab", p).insertAdjacentHTML("beforeend", `<button id="cargaFechar" class="sec mini-btn" type="button">Fechar</button>`);
    return;
  }
  faseCarga("pronto", 100);
  setTimeout(() => { p.hidden = true; }, 450);
}

// ============================== matriz de correlação ==============================
// 10 linhas visíveis e quantas colunas couberem; nomes fixos à esquerda e embaixo; role dentro do quadro.
// Só a parte visível é desenhada (funciona com centenas de fundos). "Mostrar tudo" mostra todas as linhas
// (ou, com muitas séries, a matriz inteira reduzida a uma imagem).
st.corrTudo = {};
const MX = { lin: 28, col: 56, rotulo: 240, pe: 150 };
function textoCabe(g, txt, max) {
  if (g.measureText(txt).width <= max) return txt;
  let a = 0, b = txt.length;
  while (a < b) { const m = (a + b + 1) >> 1; if (g.measureText(txt.slice(0, m) + "…").width <= max) a = m; else b = m - 1; }
  return txt.slice(0, a) + "…";
}
function corPar(v) {
  if (v == null) return ["rgba(127,127,127,.18)", corTexto()];
  const a = Math.min(0.85, Math.abs(v) * 0.85);
  return [v >= 0 ? `rgba(31,90,166,${a})` : `rgba(208,38,44,${a})`, Math.abs(v) > 0.55 ? "#ffffff" : corTexto()];
}
// itens: [{ nome, cor, bench, c, cnpj }]; m: Float64Array n×n; chave: "corr" (seção de cima) ou "cart" (carteira)
function renderMatrizCorr(contId, chave, itens, m) {
  const cont = $("#" + contId), n = itens.length;
  const btn = $(`[data-corr-tudo="${chave}"]`);
  if (n < 2) { cont.innerHTML = `<p class="nota">Selecione pelo menos 2 séries.</p>`; if (btn) btn.closest(".opcoes").hidden = true; return; }
  const tudo = !!st.corrTudo[chave];
  if (btn) { btn.closest(".opcoes").hidden = n <= 10; btn.textContent = tudo ? "Mostrar só 10 linhas" : "Mostrar tudo"; }
  const r = (i, j) => (i === j ? 1 : Number.isNaN(m[i * n + j]) ? null : m[i * n + j]);
  const marc = itens.map((it) => !it.bench && casa(st.destaque, it.nome, it.cnpj));
  const ext = extremosCorr(itens, r, marc);
  if (tudo && n * MX.lin > 1800) { matrizImagem(cont, itens, r, marc, ext); return; }
  const vis = tudo ? n : Math.min(n, 10), H = vis * MX.lin + MX.pe;
  cont.innerHTML = `<div class="mx-vp" style="height:${H}px"><div class="mx-esp" style="width:${MX.rotulo + n * MX.col}px;height:${n * MX.lin + MX.pe}px">
    <canvas class="mx-cv"></canvas></div></div>` + ext;
  const vp = $(".mx-vp", cont), cv = $(".mx-cv", cont), g = cv.getContext("2d");
  // fundo destacado: já abre rolado até ele
  const alvo = marc.indexOf(true);
  if (alvo >= 0) { vp.scrollTop = Math.max(0, (alvo - 4) * MX.lin); vp.scrollLeft = Math.max(0, (alvo - 3) * MX.col); }
  const desenhar = () => {
    const W = vp.clientWidth, Hh = vp.clientHeight, dpr = devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(Hh * dpr)) {
      cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr); cv.style.width = W + "px"; cv.style.height = Hh + "px";
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fundo = getComputedStyle(cont).getPropertyValue("--card").trim() || "#fff", txt = corTexto();
    const sx = vp.scrollLeft, sy = vp.scrollTop, areaH = Hh - MX.pe;
    g.fillStyle = fundo; g.fillRect(0, 0, W, Hh);
    const i0 = Math.floor(sy / MX.lin), i1 = Math.min(n - 1, Math.floor((sy + areaH) / MX.lin));
    const j0 = Math.floor(sx / MX.col), j1 = Math.min(n - 1, Math.floor((sx + W - MX.rotulo) / MX.col));
    // células
    g.save(); g.beginPath(); g.rect(MX.rotulo, 0, W - MX.rotulo, areaH); g.clip();
    g.font = "600 11px Manrope, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const x = MX.rotulo + j * MX.col - sx, y = i * MX.lin - sy, v = r(i, j);
      const [bg, fg] = i === j ? [OURO, "#141a4a"] : corPar(v);
      g.fillStyle = bg; g.fillRect(x + 1, y + 1, MX.col - 2, MX.lin - 2);
      g.fillStyle = fg; g.fillText(v == null ? "n/a" : i === j ? "1" : br(v, 2), x + MX.col / 2, y + MX.lin / 2 + 1);
    }
    g.strokeStyle = OURO; g.lineWidth = 2;
    for (let i = i0; i <= i1; i++) if (marc[i]) g.strokeRect(MX.rotulo - sx + 1, i * MX.lin - sy + 1, n * MX.col - 2, MX.lin - 2);
    for (let j = j0; j <= j1; j++) if (marc[j]) g.strokeRect(MX.rotulo + j * MX.col - sx + 1, -sy + 1, MX.col - 2, n * MX.lin - 2);
    g.restore();
    // nomes das linhas (fixos à esquerda)
    g.save(); g.beginPath(); g.rect(0, 0, MX.rotulo, areaH); g.clip();
    g.fillStyle = fundo; g.fillRect(0, 0, MX.rotulo, areaH);
    g.textAlign = "left"; g.textBaseline = "middle";
    for (let i = i0; i <= i1; i++) {
      const y = i * MX.lin - sy, it = itens[i];
      g.fillStyle = it.cor; if (it.bench) { g.save(); g.translate(13, y + MX.lin / 2); g.rotate(Math.PI / 4); g.fillRect(-4, -4, 8, 8); g.restore(); } else g.fillRect(8, y + MX.lin / 2 - 5, 10, 10);
      g.font = marc[i] ? "800 11.5px Manrope, sans-serif" : "600 11.5px Manrope, sans-serif"; g.fillStyle = marc[i] ? OURO : txt;
      g.fillText(textoCabe(g, `${i + 1}. ${it.nome}`, MX.rotulo - 32), 24, y + MX.lin / 2 + 1);
    }
    g.restore();
    // nomes das colunas (fixos embaixo, na vertical)
    g.save(); g.beginPath(); g.rect(MX.rotulo, areaH, W - MX.rotulo, MX.pe); g.clip();
    g.fillStyle = fundo; g.fillRect(MX.rotulo, areaH, W - MX.rotulo, MX.pe);
    g.textAlign = "right"; g.textBaseline = "middle";
    for (let j = j0; j <= j1; j++) {
      const x = MX.rotulo + j * MX.col - sx + MX.col / 2, it = itens[j];
      g.save(); g.translate(x, areaH + 8); g.rotate(-Math.PI / 2);
      g.font = marc[j] ? "800 11px Manrope, sans-serif" : "600 11px Manrope, sans-serif"; g.fillStyle = marc[j] ? OURO : txt;
      g.fillText(textoCabe(g, `${j + 1}. ${it.nome}`, MX.pe - 16), 0, 0);
      g.restore();
    }
    g.restore();
    // canto e divisórias
    g.fillStyle = fundo; g.fillRect(0, areaH, MX.rotulo, MX.pe);
    g.fillStyle = corTexto(); g.globalAlpha = .6; g.font = "500 11px Manrope, sans-serif"; g.textAlign = "left";
    g.fillText(n > vis || MX.rotulo + n * MX.col > W ? "Role dentro do quadro ↕ ↔" : "", 10, areaH + 20); g.globalAlpha = 1;
    g.strokeStyle = OURO; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(MX.rotulo - .5, 0); g.lineTo(MX.rotulo - .5, Hh); g.moveTo(0, areaH + .5); g.lineTo(W, areaH + .5); g.stroke();
  };
  let pedido = 0;
  vp.addEventListener("scroll", () => { if (!pedido) pedido = requestAnimationFrame(() => { pedido = 0; desenhar(); }); }, { passive: true });
  new ResizeObserver(() => desenhar()).observe(vp);
  desenhar();
  const tip = $("#corrTip");
  cv.onmousemove = (e) => {
    const b = cv.getBoundingClientRect(), px = e.clientX - b.left, py = e.clientY - b.top;
    if (px < MX.rotulo || py > vp.clientHeight - MX.pe) { tip.hidden = true; return; }
    const i = Math.floor((py + vp.scrollTop) / MX.lin), j = Math.floor((px - MX.rotulo + vp.scrollLeft) / MX.col);
    if (i < 0 || j < 0 || i >= n || j >= n) { tip.hidden = true; return; }
    const v = r(i, j);
    tip.innerHTML = `<div class="mini-tit">${i + 1}. ${esc(itens[i].nome)}</div><div class="mini-tit">× ${j + 1}. ${esc(itens[j].nome)}</div>
      <div class="mini-rod">Correlação: <b>${v == null ? "n/a (menos de 20 dias em comum)" : br(v, 2)}</b></div>`;
    tip.style.left = Math.min(e.clientX + 14, innerWidth - 290) + "px"; tip.style.top = (e.clientY + 14) + "px"; tip.hidden = false;
  };
  cv.onmouseleave = () => { tip.hidden = true; };
}

// fundo destacado: os mais correlacionados, os mais próximos de zero e os menos correlacionados com ele
function extremosCorr(itens, r, marc) {
  const alvo = marc.indexOf(true); if (alvo < 0) return "";
  const outros = itens.map((it, j) => ({ it, v: r(alvo, j) })).filter((x, j) => j !== alvo && x.v != null);
  if (!outros.length) return "";
  const lin = (x) => `<tr><td class="t"><span class="sw${x.it.bench ? " losango" : ""}" style="background:${x.it.cor}"></span>` +
    (x.it.c ? `<span data-mini="${esc(x.it.c)}">${esc(x.it.nome)}</span>` : esc(x.it.nome)) + `</td><td>${br(x.v, 2)}</td></tr>`;
  const ord = [...outros].sort((a, b) => b.v - a.v), zero = [...outros].sort((a, b) => Math.abs(a.v) - Math.abs(b.v));
  const bloco = (tit, lista) => `<div><h3 class="sub">${tit}</h3><table class="tb">${lista.map(lin).join("")}</table></div>`;
  return `<div class="corr-ext"><p class="nota">Correlação com <b>${esc(itens[alvo].nome)}</b>:</p>` +
    bloco("Mais correlacionados (andam juntos)", ord.slice(0, 5)) + bloco("Mais próximos de zero (sem relação)", zero.slice(0, 5)) +
    bloco("Menos correlacionados (sentidos opostos)", ord.slice(-5).reverse()) + `</div>`;
}

// matriz inteira reduzida a uma imagem (muitas séries no "Mostrar tudo"); o par aparece ao passar o mouse
function matrizImagem(cont, itens, r, marc, ext) {
  const n = itens.length;
  const lado = Math.max(2, Math.min(14, Math.floor(((cont.clientWidth || 1000) - 30) / n))), tam = lado * n, dpr = devicePixelRatio || 1;
  cont.innerHTML = `<div class="corr-cv"><canvas width="${Math.round(tam * dpr)}" height="${Math.round(tam * dpr)}" style="width:${tam}px;height:${tam}px"></canvas></div>
    <div class="corr-escala"><span>−1</span><i></i><span>+1</span><span class="nota">· matriz inteira (${n} séries) · passe o mouse para ver o par · dourado = o próprio fundo · cinza = menos de 20 dias em comum</span></div>` + ext;
  const cv = $("canvas", cont), g = cv.getContext("2d"), W = cv.width, px = W / n;
  const img = g.createImageData(W, W), buf = img.data;
  const pinta = (i, j, rr, gg, bb, aa) => {
    const y0 = Math.round(i * px), y1 = Math.round((i + 1) * px), x0 = Math.round(j * px), x1 = Math.round((j + 1) * px);
    for (let y = y0; y < y1; y++) for (let x = x0, o = (y * W + x0) * 4; x < x1; x++, o += 4) { buf[o] = rr; buf[o + 1] = gg; buf[o + 2] = bb; buf[o + 3] = aa; }
  };
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = r(i, j);
    if (i === j) pinta(i, j, 201, 162, 58, 255);
    else if (v == null) pinta(i, j, 127, 127, 127, 64);
    else if (v >= 0) pinta(i, j, 31, 90, 166, Math.round(255 * (0.08 + Math.min(0.92, v))));
    else pinta(i, j, 208, 38, 44, Math.round(255 * (0.08 + Math.min(0.92, -v))));
  }
  g.putImageData(img, 0, 0); g.scale(dpr, dpr);
  g.strokeStyle = OURO; g.lineWidth = 2;
  marc.forEach((mk, i) => { if (mk) { g.strokeRect(0, i * lado, tam, lado); g.strokeRect(i * lado, 0, lado, tam); } });
  const tip = $("#corrTip");
  cv.onmousemove = (e) => {
    const b = cv.getBoundingClientRect(), i = Math.floor((e.clientY - b.top) / lado), j = Math.floor((e.clientX - b.left) / lado);
    if (i < 0 || j < 0 || i >= n || j >= n) { tip.hidden = true; return; }
    const v = r(i, j);
    tip.innerHTML = `<div class="mini-tit">${i + 1}. ${esc(itens[i].nome)}</div><div class="mini-tit">× ${j + 1}. ${esc(itens[j].nome)}</div>
      <div class="mini-rod">Correlação: <b>${v == null ? "n/a" : br(v, 2)}</b></div>`;
    tip.style.left = Math.min(e.clientX + 14, innerWidth - 290) + "px"; tip.style.top = (e.clientY + 14) + "px"; tip.hidden = false;
  };
  cv.onmouseleave = () => { tip.hidden = true; };
}
document.addEventListener("click", (e) => {
  const b = e.target.closest?.("[data-corr-tudo]");
  if (b) { const k = b.dataset.corrTudo; st.corrTudo[k] = !st.corrTudo[k]; ({ cart: renderCartCorr, rk: renderRkCorr }[k] || renderCorrelacao)(); return; }
  if (e.target.id === "cargaFechar") { $("#painelCarga").hidden = true; e.target.remove(); }
});

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
    aoEscolher: (o) => { st.rel.alvo = o.rot; semZoom("gAcum"); renderAcum(); } });
  criarCombo("cbJmBench", { opcoes: () => [{ tipo: "n", v: "", rot: "Nenhum (retorno absoluto)", grupo: "Sem comparação" }, ...opcoesIndices(), ...opcoesFundos()],
    aoEscolher: (o) => { st.jmBench = { tipo: o.tipo, v: o.v, rot: o.rot }; semZoom("gJM"); calcularJM(); renderJM(); } });
  criarCombo("cbCartAdd", { limpar: true, placeholder: "Digite o nome, CNPJ ou índice…",
    opcoes: () => { const tem = new Set(st.cart.itens.map((x) => x.tipo + x.v)); return [...opcoesFundos(), ...opcoesIndices()].filter((o) => !tem.has(o.tipo + o.v)); },
    aoEscolher: (o) => { st.cart.itens.push({ tipo: o.tipo, v: o.v, peso: st.cart.itens.length ? 10 : 100 }); salvarCart(); renderCarteira(); } });
  criarCombo("cbCartRef", { opcoes: () => [...opcoesIndices(), ...opcoesFundos()],
    aoEscolher: (o) => { st.cart.ref = { tipo: o.tipo, v: o.v, rot: o.rot }; salvarCart(); calcularCarteira(); } });
  // carteira: alvo do "Relativa a" (índices e ativos da carteira) e benchmark da janela móvel
  criarCombo("cbCartAlvo", { opcoes: () => [...opcoesIndices(), ...(st.cartRes?.validos || []).filter((it) => it.tipo === "f")
      .map((it) => ({ tipo: "f", v: it.v, rot: nomeItem(it), cnpj: it.v, grupo: "Ativos da carteira", cor: corItem(it) }))],
    aoEscolher: (o) => { st.cartUI.rel.alvo = o.rot; semZoom("gCartEvol"); renderCartAcum(); } });
  criarCombo("cbCartJmBench", { opcoes: () => [{ tipo: "n", v: "", rot: "Nenhum (retorno absoluto)", grupo: "Sem comparação" }, ...opcoesIndices(), ...opcoesFundos()],
    aoEscolher: (o) => { st.cartUI.jmBench = { tipo: o.tipo, v: o.v, rot: o.rot }; semZoom("gCartJM"); calcularCartJM(); renderCartJM(); } });
  definirCombo("cbAlvo", st.rel.alvo); definirCombo("cbJmBench", st.jmBench.rot); definirCombo("cbCartRef", st.cart.ref.rot);
  definirCombo("cbCartAlvo", st.cartUI.rel.alvo); definirCombo("cbCartJmBench", st.cartUI.jmBench.rot);
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
const corCarteira = () => (escuro() ? "#ffffff" : "#141a4a");
// série diária -> "fundo" no formato do cálculo de métricas (CDI do dia anterior, como no VBA)
const pseudoFundo = (dias, valores) => prepararFundo(Array.from(dias, (d, t) => ({ d, q: valores[t] })), st.idx.cdiAnterior);

function renderCarteira() {
  $("#secCart").hidden = !st.res;
  if (!st.res) return;
  const c = st.cart;
  if (!c.ini || !c.fim) usarPeriodoAtivo(false);
  $("#cartRebal").value = String(c.rebal); $("#cartValor").value = c.valor; $("#cartIni").value = c.ini; $("#cartFim").value = c.fim;
  $("#cartJmMeses").value = st.cartUI.jmMeses;
  // janela móvel da carteira: datas próprias (padrão: 5 anos de aplicações até a última cota)
  if (!st.cartUI.jmFim) st.cartUI.jmFim = isoDe(st.res.fimComum);
  if (!st.cartUI.jmIni) st.cartUI.jmIni = isoDe(somarMeses(st.res.fimComum, -60));
  $("#cartJmIni").value = st.cartUI.jmIni; $("#cartJmFim").value = st.cartUI.jmFim;
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
  const cem = Math.abs(s - 100) < 0.1;                  // tolerância para arredondamentos (ex.: 7 × 14,29 = 100,03)
  $("#cartSoma").innerHTML = st.cart.itens.length ? `Soma dos pesos: <b style="color:${cem ? VERDE : VERMELHO}">${br(s, cem ? 0 : 1)}%</b>` +
    (cem ? "" : " (o cálculo usa os pesos proporcionais, como se somassem 100%)") : "";
}
function usarPeriodoAtivo(recalcular = true) {
  const c = st.cart, ctx = st.ctx;
  const fim = ctx ? ctx.dFim : st.res.fimComum, ini = ctx ? ctx.dIni : somarMeses(fim, -36);
  c.ini = isoDe(ini); c.fim = isoDe(fim); salvarCart();
  if (recalcular) renderCarteira();
}

// ---------- simulação e resumo (indicadores + contribuição de cada ativo)
function calcularCarteira() {
  const c = st.cart, res = $("#cartRes");
  const validos = c.itens.filter((it) => (Number(it.peso) || 0) > 0 && serieItem(it));
  $("#cartGraf").hidden = true; st.cartRes = null;
  semZoom("gCartEvol", "gCartDD", "gCartRR", "gCartJM");          // pesos, datas ou rebalanceamento mudaram: gráficos voltam ao inteiro
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
  st.cartRes = { validos, pesos, ativos, sim, d0, dN, simRef, eT, eA, eRef, simBH, eBH, cdiAnual, rebal,
    nomes: validos.map(nomeItem), cores: validos.map(corItem) };

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
  const maxC = Math.max(1e-9, ...sim.contrib.map(Math.abs));
  const celP = (v) => `<td style="${corSinal(v)}">${brPct(v)}</td>`;
  const nomeFx = (txt) => `<td class="fx t" style="left:0;min-width:240px;max-width:240px" title="${esc(txt.replace(/<[^>]+>/g, ""))}">${txt}</td>`;
  const linhasA = validos.map((it, k) => `<tr>${nomeFx(`<span class="sw${it.tipo === "i" ? " losango" : ""}" style="background:${corItem(it)}"></span>` +
      (it.tipo === "f" ? `<span data-mini="${esc(it.v)}">${esc(nomeItem(it))}</span>` : esc(nomeItem(it))))}
    <td>${br(pesos[k] * 100, 1)}%</td>${celP(eA[k].total)}${celP(eA[k].anual)}<td>${brPct(eA[k].vol)}</td><td style="${corSinal(eA[k].sharpe)}">${eA[k].sharpe == null ? "–" : br(eA[k].sharpe, 2)}</td>
    ${celP(eA[k].mdd)}<td class="contrib"><b style="${corSinal(sim.contrib[k])}">${brPct(sim.contrib[k])}</b>
    <span class="minibar"><i class="${sim.contrib[k] >= 0 ? "up" : "down"}" style="width:${(Math.abs(sim.contrib[k]) / maxC * 50).toFixed(1)}%"></i></span></td></tr>`).join("");
  const linhaE = (cls, rot, e, extra = "") => `<tr class="${cls}">${nomeFx(rot)}<td>${extra}</td>${celP(e.total)}${celP(e.anual)}<td>${brPct(e.vol)}</td>
    <td style="${corSinal(e.sharpe)}">${e.sharpe == null ? "–" : br(e.sharpe, 2)}</td>${celP(e.mdd)}<td></td></tr>`;
  const somaC = sim.contrib.reduce((a, b) => a + b, 0);
  h += `<div class="tb-wrap"><table class="tb cart-tab"><thead><tr><th class="fx t" style="left:0;min-width:240px;max-width:240px">Ativo</th><th>Peso</th><th>Retorno</th><th>Ao ano</th>
    <th>Volatilidade</th><th>Sharpe</th><th>Máx. queda</th><th>Contribuição para o retorno</th></tr></thead><tbody>${linhasA}
    <tr class="cart-total">${nomeFx(`Carteira${rebal ? ` (rebalanceamento ${REBAL[rebal]})` : " (comprar e manter)"}`)}<td>100%</td>${celP(eT.total)}${celP(eT.anual)}
      <td>${brPct(eT.vol)}</td><td style="${corSinal(eT.sharpe)}">${eT.sharpe == null ? "–" : br(eT.sharpe, 2)}</td>${celP(eT.mdd)}<td style="${corSinal(somaC)}"><b>${brPct(somaC)}</b></td></tr>` +
    (eRef ? linhaE("cart-ref", `Referência: ${esc(c.ref.rot)}`, eRef) +
      `<tr class="cart-ref ef">${nomeFx("Carteira contra a referência")}<td></td><td style="${corSinal(eT.total - eRef.total)}">${pp(eT.total - eRef.total)}</td>
       <td style="${corSinal(exc)}">${pp(exc)}</td><td colspan="4"></td></tr>` : "") +
    (eBH ? linhaE("cart-ref", "Mesma carteira sem rebalancear", eBH, "100%") +
      `<tr class="cart-ref ef">${nomeFx(`Efeito do rebalanceamento ${REBAL[rebal]}`)}<td></td><td style="${corSinal(eT.total - eBH.total)}">${pp(eT.total - eBH.total)}</td><td colspan="5"></td></tr>` : "") +
    `</tbody></table></div>`;
  const avisos = [];
  if (sim.cortadoIni) avisos.push(`começa em ${fmtData(d0)} porque algum ativo não tem dado antes disso`);
  if (sim.cortadoFim) avisos.push(`termina em ${fmtData(dN)}, último dia com dado de ${esc(sim.limitante)}`);
  if (simRef && simRef.dias[simRef.dias.length - 1] < dN) avisos.push(`a referência só tem dado até ${fmtData(simRef.dias[simRef.dias.length - 1])}`);
  h += `<p class="nota">Período: ${fmtData(d0)} a ${fmtData(dN)} (${sim.dias.length} dias úteis)${avisos.length ? "; " + avisos.join("; ") : ""}.
    Contribuição = quanto cada ativo gerou de resultado sobre o valor inicial, considerando o peso que ele tinha a cada dia; a soma é o retorno da carteira.
    Sharpe sobre o CDI do mesmo período. Não considera impostos, taxas de saída nem prazos de resgate.</p>`;
  res.innerHTML = h;
  $("#cartGraf").hidden = false;
  renderCartMetricas(); renderCartAcum(); renderCartDd(); renderCartRisco(); renderCartCorr();
  calcularCartJM(); renderCartJM();
}

// ---------- métricas completas (as mesmas da tabela de cima), para a carteira e cada ativo no período da carteira
const cacheAtivo = new Map();             // métricas dos ativos não mudam com os pesos: guardadas por ativo + período
function renderCartMetricas() {
  const R = st.cartRes; if (!R) return;
  const peso = Number($("#peso").value) / 100, opc = { ini: R.d0, fim: R.dN };
  const linhaDe = (nome, f, extra = {}) => { const r = f ? calcularFundo(f, st.idx.ibov, "Personalizado", peso, opc) : null; return r && Object.assign(r, { Fundo: nome }, extra); };
  const linhas = [linhaDe(`Carteira${R.rebal ? ` (rebalanceamento ${REBAL[R.rebal]})` : ""}`, pseudoFundo(R.sim.dias, R.sim.valor), { _cart: true })];
  if (R.simBH) linhas.push(linhaDe("Mesma carteira sem rebalancear", pseudoFundo(R.simBH.dias, R.simBH.valor), { _cart: true }));
  R.validos.forEach((it, k) => {
    const chave = `${it.tipo}${it.v}|${R.d0}|${R.dN}|${peso}|${R.cores[k]}`;
    if (!cacheAtivo.has(chave)) {
      const f = it.tipo === "f" ? st.res.fundos.get(it.v) : pseudoFundo(R.sim.dias, R.sim.porAtivo[k]);
      cacheAtivo.set(chave, linhaDe(R.nomes[k], f, { _c: it.tipo === "f" ? it.v : null, _cor: R.cores[k], _idx: it.tipo === "i" }));
    }
    linhas.push(cacheAtivo.get(chave));
  });
  if (cacheAtivo.size > 3000) cacheAtivo.clear();
  const fora = new Set(["CNPJ", "Classificação CVM", "Classificação ANBIMA", "Cota Inicial", "Cota Final", "Captação Líquida no Período", "Objetivo de retorno"]);
  const cols = COLUNAS.filter(([, n]) => !fora.has(n));
  const colunas = cols.map(([, n, t]) => {
    const c = { chave: n, nome: n, tipo: t, cor: t === "pct" };
    if (n === "Fundo") { c.nome = "Carteira / ativo"; c.html = (v, l) => (l._cart ? `<b>★ ${esc(v)}</b>` :
      `<span class="sw${l._idx ? " losango" : ""}" style="background:${l._cor}"></span>` + (l._c ? `<span data-mini="${esc(l._c)}">${esc(v)}</span>` : esc(v))); }
    return c;
  });
  const vis = linhas.filter(Boolean);
  const ord = [...vis.filter((l) => l._cart), ...ordenar(vis.filter((l) => !l._cart), "cartMet", colunas)];
  R.metricas = { colunas, linhas: ord };
  $("#cartMetricas").innerHTML = tabelaHTML({ colunas, linhas: ord, fixas: 1, larguras: [240], grupos: cols.map(([g]) => g), ordenavel: "cartMet",
    destacar: ord.map((l) => !l._cart && casa(st.destaque, l.Fundo)), classes: ord.map((l) => (l._cart ? "cart-total" : "")), altura: 420 });
}

// ---------- rentabilidade acumulada (com "Relativa a") e drawdown
function seriesCarteira(campo) {     // campo: "acum" (retorno acumulado) ou "dd" (queda desde o pico)
  const R = st.cartRes, x = R.sim.dias, conv = (v) => (campo === "acum" ? Array.from(v, (y) => y - 1) : curvaDrawdown(v));
  const s = R.validos.map((it, k) => ({ nome: R.nomes[k], c: it.tipo === "f" ? it.v : null, cor: R.cores[k], x, y: conv(R.sim.porAtivo[k]), fraca: true }));
  if (campo === "acum" && R.simRef) s.push({ nome: "Referência: " + st.cart.ref.rot, cor: corItem(st.cart.ref), x: R.simRef.dias, y: conv(R.simRef.valor), bench: true });
  s.push({ nome: "Carteira", cor: corCarteira(), x, y: conv(R.sim.valor), forte: true });
  return s;
}
function renderCartAcum() {
  const R = st.cartRes; if (!R) return;
  const u = st.cartUI.rel;
  $("#cartRelOn").checked = u.on; $("#cartRelCtl").hidden = !u.on;
  $$("#cartRelModo button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.m === u.modo));
  definirCombo("cbCartAlvo", u.alvo);
  let series = seriesCarteira("acum"), ref = null, fmtY = (v) => brPct(v, 1);
  if (u.on) {
    const k = st.idx.disponiveis.find((x) => nomeIndice(x) === u.alvo);
    let bench = null;
    if (k) { const s1 = simularCarteira([{ s: st.idx.niveis[k], nome: u.alvo }], [1], { ini: R.d0, fim: R.dN }); if (s1) bench = { x: s1.dias, y: Array.from(s1.valor, (v) => v - 1) }; }
    else bench = series.find((s) => s.nome === u.alvo);
    if (bench) {
      series = series.filter((s) => !s.bench && s.nome !== u.alvo).map((s) => relativa(s, bench, u.modo));
      ref = u.modo === "dif" ? 0 : 1; if (u.modo === "pct") fmtY = (v) => brPct(v, 0);
    }
    $("#cartRelNota").textContent = u.modo === "dif" ? `Rentabilidade acumulada menos a do ${u.alvo}.` : `Rentabilidade ÷ a do ${u.alvo}. Início omitido enquanto o alvo está perto de zero.`;
  } else $("#cartRelNota").textContent = "";
  grafico("gCartEvol", series, { fmtY, ref, xMin: R.d0, xMax: R.dN });
  $("#legCartEvol").innerHTML = tabelaLegenda("cartAcum", series.map((s) => ({ Fundo: s.nome, _c: s.c, cor: s.cor, Final: finalDe(s) })), ["Final"]);
}
function renderCartDd() {
  const R = st.cartRes; if (!R) return;
  const series = seriesCarteira("dd");
  grafico("gCartDD", series, { xMin: R.d0, xMax: R.dN });
  const mdd = (s) => Math.min(0, ...s.y);
  $("#legCartDD").innerHTML = tabelaLegenda("cartDd", series.map((s) => ({ Fundo: s.nome, _c: s.c, cor: s.cor, Final: finalDe(s), "Máx. queda": mdd(s) })), ["Final", "Máx. queda"]);
}

// ---------- risco × retorno (eixo retorno ou Sharpe) com a tabela ao lado
function renderCartRisco() {
  const R = st.cartRes; if (!R) return;
  const eixo = st.cartUI.eixo, chaveX = eixo === "ret" ? "anual" : "sharpe";
  $$("#cartRiscoEixo button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.e === eixo));
  const pts = R.validos.map((it, k) => ({ nome: R.nomes[k], c: it.tipo === "f" ? it.v : null, cor: R.cores[k], anual: R.eA[k].anual, vol: R.eA[k].vol, sharpe: R.eA[k].sharpe, tipo: it.tipo === "i" ? "bench" : "fundo" }));
  if (R.eRef) pts.push({ nome: "Referência: " + st.cart.ref.rot, cor: corItem(st.cart.ref), anual: R.eRef.anual, vol: R.eRef.vol, sharpe: R.eRef.sharpe, tipo: "bench" });
  pts.push({ nome: "Carteira", cor: OURO, anual: R.eT.anual, vol: R.eT.vol, sharpe: R.eT.sharpe, tipo: "carteira" });
  st.cartUI.pts = pts;
  const algum = pts.some((p) => p.tipo === "fundo" && casa(st.destaque, p.nome));
  graficoRR("gCartRR", pts.filter((p) => p[chaveX] != null).map((p) => {
    const m = p.tipo === "fundo" && algum && casa(st.destaque, p.nome);
    return { nome: p.nome, cor: p.cor, x: p[chaveX], y: p.vol, tipo: p.tipo, forte: m, apagado: algum && p.tipo === "fundo" && !m };
  }), { fmtX: chaveX === "anual" ? (v) => brPct(v, 1) : (v) => br(v, 2), tituloX: chaveX === "anual" ? "Retorno (% a.a.)" : "Sharpe (sobre o CDI)", refX: chaveX === "sharpe" ? 0 : null });
  renderTabCartRisco();
}
function renderTabCartRisco() {
  const pts = st.cartUI.pts; if (!pts) return;
  const chaveX = st.cartUI.eixo === "ret" ? "anual" : "sharpe";
  const colunas = [
    { chave: "nome", nome: "Ativo", tipo: "txt", html: (v, l) => (l.tipo === "carteira" ? `<b>★ ${esc(v)}</b>` :
      `<span class="sw${l.tipo === "bench" ? " losango" : ""}" style="background:${l.cor}"></span>` + (l.c ? `<span data-mini="${esc(l.c)}">${esc(v)}</span>` : `<i>${esc(v)}</i>`)) },
    { chave: "anual", nome: "Retorno a.a.", tipo: "pct", cor: true }, { chave: "vol", nome: "Volatilidade", tipo: "pct" }, { chave: "sharpe", nome: "Sharpe", tipo: "num2", cor: true }];
  const linhas = st.ord.cartRisco ? ordenar(pts, "cartRisco", colunas) : [...pts].sort((a, b) => (b[chaveX] ?? -Infinity) - (a[chaveX] ?? -Infinity));
  $("#tabCartRisco").innerHTML = tabelaHTML({ colunas, linhas, fixas: 1, larguras: [210], ordenavel: "cartRisco", altura: 420,
    destacar: linhas.map((p) => p.tipo === "fundo" && casa(st.destaque, p.nome)), classes: linhas.map((p) => (p.tipo === "carteira" ? "cart-total" : "")) });
}

// ---------- correlação entre os ativos e a carteira
function renderCartCorr() {
  const R = st.cartRes; if (!R) return;
  const rets = (v) => { const m = new Map(); for (let t = 1; t < v.length; t++) m.set(R.sim.dias[t], v[t] / v[t - 1] - 1); return m; };
  const itens = R.validos.map((it, k) => ({ nome: R.nomes[k], c: it.tipo === "f" ? it.v : null, cnpj: it.tipo === "f" ? it.v : "", cor: R.cores[k], bench: it.tipo === "i", ret: rets(R.sim.porAtivo[k]) }));
  itens.push({ nome: "★ Carteira", cor: OURO, bench: true, ret: rets(R.sim.valor) });
  R.corr = { itens, m: matrizCorrelacao(itens.map((i) => i.ret)) };
  renderMatrizCorr("tabCartCorr", "cart", itens, R.corr.m);
}

// ---------- janela móvel da carteira e dos ativos (no período da carteira)
function calcularCartJM() {
  const R = st.cartRes; if (!R) return;
  const b = st.cartUI.jmBench, meses = st.cartUI.jmMeses;
  let bench = b.tipo === "n" ? "" : b.v, nomeB = b.tipo === "n" ? "" : b.rot;
  if (b.tipo === "f") { const g = st.res.fundos.get(b.v); if (g) bench = { fundo: g }; else { bench = "CDI"; nomeB = "CDI"; } }
  const ini = diaDe(new Date(st.cartUI.jmIni)), fim = diaDe(new Date(st.cartUI.jmFim));
  // carteira refeita no período da janela móvel (mesmos pesos e rebalanceamento)
  const simJ = simularCarteira(R.ativos, R.pesos, { ini, fim, rebal: R.rebal });
  const p = { bench, meses, ini, fim };
  const lista = [...(simJ ? [{ nome: "★ Carteira", cor: corCarteira(), forte: true, f: pseudoFundo(simJ.dias, simJ.valor) }] : []),
    ...R.validos.map((it, k) => {
      const s = R.ativos[k].s;
      return { nome: R.nomes[k], c: it.tipo === "f" ? it.v : null, cor: R.cores[k], fraca: true,
        f: it.tipo === "f" ? st.res.fundos.get(it.v) : pseudoFundo(s.d, s.L) };
    })].filter((x) => !(b.tipo === "f" && x.c === b.v));
  for (const x of lista) { x.linhas = janelaMovel(x.f, st.idx, p); x.resumo = x.linhas.length ? resumoJanela(x.linhas) : null; }
  R.jm = { p, nomeB, lista: lista.filter((x) => x.resumo), simJ };
}
function renderCartJM() {
  const jm = st.cartRes?.jm; if (!jm) return;
  const n = jm.lista.reduce((s, x) => s + x.linhas.length, 0);
  $("#cartJmCorpo").hidden = !jm.lista.length;
  if (!jm.lista.length) { $("#cartJmInfo").innerHTML = `<p class="nota">Nenhuma janela de ${jm.p.meses} meses cabe entre ${fmtData(jm.p.ini)} e ${fmtData(jm.p.fim)}. Diminua a duração ou amplie as datas.</p>`; return; }
  const prim = Math.min(...jm.lista.map((x) => x.resumo.primeira)), ult = Math.max(...jm.lista.map((x) => x.resumo.ultima));
  $("#cartJmInfo").innerHTML = [`<b>${jm.p.meses} meses</b> de aplicação`, `benchmark: <b>${esc(jm.nomeB || "nenhum")}</b>`,
    `aplicações de <b>${fmtData(prim)}</b> a <b>${fmtData(ult)}</b>`, `<b>${br(n, 0)}</b> janelas`].map((t) => `<span>${t}</span>`).join("") +
    (jm.simJ?.cortadoIni ? `<span class="aviso-chip">a carteira só começa em ${fmtData(jm.simJ.dias[0])}, quando todos os ativos têm cota</span>` : "") +
    (!jm.simJ ? `<span class="aviso-chip">a carteira não tem dias em comum nesse intervalo; aparecem só os ativos</span>` : "");
  const series = jm.lista.map((x) => { const v = x.linhas.filter((l) => l.dif != null); return { nome: x.nome, c: x.c, cor: x.cor, forte: x.forte, fraca: x.fraca, x: v.map((l) => l.ini), y: v.map((l) => l.dif) }; });
  grafico("gCartJM", series, { ref: 0, xMin: prim, xMax: ult, tituloX: (x) => `Aplicação em ${fmtData(x)}` });
  $("#legCartJM").innerHTML = tabelaLegenda("cartJM", jm.lista.map((x, i) => ({ Fundo: x.nome, _c: x.c, cor: x.cor,
    Final: series[i].y.length ? series[i].y[series[i].y.length - 1] : null, Mediana: x.resumo.med.dif })), ["Final", "Mediana"]);
  renderTabCartJM();
}
function renderTabCartJM() {
  const jm = st.cartRes?.jm; if (!jm || !jm.lista.length) return;
  $("#tabCartJM").innerHTML = htmlResumoJM(jm.lista.map((x) => ({ _c: x.c, Fundo: x.nome, CNPJ: x.c ? cnpjFmt(x.c) : "", resumo: x.resumo })), jm.nomeB, "cartJM");
}

let tCart;
const recalcularCarteiraDepois = () => { clearTimeout(tCart); tCart = setTimeout(calcularCarteira, 400); };
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.matches(".cart-peso")) { st.cart.itens[Number(t.dataset.i)].peso = Math.max(0, Number(t.value) || 0); salvarCart(); atualizarSoma(); recalcularCarteiraDepois(); }
});
document.addEventListener("change", (e) => {
  const t = e.target, c = st.cart;
  if (t.id === "cartRebal") { c.rebal = Number(t.value); salvarCart(); calcularCarteira(); }
  else if (t.id === "cartValor") { c.valor = Math.max(0, Number(t.value) || 0); salvarCart(); calcularCarteira(); }
  else if (t.id === "cartIni" || t.id === "cartFim") { c[t.id === "cartIni" ? "ini" : "fim"] = t.value; salvarCart(); if (c.ini && c.fim) calcularCarteira(); }
  else if (t.id === "cartRelOn") { st.cartUI.rel.on = t.checked; semZoom("gCartEvol"); renderCartAcum(); }
  else if (t.id === "cartJmMeses") st.cartUI.jmMeses = Math.max(1, Math.min(240, Number(t.value) || 12));
  else if (t.id === "cartJmIni" || t.id === "cartJmFim") st.cartUI[t.id === "cartJmIni" ? "jmIni" : "jmFim"] = t.value;
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
  else if (t.closest?.("#cartRelModo button")) { st.cartUI.rel.modo = t.closest("button").dataset.m; semZoom("gCartEvol"); renderCartAcum(); }
  else if (t.closest?.("#cartRiscoEixo button")) { st.cartUI.eixo = t.closest("button").dataset.e; delete st.ord.cartRisco; semZoom("gCartRR"); renderCartRisco(); }
  else if (t.id === "cartJmAtualizar") {
    st.cartUI.jmMeses = Math.max(1, Math.min(240, Number($("#cartJmMeses").value) || 12));
    st.cartUI.jmIni = $("#cartJmIni").value || st.cartUI.jmIni; st.cartUI.jmFim = $("#cartJmFim").value || st.cartUI.jmFim;
    semZoom("gCartJM"); calcularCartJM(); renderCartJM();
  }
  else if (t.id === "cartJmBaixar") {
    const jm = st.cartRes?.jm; if (!jm) return;
    baixarCSVJM(jm.lista.map((x) => ({ nome: x.nome, cnpj: x.c ? cnpjFmt(x.c) : "", linhas: x.linhas })), jm.nomeB, jm.p.meses, "janela_movel_carteira");
  }
});

// ============================== relatórios: PDF, PNG e Excel ==============================
// As bibliotecas só são baixadas na hora de gerar o arquivo (não pesam no uso normal do site).
const CDN = "https://cdn.jsdelivr.net/npm/";
const LIBS = {
  pdf: [CDN + "jspdf@2.5.2/dist/jspdf.umd.min.js", () => window.jspdf?.jsPDF],
  tabelaPdf: [CDN + "jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js", () => window.jspdf?.jsPDF?.API?.autoTable],
  imagem: [CDN + "html2canvas@1.4.1/dist/html2canvas.min.js", () => window.html2canvas],
  zip: [CDN + "jszip@3.10.1/dist/jszip.min.js", () => window.JSZip],
  excel: [CDN + "exceljs@4.4.0/dist/exceljs.min.js", () => window.ExcelJS],
};
const libsPromessas = {};
function carregarLib(k) {
  const [url, pronto] = LIBS[k];
  if (pronto()) return Promise.resolve();
  return (libsPromessas[k] ||= new Promise((ok, erro) => {
    const s = document.createElement("script"), limite = setTimeout(() => { delete libsPromessas[k]; erro(new Error("tempo esgotado ao baixar a biblioteca de " + k)); }, 45000);
    s.src = url; s.async = true;
    s.onload = () => { clearTimeout(limite); pronto() ? ok() : (delete libsPromessas[k], erro(new Error("a biblioteca de " + k + " não carregou"))); };
    s.onerror = () => { clearTimeout(limite); delete libsPromessas[k]; erro(new Error("não foi possível baixar a biblioteca de " + k + " (confira a internet)")); };
    document.head.appendChild(s);
  }));
}
const pausa = () => new Promise((r) => setTimeout(r, 15));

// ---------- o que pode entrar no relatório
const SECOES_REL = [
  { k: "fundos", g: "Fundos", nome: "Lista dos fundos analisados", ok: () => !!st.ctx },
  { k: "met", g: "Fundos", nome: "Métricas (todos os períodos calculados)", ok: () => !!st.ctx },
  { k: "acum", g: "Fundos", nome: "Rentabilidade acumulada", ok: () => !!st.ctx && !!st.graficos.gAcum },
  { k: "dd", g: "Fundos", nome: "Drawdown", ok: () => !!st.ctx && !!st.graficos.gDd },
  { k: "risco", g: "Fundos", nome: "Risco × retorno", ok: () => !!st.ctx?.riscoPts },
  { k: "corr", g: "Fundos", nome: "Correlação", ok: () => !!st.ctx?.dados._corr?.m },
  { k: "jm", g: "Fundos", nome: "Janela móvel", ok: () => !!st.res?.jm?.porFundo.length },
  { k: "cartResumo", g: "Carteira", nome: "Resumo (indicadores, pesos e contribuição)", ok: () => !!st.cartRes },
  { k: "cartMet", g: "Carteira", nome: "Métricas da carteira e dos ativos", ok: () => !!st.cartRes?.metricas },
  { k: "cartAcum", g: "Carteira", nome: "Rentabilidade acumulada", ok: () => !!st.cartRes && !!st.graficos.gCartEvol },
  { k: "cartDd", g: "Carteira", nome: "Drawdown", ok: () => !!st.cartRes && !!st.graficos.gCartDD },
  { k: "cartRisco", g: "Carteira", nome: "Risco × retorno", ok: () => !!st.cartUI.pts && !!st.cartRes },
  { k: "cartCorr", g: "Carteira", nome: "Correlação", ok: () => !!st.cartRes?.corr },
  { k: "cartJm", g: "Carteira", nome: "Janela móvel", ok: () => !!st.cartRes?.jm?.lista.length },
  { k: "rkTop", g: "Rankings", nome: "Top 10 de cada ranking", ok: () => !!st.rk?.lista.length },
  { k: "rkJM", g: "Rankings", nome: "Janela móvel do top 10", ok: () => !!st.rk?.lista.length },
  { k: "rkCorr", g: "Rankings", nome: "Correlação do top 10", ok: () => !!st.rk?.lista.length },
  { k: "rkPesos", g: "Rankings", nome: "Critérios e pesos", ok: () => !!st.rk?.lista.length },
  { k: "rkCompleto", g: "Rankings", nome: "Rankings completos com a pontuação de cada métrica (só no Excel)", ok: () => !!st.rk?.lista.length },
  { k: "rawCotas", g: "Dados", bruto: true, nome: "Cotas diárias dos fundos (cota, variação, CDI do dia, captação, resgate, PL, cotistas)", ok: () => !!st.ctx },
  { k: "rawIdx", g: "Dados", bruto: true, nome: "Índices diários (CDI, Selic, Ibovespa, IPCA, IGP-M, dólar, S&P 500)", ok: () => !!st.ctx },
  { k: "rawJm", g: "Dados", bruto: true, nome: "Janela móvel dos fundos: todas as janelas", ok: () => !!st.res?.jm?.porFundo.length },
  { k: "rawCart", g: "Dados", bruto: true, nome: "Carteira dia a dia: valor, peso e ganho de cada ativo", ok: () => !!st.cartRes },
  { k: "rawCartJm", g: "Dados", bruto: true, nome: "Janela móvel da carteira: todas as janelas", ok: () => !!st.cartRes?.jm?.lista.length },
];
const disponivel = (s) => s.ok() && (!s.bruto || rel.fmt === "xlsx");
const rel = { sel: new Set(pref("relSel", ["fundos", "met", "acum", "risco"])), fmt: pref("relFmt", "pdf"), pngUm: false, xlsImg: true, dest: new Set(), destIni: false };

function abrirRelatorio() {
  const grupos = [...new Set(SECOES_REL.map((s) => s.g))];
  const titulo = { Fundos: "Análise dos fundos · " + esc(st.perAtivo || ""), Carteira: "Montagem de carteira", Rankings: "Rankings", Dados: "Dados usados nos cálculos · só no Excel" };
  $("#relSecoes").innerHTML = grupos.map((g) => `<div class="rel-grupo${g === "Dados" ? " rel-dados" : ""}"><div class="rel-g-cab"><b>${titulo[g]}</b>
      <span><button class="link" type="button" data-rel-g="${g}" data-marca="1">marcar tudo</button> · <button class="link" type="button" data-rel-g="${g}" data-marca="0">desmarcar</button></span></div>` +
    (g === "Dados" ? `<span class="nota">Uma linha por fundo (ou ativo) e por dia, "um embaixo do outro": bom para tabela dinâmica e filtros.</span>` : "") +
    SECOES_REL.filter((s) => s.g === g).map((s) => `<label class="tog" data-sec-rel="${s.k}"><input type="checkbox" data-rel="${s.k}"> ${esc(s.nome)} <small></small></label>`).join("") + `</div>`).join("");
  desenharFormatoRel();
  // destaque do relatório: na 1ª vez, começa com os fundos destacados na tela
  if (!rel.destIni && st.res) {
    rel.destIni = true;
    if (st.destaque.trim()) for (const c of st.res.sel) if (casa(st.destaque, st.porCnpj.get(c)?.NOME, cnpjFmt(c), st.res.apelidos[c])) rel.dest.add(c);
  }
  const calculados = new Set([...(st.res?.sel || []), ...(st.rk ? [...st.rk.fundos.keys()] : [])]);
  for (const c of [...rel.dest]) if (!calculados.has(c)) rel.dest.delete(c);
  $("#relDestBusca").value = ""; $("#relDestSo").checked = false;
  renderDestRel();
  $("#relProg").textContent = ""; $("#relBaixar").disabled = false;
  $("#dlgRel").showModal();
}
function desenharFormatoRel() {
  $$("#relFmt button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.f === rel.fmt));
  $("#relOpPng").hidden = rel.fmt !== "png"; $("#relOpXls").hidden = rel.fmt !== "xlsx"; $("#relOpPdf").hidden = rel.fmt !== "pdf";
  for (const s of SECOES_REL) {               // marca e libera cada parte conforme o que foi calculado e o formato
    const lab = $(`[data-sec-rel="${s.k}"]`); if (!lab) continue;
    const ok = disponivel(s), inp = $("input", lab);
    inp.disabled = !ok; inp.checked = ok && rel.sel.has(s.k); lab.classList.toggle("indisp", !ok);
    $("small", lab).textContent = !s.ok() ? `(calcule ${s.g === "Carteira" || s.k.startsWith("rawCart") ? "a carteira" : s.g === "Rankings" ? "os rankings" : "os fundos"} antes)` : !ok ? "(só no Excel)" : "";
  }
  const escolhidas = SECOES_REL.filter((s) => disponivel(s) && rel.sel.has(s.k));
  const brutos = escolhidas.filter((s) => s.bruto);
  $("#relEstim").textContent = brutos.length ? `Dados usados nos cálculos: cerca de ${br(contarLinhasBrutas(brutos.map((s) => s.k)), 0)} linhas.` : "";
  $("#relBaixar").textContent = `⬇ Baixar ${({ pdf: "PDF", png: "PNG", xlsx: "Excel" })[rel.fmt]} (${escolhidas.length} parte${escolhidas.length === 1 ? "" : "s"})`;
  $("#relBaixar").disabled = !escolhidas.length;
}

// ---------- fundos destacados no relatório (clique na linha para marcar, como na lista de fundos)
function renderDestRel() {
  const q = $("#relDestBusca").value.trim().toUpperCase(), so = $("#relDestSo").checked;
  const base = [...new Set([...(st.res?.sel || []), ...(st.rk ? [...st.rk.fundos.keys()] : [])])].map((c) => st.porCnpj.get(c)).filter(Boolean)
    .filter((f) => (!so || rel.dest.has(f.CNPJ)) && (!q || f._busca.includes(q) || (q.replace(/\D/g, "").length >= 3 && f.CNPJ.includes(q.replace(/\D/g, "")))));
  const lista = ordenarFundos(base, "relDest");
  $("#relDestN").textContent = rel.dest.size;
  $("#relDestTab").innerHTML = lista.length ? `<table class="tb tab-fundos">${cabFundos("relDest", false)}<tbody>${lista.map((f) =>
    `<tr class="linha-f${rel.dest.has(f.CNPJ) ? " marcado" : ""}" data-dest="${f.CNPJ}" tabindex="0" title="${rel.dest.has(f.CNPJ) ? "Destacado · clique para tirar" : "Clique para destacar"}">` +
    COLS_FUNDO.map((c) => celFundo(f, c)).join("") + "</tr>").join("")}</tbody></table>` : `<p class="nota" style="padding:10px">Nenhum fundo ${so ? "destacado" : "encontrado"}.</p>`;
}
// nomes, apelidos e CNPJs dos fundos escolhidos (os gráficos e tabelas usam um ou outro)
function conjuntoDestaque(cnpjs) {
  const out = new Set();
  for (const c of cnpjs) { out.add(c); out.add(cnpjFmt(c)); const n = st.porCnpj.get(c)?.NOME; if (n) out.add(n); const a = st.res?.apelidos[c]; if (a) out.add(a);
    for (const R of st.rk?.lista || []) { const x = R.ordem.find((o) => o.id === c); if (x) { const nm = nomeRk(R, c); out.add(nm); out.add(`${x.pos}. ${nm}`); out.add(`${x.pos}. ${x.l.cad.NOME}`); } } }
  return out;
}
const linhaDestacada = (l) => !!st.destExtra && l.some((v) => typeof v === "string" && (st.destExtra.has(v) || st.destExtra.has(v.replace(/^\d+\.\s/, "").replace(/ \([^)]*\)$/, ""))));

// ---------- blocos de cada parte: títulos, imagens dos gráficos e tabelas completas (valores brutos + tipo)
// tabela: { nome, colunas: [{ nome, tipo }], linhas: [[...]], soExcel?, nota? }
const tipoCol = (t) => (t === "valor" ? "valor" : t);
function imagemGrafico(id) {
  const g = st.graficos[id]; if (!g) return null;
  const c = g.canvas, out = document.createElement("canvas");
  out.width = c.width; out.height = c.height;
  const ctx = out.getContext("2d");
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--card").trim() || "#fff"; ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(c, 0, 0);
  return { url: out.toDataURL("image/png"), w: c.clientWidth || c.width, h: c.clientHeight || c.height };
}
// séries de um gráfico de linhas lado a lado: Data | série 1 | série 2 …
function tabelaDoGrafico(id, nome, tipo = "pct", rotuloX = "Data") {
  const g = st.graficos[id]; if (!g) return null;
  const dss = g.data.datasets.filter((d) => d.label !== "Zero"), xs = new Set();
  for (const d of dss) for (const p of d.data) xs.add(p.x);
  const ord = [...xs].sort((a, b) => a - b), pos = new Map(ord.map((x, i) => [x, i]));
  const linhas = ord.map((x) => [x, ...dss.map(() => null)]);
  dss.forEach((d, j) => { for (const p of d.data) linhas[pos.get(p.x)][j + 1] = p.y; });
  return { nome, soExcel: true, colunas: [{ nome: rotuloX, tipo: "data" }, ...dss.map((d) => ({ nome: d.label, tipo }))], linhas,
    nota: "Valores de cada dia, como no gráfico (respeita o controle de datas e o modo relativo, se ligados)." };
}
function tabelaFinal(id, nome, extra) {      // valor no último dia de cada série (a legenda do gráfico, completa)
  const g = st.graficos[id]; if (!g) return null;
  const linhas = g.data.datasets.filter((d) => d.label !== "Zero").map((d) => [d.label, d.data.length ? d.data[d.data.length - 1].y : null, ...(extra ? [extra(d)] : [])])
    .sort((a, b) => (b[1] ?? -Infinity) - (a[1] ?? -Infinity));
  return { nome, colunas: [{ nome: "Fundo / série", tipo: "txt" }, { nome: "No fim do período", tipo: "pct" }, ...(extra ? [{ nome: "Máxima queda", tipo: "pct" }] : [])], linhas };
}
const minimoSerie = (d) => d.data.reduce((m, p) => Math.min(m, p.y), 0);
function tabelaMatriz(nome, itens, m) {
  const n = itens.length, nomes = itens.map((it, i) => `${i + 1}. ${it.nome}`);
  return { nome, soExcel: n > 14, colunas: [{ nome: "Correlação", tipo: "txt" }, ...nomes.map((x) => ({ nome: x, tipo: "num2" }))],
    linhas: itens.map((_, i) => [nomes[i], ...itens.map((__, j) => (i === j ? 1 : Number.isNaN(m[i * n + j]) ? null : m[i * n + j]))]) };
}
// matriz inteira desenhada numa imagem (com nomes até 40 séries; acima disso, só as cores)
function imagemMatriz(itens, m) {
  const n = itens.length, r = (i, j) => (i === j ? 1 : Number.isNaN(m[i * n + j]) ? null : m[i * n + j]);
  const fundo = getComputedStyle(document.body).getPropertyValue("--card").trim() || "#fff", txt = corTexto();
  const cv = document.createElement("canvas"), g = cv.getContext("2d"), esc2 = 2;
  if (n > 40) {
    const lado = Math.max(2, Math.min(10, Math.floor(1200 / n))), tam = lado * n;
    cv.width = cv.height = tam * esc2; g.scale(esc2, esc2); g.fillStyle = fundo; g.fillRect(0, 0, tam, tam);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const v = r(i, j); g.fillStyle = i === j ? OURO : corPar(v)[0]; g.fillRect(j * lado, i * lado, lado, lado); }
    return { url: cv.toDataURL("image/png"), w: tam, h: tam };
  }
  const L = 250, C = 46, H = 24, P = 160, W = L + n * C, A = n * H + P;
  cv.width = W * esc2; cv.height = A * esc2; g.scale(esc2, esc2); g.fillStyle = fundo; g.fillRect(0, 0, W, A);
  g.font = "600 11px Manrope, sans-serif"; g.textBaseline = "middle";
  for (let i = 0; i < n; i++) {
    g.textAlign = "left"; g.fillStyle = txt; g.fillText(textoCabe(g, `${i + 1}. ${itens[i].nome}`, L - 12), 6, i * H + H / 2);
    for (let j = 0; j < n; j++) {
      const v = r(i, j), [bg, fg] = i === j ? [OURO, "#141a4a"] : corPar(v);
      g.fillStyle = bg; g.fillRect(L + j * C + 1, i * H + 1, C - 2, H - 2);
      g.fillStyle = fg; g.textAlign = "center"; g.fillText(v == null ? "n/a" : i === j ? "1" : br(v, 2), L + j * C + C / 2, i * H + H / 2);
    }
  }
  g.textAlign = "right"; g.fillStyle = txt;
  for (let j = 0; j < n; j++) { g.save(); g.translate(L + j * C + C / 2, n * H + 8); g.rotate(-Math.PI / 2); g.fillText(textoCabe(g, `${j + 1}. ${itens[j].nome}`, P - 14), 0, 0); g.restore(); }
  return { url: cv.toDataURL("image/png"), w: W, h: A };
}
function tabelaResumoJM(nome, lista, nomeB) {        // lista: [{ nome, cnpj, resumo }]
  const B = nomeB || "Benchmark", faixa = (rot, comData) => [...(comData ? [{ nome: `${rot}: data de início`, tipo: "data" }] : []),
    { nome: `${rot}: rentabilidade`, tipo: "pct" }, { nome: `${rot}: fundo a.a.`, tipo: "pct" }, { nome: `${rot}: ${B} a.a.`, tipo: "pct" }, { nome: `${rot}: diferença`, tipo: "pct" }];
  const val = (f, comData) => [...(comData ? [f.data] : []), f.ret, f.retAA, f.benchAA, f.dif];
  return { nome, colunas: [{ nome: "Fundo", tipo: "txt" }, { nome: "CNPJ", tipo: "txt" }, { nome: "Primeira aplicação", tipo: "data" }, { nome: "Última aplicação", tipo: "data" },
      ...faixa("Mínimo", true), ...faixa("Mediana", false), ...faixa("Máximo", true),
      { nome: "Janelas", tipo: "int" }, { nome: `Abaixo do ${B}`, tipo: "int" }, { nome: `Acima do ${B}`, tipo: "int" }, { nome: "Negativas", tipo: "int" }, { nome: "Positivas", tipo: "int" },
      { nome: `% acima do ${B}`, tipo: "pct" }, { nome: "% positivas", tipo: "pct" }],
    linhas: lista.map(({ nome: n, cnpj, resumo: r }) => [n, cnpj || "", r.primeira, r.ultima, ...val(r.min, true), ...val(r.med, false), ...val(r.max, true),
      r.total, r.abaixo, r.acima, r.negativas, r.positivas, r.pAcima, r.pPositivas]) };
}
const tabelaMetricasRel = (nome, linhas, colunas) => ({ nome, colunas: colunas.map((c) => ({ nome: c.nome, tipo: tipoCol(c.tipo) })),
  linhas: linhas.map((l) => colunas.map((c) => (c.chave === "Fundo" ? (l._parado ? `${l.Fundo} (${l._parado.rot.toLowerCase()})` : l.Fundo) : l[c.chave]))) });

// ---------- dados usados nos cálculos ("um embaixo do outro")
function faixasFundos() {                      // período de cada fundo: da menor data inicial à maior data final entre os períodos calculados
  const fx = new Map();
  for (const p of Object.values(st.res.periodos)) for (const l of p.linhas) {
    const a = fx.get(l._c); fx.set(l._c, a ? [Math.min(a[0], l["Data Inicial"]), Math.max(a[1], l["Data Final"])] : [l["Data Inicial"], l["Data Final"]]);
  }
  return fx;
}
function faixaIndices() {
  let a = Infinity, b = -Infinity;
  for (const [x, y] of faixasFundos().values()) { a = Math.min(a, x); b = Math.max(b, y); }
  if (st.cartRes) { a = Math.min(a, st.cartRes.d0); b = Math.max(b, st.cartRes.dN); }
  return [a, b];
}
function contarLinhasBrutas(ks) {
  let n = 0;
  for (const k of ks) {
    if (k === "rawCotas") for (const [c, [a, b]] of faixasFundos()) { const f = st.res.fundos.get(c); if (f) n += upperBound(f.d, b) - lowerBound(f.d, a); }
    else if (k === "rawIdx") { const [a, b] = faixaIndices(); for (const x of st.idx.disponiveis) { const nv = st.idx.niveis[x]; n += upperBound(nv.d, b) - lowerBound(nv.d, a); } }
    else if (k === "rawJm") n += st.res.jm.porFundo.reduce((s, x) => s + x.linhas.length, 0);
    else if (k === "rawCart") n += st.cartRes.sim.dias.length * (st.cartRes.validos.length + 1);
    else if (k === "rawCartJm") n += st.cartRes.jm.lista.reduce((s, x) => s + x.linhas.length, 0);
  }
  return n;
}
const linhasJanelas = (lista) => lista.flatMap(({ nome, cnpj, linhas }) => linhas.map((l) => [nome, cnpj || "", l.ini, l.fim, l.du, l.linhas, l.ret, l.retAA, l.benchAA, l.dif]));
const colsJanelas = (B) => [{ nome: "Fundo", tipo: "txt" }, { nome: "CNPJ", tipo: "txt" }, { nome: "Data inicial", tipo: "data" }, { nome: "Data final", tipo: "data" },
  { nome: "Dias úteis (ANBIMA)", tipo: "int" }, { nome: "Dias com cota na CVM", tipo: "int" }, { nome: "Rentabilidade no período", tipo: "pct6" },
  { nome: "Fundo anualizado", tipo: "pct6" }, { nome: `${B || "Benchmark"} anualizado`, tipo: "pct6" }, { nome: `Diferença para o ${B || "benchmark"}`, tipo: "pct6" }];
function blocosBrutos(k) {
  const B = [], bruto = (t) => B.push({ tipo: "tabela", soExcel: true, bruto: true, ...t });
  if (k === "rawCotas") {
    const linhas = [];
    for (const [c, [a, b]] of faixasFundos()) {
      const f = st.res.fundos.get(c); if (!f) continue;
      const nome = st.porCnpj.get(c)?.NOME || c, cn = cnpjFmt(c);
      for (let i = lowerBound(f.d, a), fim = upperBound(f.d, b); i < fim; i++)
        linhas.push([nome, cn, f.d[i], f.q[i], i ? f.qa[i] : null, i ? f.vari[i] : null, Number.isNaN(f.cdi[i]) ? null : f.cdi[i] / 100,
          f.capt[i], f.resg[i], Number.isNaN(f.pl[i]) ? null : f.pl[i], Number.isNaN(f.cot[i]) ? null : f.cot[i]]);
    }
    bruto({ nome: "Dados - cotas diárias", nota: "CDI do dia = taxa do dia útil anterior (% a.a.), como no cálculo das métricas. Inclui todos os períodos calculados.",
      colunas: [{ nome: "Fundo", tipo: "txt" }, { nome: "CNPJ", tipo: "txt" }, { nome: "Data", tipo: "data" }, { nome: "Cota", tipo: "cota" }, { nome: "Cota anterior", tipo: "cota" },
        { nome: "Variação do dia", tipo: "pct6" }, { nome: "CDI do dia (a.a.)", tipo: "pct6" }, { nome: "Captação", tipo: "valor" }, { nome: "Resgate", tipo: "valor" },
        { nome: "Patrimônio líquido", tipo: "valor" }, { nome: "Cotistas", tipo: "int" }], linhas });
    return { titulo: "Dados · cotas diárias dos fundos", blocos: B };
  }
  if (k === "rawIdx") {
    const [a, b] = faixaIndices(), linhas = [];
    for (const x of st.idx.disponiveis) {
      const nv = st.idx.niveis[x], tipo = INDICES[x].tipo;
      for (let i = lowerBound(nv.d, a), fim = upperBound(nv.d, b); i < fim; i++) {
        const v = i ? nv.L[i] / nv.L[i - 1] - 1 : null;
        linhas.push([nomeIndice(x), nv.d[i], nv.L[i], v, tipo === "taxa" && v != null ? (1 + v) ** 252 - 1 : null]);
      }
    }
    bruto({ nome: "Dados - índices diários", nota: "Nível = preço (Ibovespa, dólar, S&P) ou índice acumulado (CDI, Selic, IPCA e IGP-M, com a inflação do mês distribuída pelos dias úteis).",
      colunas: [{ nome: "Índice", tipo: "txt" }, { nome: "Data", tipo: "data" }, { nome: "Nível", tipo: "cota" }, { nome: "Variação do dia", tipo: "pct6" }, { nome: "Taxa ao ano (CDI e Selic)", tipo: "pct6" }], linhas });
    return { titulo: "Dados · índices diários", blocos: B };
  }
  if (k === "rawJm") {
    const jm = st.res.jm;
    bruto({ nome: "Dados - janelas dos fundos", colunas: colsJanelas(jm.nomeB),
      linhas: linhasJanelas(jm.porFundo.map(({ c, linhas }) => ({ nome: st.porCnpj.get(c)?.NOME || c, cnpj: cnpjFmt(c), linhas }))) });
    return { titulo: `Dados · janela móvel dos fundos (${jm.p.meses} meses)`, blocos: B };
  }
  if (k === "rawCart") {
    const R = st.cartRes, c = st.cart;
    const det = simularCarteira(R.ativos, R.pesos, { ini: diaDe(new Date(c.ini)), fim: diaDe(new Date(c.fim)), rebal: R.rebal, detalhe: true });
    const v0 = Number(c.valor) || 0, linhas = [];
    for (let t = 0; t < det.dias.length; t++) {
      R.validos.forEach((it, k2) => linhas.push([det.dias[t], R.nomes[k2], det.porAtivo[k2][t], det.posDia[k2][t] * v0, det.posDia[k2][t] / det.valor[t], det.ganhoDia[k2][t] * v0]));
      linhas.push([det.dias[t], "Carteira", det.valor[t], det.valor[t] * v0, 1, t ? (det.valor[t] - det.valor[t - 1]) * v0 : 0]);
    }
    bruto({ nome: "Dados - carteira diária", nota: `Valores em R$ para R$ ${br(v0, 0)} aplicados. Peso no fim do dia, antes do rebalanceamento.`,
      colunas: [{ nome: "Data", tipo: "data" }, { nome: "Ativo", tipo: "txt" }, { nome: "Nível do ativo (base 1)", tipo: "cota" }, { nome: "Valor na carteira (R$)", tipo: "valor" },
        { nome: "Peso no dia", tipo: "pct6" }, { nome: "Ganho do dia (R$)", tipo: "valor" }], linhas });
    return { titulo: "Dados · carteira dia a dia", blocos: B };
  }
  if (k === "rawCartJm") {
    const jm = st.cartRes.jm;
    bruto({ nome: "Dados - janelas da carteira", colunas: colsJanelas(jm.nomeB), linhas: linhasJanelas(jm.lista.map((x) => ({ nome: x.nome, cnpj: x.c ? cnpjFmt(x.c) : "", linhas: x.linhas }))) });
    return { titulo: `Dados · janela móvel da carteira (${jm.p.meses} meses)`, blocos: B };
  }
  return null;
}

function blocosRel(k) {
  if (k.startsWith("raw")) return blocosBrutos(k);
  if (k.startsWith("rk")) return blocosRanking(k);
  const res = st.res, R = st.cartRes, apel = res?.apelidos || {};
  const per = st.perAtivo, B = [];
  const img = (id, titulo) => { const i = imagemGrafico(id); if (i) B.push({ tipo: "img", titulo, ...i }); };
  switch (k) {
    case "fundos": {
      const fim = res.fimComum;
      B.push({ tipo: "tabela", nome: "Fundos analisados", colunas: [{ nome: "Fundo", tipo: "txt" }, { nome: "CNPJ", tipo: "txt" }, { nome: "Classificação CVM", tipo: "txt" },
          { nome: "Classificação ANBIMA", tipo: "txt" }, { nome: "Gestor", tipo: "txt" }, { nome: "1ª cota", tipo: "data" }, { nome: "Última cota", tipo: "data" }, { nome: "Situação", tipo: "txt" }],
        linhas: res.sel.map((c) => { const f = res.fundos.get(c), cad = st.porCnpj.get(c) || {}, pa = f ? situacaoParado(f, cad, fim) : null;
          return [cad.NOME || c, cnpjFmt(c), cad.CLASSIFICACAO_CVM || "", cad.CLASSIFICACAO_ANBIMA || "", cad.GESTOR || "", f ? f.d[0] : null, f ? f.d[f.d.length - 1] : null,
            !f ? "sem cotas na base" : pa ? pa.txt : "ativo"]; }) });
      return { titulo: "Fundos analisados", blocos: B };
    }
    case "met": {
      const cols = COLUNAS.map(([, n, t]) => ({ chave: n, nome: n, tipo: t }));
      for (const p of Object.keys(res.periodos)) B.push({ tipo: "tabela", ...tabelaMetricasRel(`Métricas ${p}`, res.periodos[p].linhas, cols) });
      return { titulo: "Métricas", blocos: B, nota: "Uma tabela por período calculado." };
    }
    case "acum": img("gAcum", "Rentabilidade acumulada"); B.push({ tipo: "tabela", ...tabelaFinal("gAcum", "Rentab. acumulada - final") }, { tipo: "tabela", ...tabelaDoGrafico("gAcum", "Rentab. acumulada - diária") });
      return { titulo: `Rentabilidade acumulada · ${per}${st.rel.on ? ` · relativa a ${st.rel.alvo} (${st.rel.modo === "dif" ? "diferença" : "% do alvo"})` : ""}`, blocos: B };
    case "dd": img("gDd", "Drawdown"); B.push({ tipo: "tabela", ...tabelaFinal("gDd", "Drawdown - final", minimoSerie) }, { tipo: "tabela", ...tabelaDoGrafico("gDd", "Drawdown - diário") });
      return { titulo: `Drawdown · ${per}`, blocos: B };
    case "risco": img("gRisco", "Risco × retorno");
      B.push({ tipo: "tabela", nome: "Risco x retorno", colunas: [{ nome: "Fundo / índice", tipo: "txt" }, { nome: "Retorno a.a.", tipo: "pct" }, { nome: "Volatilidade a.a.", tipo: "pct" }, { nome: "Sharpe", tipo: "num2" }],
        linhas: st.ctx.riscoPts.map((p) => [p.nome, p.ret, p.vol, p.sharpe]) });
      return { titulo: `Risco × retorno · ${per}`, blocos: B };
    case "corr": { const { itens, m } = st.ctx.dados._corr; B.push({ tipo: "img", titulo: "Correlação", ...imagemMatriz(itens, m) }, { tipo: "tabela", ...tabelaMatriz("Correlação", itens, m) });
      return { titulo: `Correlação dos retornos diários · ${per}`, blocos: B }; }
    case "jm": { const jm = res.jm; img("gJM", "Janela móvel");
      B.push({ tipo: "tabela", ...tabelaResumoJM("Janela móvel - resumo", jm.porFundo.map(({ c, resumo }) => ({ nome: st.porCnpj.get(c)?.NOME || c, cnpj: cnpjFmt(c), resumo })), jm.nomeB) },
        { tipo: "tabela", ...tabelaDoGrafico("gJM", "Janela móvel - gráfico", "pct", "Data de aplicação") });
      return { titulo: `Janela móvel · ${jm.p.meses} meses · benchmark ${jm.nomeB || "nenhum"}`, blocos: B }; }
    case "cartResumo": {
      const e = R.eT, v0 = Number(st.cart.valor) || 0;
      B.push({ tipo: "tabela", nome: "Carteira - indicadores", colunas: [{ nome: "Indicador", tipo: "txt" }, { nome: "Valor", tipo: "txt" }], linhas: [
        ["Período", `${fmtData(R.d0)} a ${fmtData(R.dN)}`], ["Rebalanceamento", R.rebal ? REBAL[R.rebal] : "nunca (comprar e manter)"], ["Referência", st.cart.ref.rot],
        ["Retorno no período", brPct(e.total)], ["Retorno ao ano", brPct(e.anual)], [`R$ ${br(v0, 0)} viram`, "R$ " + br(v0 * (1 + e.total), 2)],
        ["Volatilidade ao ano", brPct(e.vol)], ["Índice de Sharpe", e.sharpe == null ? "–" : br(e.sharpe, 2)], ["Máxima queda", brPct(e.mdd)],
        ["Meses positivos", e.mesesPos == null ? "–" : `${br(e.mesesPos * 100, 0)}% de ${e.nMeses}`], ["Melhor mês", brPct(e.melhorMes)], ["Pior mês", brPct(e.piorMes)]] });
      const lin = R.validos.map((it, k2) => [R.nomes[k2], R.pesos[k2], R.eA[k2].total, R.eA[k2].anual, R.eA[k2].vol, R.eA[k2].sharpe, R.eA[k2].mdd, R.sim.contrib[k2]]);
      lin.push(["Carteira", 1, e.total, e.anual, e.vol, e.sharpe, e.mdd, R.sim.contrib.reduce((a, b) => a + b, 0)]);
      if (R.eRef) lin.push([`Referência: ${st.cart.ref.rot}`, null, R.eRef.total, R.eRef.anual, R.eRef.vol, R.eRef.sharpe, R.eRef.mdd, null]);
      if (R.eBH) lin.push(["Mesma carteira sem rebalancear", 1, R.eBH.total, R.eBH.anual, R.eBH.vol, R.eBH.sharpe, R.eBH.mdd, null]);
      B.push({ tipo: "tabela", nome: "Carteira - ativos", colunas: [{ nome: "Ativo", tipo: "txt" }, { nome: "Peso", tipo: "pct" }, { nome: "Retorno", tipo: "pct" }, { nome: "Ao ano", tipo: "pct" },
        { nome: "Volatilidade", tipo: "pct" }, { nome: "Sharpe", tipo: "num2" }, { nome: "Máx. queda", tipo: "pct" }, { nome: "Contribuição", tipo: "pct" }], linhas: lin });
      return { titulo: "Montagem de carteira · resumo", blocos: B };
    }
    case "cartMet": B.push({ tipo: "tabela", ...tabelaMetricasRel("Carteira - métricas", R.metricas.linhas.map((l) => ({ ...l, Fundo: String(l.Fundo) })), R.metricas.colunas) });
      return { titulo: "Montagem de carteira · métricas", blocos: B };
    case "cartAcum": img("gCartEvol", "Carteira - rentabilidade"); B.push({ tipo: "tabela", ...tabelaFinal("gCartEvol", "Carteira - rentab. final") }, { tipo: "tabela", ...tabelaDoGrafico("gCartEvol", "Carteira - rentab. diária") });
      return { titulo: `Montagem de carteira · rentabilidade acumulada${st.cartUI.rel.on ? ` · relativa a ${st.cartUI.rel.alvo}` : ""}`, blocos: B };
    case "cartDd": img("gCartDD", "Carteira - drawdown"); B.push({ tipo: "tabela", ...tabelaFinal("gCartDD", "Carteira - drawdown final", minimoSerie) }, { tipo: "tabela", ...tabelaDoGrafico("gCartDD", "Carteira - drawdown diário") });
      return { titulo: "Montagem de carteira · drawdown", blocos: B };
    case "cartRisco": img("gCartRR", "Carteira - risco x retorno");
      B.push({ tipo: "tabela", nome: "Carteira - risco x retorno", colunas: [{ nome: "Ativo", tipo: "txt" }, { nome: "Retorno a.a.", tipo: "pct" }, { nome: "Volatilidade a.a.", tipo: "pct" }, { nome: "Sharpe", tipo: "num2" }],
        linhas: st.cartUI.pts.map((p) => [p.nome, p.anual, p.vol, p.sharpe]) });
      return { titulo: "Montagem de carteira · risco × retorno", blocos: B };
    case "cartCorr": B.push({ tipo: "img", titulo: "Carteira - correlação", ...imagemMatriz(R.corr.itens, R.corr.m) }, { tipo: "tabela", ...tabelaMatriz("Carteira - correlação", R.corr.itens, R.corr.m) });
      return { titulo: "Montagem de carteira · correlação", blocos: B };
    case "cartJm": { const jm = R.jm; img("gCartJM", "Carteira - janela móvel");
      B.push({ tipo: "tabela", ...tabelaResumoJM("Carteira - janela móvel", jm.lista.map((x) => ({ nome: x.nome, cnpj: x.c ? cnpjFmt(x.c) : "", resumo: x.resumo })), jm.nomeB) },
        { tipo: "tabela", ...tabelaDoGrafico("gCartJM", "Carteira - janela gráfico", "pct", "Data de aplicação") });
      return { titulo: `Montagem de carteira · janela móvel · ${jm.p.meses} meses · benchmark ${jm.nomeB || "nenhum"}`, blocos: B }; }
  }
  return null;
}

// ---------- formatação de texto (PDF e PNG)
const dataJs = (dia) => new Date(dia * 86400000);
const NF8 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 8, maximumFractionDigits: 8, useGrouping: false });
function fmtCel(v, tipo) {
  if (v == null || v === "") return "";
  if (typeof v !== "number") return String(v);
  return ({ pct: brPct(v), pct6: brPct(v, 4), data: fmtData(v), int: br(v, 0), num2: br(v, 2), num: br(v, 4), valor: br(v, 2), cota: NF8.format(v) })[tipo] ?? String(v);
}
// a fonte padrão do PDF só tem os caracteres latinos básicos
const pdfTxt = (s) => String(s ?? "").replace(/−/g, "-").replace(/[–—]/g, "-").replace(/★/g, "*").replace(/⊘/g, "(!)").replace(/▲/g, "+").replace(/▼/g, "-")
  .replace(/…/g, "...").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/≈/g, "~").replace(/[^\x00-\xFF]/g, "");
const cabecalhoRel = () => {
  const m = st.meta, n = st.res?.sel.length || 0;
  return `Gerado em ${new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })} · dados da CVM até ${fmtData(diaDe(new Date(m.ultimo_dado)))} · ${n} fundo(s)`;
};

// ---------- PDF (A4 deitado; tabelas largas continuam na página seguinte, repetindo a 1ª coluna)
async function gerarPDF(partes, prog) {
  prog("baixando a biblioteca de PDF…"); await carregarLib("pdf"); await carregarLib("tabelaPdf");
  const doc = new window.jspdf.jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 10;
  doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(43, 44, 120); doc.text("Análise de Fundos", M, 24);
  doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(80); doc.text(pdfTxt(cabecalhoRel()), M, 32);
  doc.setDrawColor(201, 162, 58); doc.setLineWidth(0.8); doc.line(M, 36, W - M, 36);
  doc.setFontSize(10); doc.text(pdfTxt("Conteúdo: " + partes.map((p) => p.titulo).join(" · ")), M, 44, { maxWidth: W - 2 * M });
  doc.setFontSize(8); doc.setTextColor(120); doc.text("Conteúdo informativo, não é recomendação de investimento. Rentabilidade passada não garante rentabilidade futura.", M, H - 8);
  for (let i = 0; i < partes.length; i++) {
    const p = partes[i]; prog(`montando o PDF: ${p.titulo} (${i + 1} de ${partes.length})…`); await pausa();
    doc.addPage(); let y = 16;
    doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(43, 44, 120); doc.text(pdfTxt(p.titulo), M, y); y += 3;
    doc.setDrawColor(201, 162, 58); doc.line(M, y, W - M, y); y += 5;
    if (p.nota) { doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(90); doc.text(pdfTxt(p.nota), M, y); y += 5; }
    for (const b of p.blocos) {
      if (b.tipo === "img") {
        let w = W - 2 * M, h = w * b.h / b.w;
        if (h > H - y - 12) { h = Math.max(60, H - y - 12); w = h * b.w / b.h; }
        if (y + h > H - 10) { doc.addPage(); y = 14; }
        doc.addImage(b.url, "PNG", M, y, w, h, undefined, "FAST"); y += h + 5;
      } else if (b.tipo === "tabela" && !b.soExcel) {
        doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(43, 44, 120);
        if (y > H - 30) { doc.addPage(); y = 14; }
        doc.text(pdfTxt(b.nome), M, y); y += 2;
        b._dest = st.destExtra ? b.linhas.map(linhaDestacada) : null;
        doc.autoTable({ startY: y, margin: { left: M, right: M, top: 12, bottom: 12 }, theme: "grid",
          head: [b.colunas.map((c) => pdfTxt(c.nome))], body: b.linhas.map((l) => l.map((v, j) => pdfTxt(fmtCel(v, b.colunas[j].tipo)))),
          // pdfCompacto: { coluna: largura em mm } -> a tabela inteira cabe na largura da página (letra menor, textos cortados com "...")
          styles: b.pdfCompacto ? { fontSize: 5.6, cellPadding: 0.8, overflow: "ellipsize", minCellWidth: 6, lineColor: [221, 226, 239], lineWidth: 0.1 }
            : { fontSize: 6.5, cellPadding: 1.2, overflow: "linebreak", minCellWidth: 15, lineColor: [221, 226, 239], lineWidth: 0.1 },
          headStyles: { fillColor: [43, 44, 120], textColor: 255, fontStyle: "bold", fontSize: b.pdfCompacto ? 5.6 : 6.5, overflow: "linebreak" },
          alternateRowStyles: { fillColor: [246, 248, 253] },
          columnStyles: b.pdfCompacto ? Object.fromEntries(Object.entries(b.pdfCompacto).map(([i, w]) => [i, { cellWidth: w }])) : { 0: { cellWidth: 55, fontStyle: "bold" } },
          horizontalPageBreak: !b.pdfCompacto, horizontalPageBreakRepeat: 0,
          didParseCell: (d) => { if (d.section === "body" && d.column.index > 0 && b.colunas[d.column.index]?.tipo !== "txt") d.cell.styles.halign = "right";
            if (d.section === "body" && b._dest?.[d.row.index]) { d.cell.styles.fillColor = [255, 236, 179]; d.cell.styles.fontStyle = "bold"; }
            const v = b.linhas[d.row.index]?.[d.column.index];
            if (d.section === "body" && b.colunas[d.column.index]?.tipo === "pct" && typeof v === "number") d.cell.styles.textColor = v > 0 ? [12, 138, 78] : v < 0 ? [208, 38, 44] : [40, 40, 40]; } });
        y = doc.lastAutoTable.finalY + 6;
      }
    }
    if (p.blocos.some((b) => b.soExcel)) { doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.setTextColor(110);
      if (y > H - 14) { doc.addPage(); y = 14; } doc.text("As séries diárias e as tabelas muito largas desta parte saem completas no Excel.", M, y); }
  }
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(130); doc.text(`Página ${i} de ${n}`, W - M, H - 5, { align: "right" }); }
  prog("salvando…");
  return doc.output("blob");
}

// ---------- PNG (cada parte vira uma imagem; várias vão num .zip)
const LIMITE_LINHAS_PNG = 80;
function htmlParte(p) {
  let h = `<section class="rel-parte"><h2>${esc(p.titulo)}</h2><p class="rel-sub">${esc(cabecalhoRel())}</p>` + (p.nota ? `<p class="rel-sub">${esc(p.nota)}</p>` : "");
  for (const b of p.blocos) {
    if (b.tipo === "img") h += `<img src="${b.url}" style="width:${Math.min(1300, b.w)}px;height:auto" alt="">`;
    else if (b.tipo === "tabela" && !b.soExcel) {
      const lin = b.linhas.slice(0, LIMITE_LINHAS_PNG);
      h += `<h3>${esc(b.nome)}</h3><table><thead><tr>${b.colunas.map((c) => `<th>${esc(c.nome)}</th>`).join("")}</tr></thead><tbody>${lin.map((l) => `<tr${linhaDestacada(l) ? ' class="dest"' : ""}>${l.map((v, j) => {
        const t = b.colunas[j].tipo, cor = t === "pct" && typeof v === "number" ? (v > 0 ? "color:#0c8a4e" : v < 0 ? "color:#d0262c" : "") : "";
        return `<td class="${t === "txt" ? "t" : ""}" style="${cor}">${esc(fmtCel(v, t))}</td>`; }).join("")}</tr>`).join("")}</tbody></table>` +
        (b.linhas.length > LIMITE_LINHAS_PNG ? `<p class="rel-sub">Mostrando ${LIMITE_LINHAS_PNG} de ${b.linhas.length} linhas; a tabela completa sai no Excel.</p>` : "");
    }
  }
  return h + "</section>";
}
async function gerarPNG(partes, prog, umaSo) {
  prog("baixando a biblioteca de imagem…"); await carregarLib("imagem"); if (!umaSo && partes.length > 1) await carregarLib("zip");
  const area = document.createElement("div"); area.className = "rel-render";
  area.innerHTML = partes.map(htmlParte).join("");
  document.body.appendChild(area);
  try {
    await Promise.all($$("img", area).map((im) => (im.complete ? 1 : new Promise((r) => { im.onload = im.onerror = r; }))));
    const capturar = async (el) => (await window.html2canvas(el, { backgroundColor: "#ffffff", scale: 1.5, logging: false, useCORS: true }));
    const blob = (cv) => new Promise((r) => cv.toBlob(r, "image/png"));
    if (umaSo || partes.length === 1) { prog("desenhando a imagem…"); await pausa(); return { blob: await blob(await capturar(area)), ext: "png" }; }
    const zip = new window.JSZip(), secoes = $$(".rel-parte", area);
    for (let i = 0; i < secoes.length; i++) {
      prog(`desenhando ${partes[i].titulo} (${i + 1} de ${secoes.length})…`); await pausa();
      zip.file(`${String(i + 1).padStart(2, "0")} ${nomeArquivo(partes[i].titulo)}.png`, await blob(await capturar(secoes[i])));
    }
    prog("compactando…");
    return { blob: await zip.generateAsync({ type: "blob" }), ext: "zip" };
  } finally { area.remove(); }
}
const nomeArquivo = (s) => pdfTxt(s).replace(/[\\/:*?"<>|·]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

// ---------- Excel (uma aba por tabela, com formatos, filtro e cabeçalho fixo; gráficos numa aba própria)
async function gerarExcel(partes, prog, comImagens) {
  prog("baixando a biblioteca do Excel…"); await carregarLib("excel");
  const wb = new window.ExcelJS.Workbook(); wb.creator = "Análise de Fundos"; wb.created = new Date();
  const usados = new Set(), nomeAba = (s) => {
    let base = pdfTxt(s).replace(/[\\/:*?\[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 28) || "Aba", n = base, k = 2;
    while (usados.has(n.toLowerCase())) n = `${base.slice(0, 26)} ${k++}`;
    usados.add(n.toLowerCase()); return n;
  };
  const FMT = { pct: "0.00%", pct6: "0.0000%", data: "dd/mm/yyyy", int: "0", num2: "0.00", num: "0.0000", valor: "#,##0.00", cota: "0.00000000" };
  // capa com o índice das abas
  const capa = wb.addWorksheet(nomeAba("Sobre"));
  capa.addRow(["Análise de Fundos"]).font = { bold: true, size: 16, color: { argb: "FF2B2C78" } };
  capa.addRow([cabecalhoRel()]); capa.addRow([]);
  capa.addRow(["Aba", "Conteúdo"]).font = { bold: true };
  capa.getColumn(1).width = 34; capa.getColumn(2).width = 90;
  for (let i = 0; i < partes.length; i++) {
    const p = partes[i]; prog(`montando o Excel: ${p.titulo} (${i + 1} de ${partes.length})…`); await pausa();
    for (const b of p.blocos.filter((x) => x.tipo === "tabela")) {
      const ws = wb.addWorksheet(nomeAba(b.aba || b.nome), { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
      capa.addRow([ws.name, p.titulo + (b.nota ? " · " + b.nota : "")]);
      ws.columns = b.colunas.map((c, j) => ({ header: c.nome, width: j === 0 ? 44 : Math.min(24, Math.max(12, c.nome.length + 2)), style: FMT[c.tipo] ? { numFmt: FMT[c.tipo] } : {} }));
      const cab = ws.getRow(1); cab.font = { bold: true, color: { argb: "FFFFFFFF" } }; cab.alignment = { vertical: "middle", wrapText: true }; cab.height = 32;
      cab.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2B2C78" } }; });
      const marcar = st.destExtra && !b.bruto;
      for (let r = 0; r < b.linhas.length; r++) {
        const row = ws.addRow(b.linhas[r].map((v, j) => (v == null ? null : b.colunas[j].tipo === "data" && typeof v === "number" ? dataJs(v) : v)));
        if (marcar && linhaDestacada(b.linhas[r])) { row.font = { bold: true }; row.eachCell({ includeEmpty: true }, (c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFECB3" } }; }); }
        if (r % 4000 === 3999) await pausa();
      }
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: b.colunas.length } };
    }
  }
  if (comImagens) {
    const imgs = partes.flatMap((p) => p.blocos.filter((b) => b.tipo === "img").map((b) => ({ ...b, parte: p.titulo })));
    if (imgs.length) {
      prog("colocando os gráficos…"); await pausa();
      const ws = wb.addWorksheet(nomeAba("Gráficos")); capa.addRow([ws.name, "Imagens dos gráficos"]);
      let linha = 1;
      for (const im of imgs) {
        ws.getCell(linha, 1).value = im.parte; ws.getCell(linha, 1).font = { bold: true, size: 13, color: { argb: "FF2B2C78" } };
        const largura = Math.min(1100, im.w), altura = largura * im.h / im.w;
        ws.addImage(wb.addImage({ base64: im.url, extension: "png" }), { tl: { col: 0, row: linha }, ext: { width: largura, height: altura } });
        linha += Math.ceil(altura / 20) + 3;
      }
    }
  }
  prog("salvando…"); await pausa();
  return new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// ---------- CSV (dados grandes demais para o Excel): ponto e vírgula, vírgula decimal, datas dd/mm/aaaa
const NF_CSV = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 10, useGrouping: false });
async function csvDeTabela(b) {
  const q = (s) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const cel = (v, t) => (v == null || v === "" ? "" : typeof v !== "number" ? q(String(v)) : t === "data" ? fmtData(v) : NF_CSV.format(v));
  const partes = ["\ufeff" + b.colunas.map((c) => q(c.nome + (c.tipo === "pct" || c.tipo === "pct6" ? " (decimal)" : ""))).join(";") + "\r\n"];
  for (let i = 0; i < b.linhas.length; i += 20000) {
    partes.push(b.linhas.slice(i, i + 20000).map((l) => l.map((v, j) => cel(v, b.colunas[j].tipo)).join(";")).join("\r\n") + "\r\n");
    await pausa();
  }
  return new Blob(partes, { type: "text/csv;charset=utf-8" });
}

// ---------- gerar e baixar
async function baixarRelatorio() {
  const escolhidas = SECOES_REL.filter((s) => disponivel(s) && rel.sel.has(s.k));
  if (!escolhidas.length) return;
  const btn = $("#relBaixar"), prog = (t) => { $("#relProg").textContent = t; };
  btn.disabled = true;
  const destTela = st.destaque, comDest = rel.dest.size > 0;
  // seções minimizadas são abertas durante a geração (senão os gráficos delas sairiam vazios)
  const minimizadas = $$(".cartao.min");
  try {
    prog("preparando…"); await pausa();
    if (minimizadas.length) { minimizadas.forEach((s) => s.classList.remove("min")); Object.values(st.graficos).forEach((g) => g?.resize()); await pausa(); }
    if (comDest) {                       // o relatório usa os fundos escolhidos na janela (o texto do topo fica de lado)
      st.destaque = ""; st.destExtra = conjuntoDestaque(rel.dest);
      prog("aplicando o destaque nos gráficos…"); renderResultado(); if (st.rk) renderRankings(); await pausa();
    }
    const partes = escolhidas.map((s) => blocosRel(s.k)).filter(Boolean);
    // proteção contra arquivos enormes (o navegador pode travar)
    const tabs = partes.flatMap((p) => p.blocos.filter((b) => b.tipo === "tabela"));
    const celulas = tabs.filter((b) => !b.bruto || b.linhas.length * b.colunas.length <= 3e6).reduce((s, b) => s + b.linhas.length * b.colunas.length, 0);
    const celPdf = tabs.filter((b) => !b.soExcel).reduce((s, b) => s + b.linhas.length * b.colunas.length, 0);
    if (rel.fmt === "xlsx" && celulas > 12e6) throw new Error(`o Excel teria ${br(celulas / 1e6, 1)} milhões de células, mais do que o navegador consegue montar. Escolha menos partes ou um período mais curto.`);
    if (rel.fmt === "xlsx" && celulas > 2.5e6 && !(await perguntar("Arquivo grande", `O Excel terá cerca de <b>${br(celulas / 1e6, 1)} milhões</b> de células. Pode levar alguns minutos e usar bastante memória. Continuar?`,
      [{ rot: "Cancelar", v: false }, { rot: "Continuar", v: true, classe: "prim" }]))) { prog(""); return; }
    if (rel.fmt === "pdf" && celPdf > 150000 && !(await perguntar("PDF grande", `As tabelas somam cerca de ${br(celPdf / 1000, 0)} mil células (centenas de páginas). Continuar?`,
      [{ rot: "Cancelar", v: false }, { rot: "Continuar", v: true, classe: "prim" }]))) { prog(""); return; }
    let blob, ext = rel.fmt;
    if (rel.fmt === "xlsx") {
      // dados usados nos cálculos: se não couberem bem no Excel, vão em CSV dentro de um .zip junto com o Excel
      const brutos = tabs.filter((b) => b.bruto), linBrutas = brutos.reduce((s2, b) => s2 + b.linhas.length, 0);
      if (linBrutas > 8e6) throw new Error(`os dados brutos teriam ${br(linBrutas / 1e6, 1)} milhões de linhas, mais do que o navegador consegue montar. Escolha um período mais curto ou menos fundos.`);
      const grandes = brutos.filter((b) => b.linhas.length > 1e6 || b.linhas.length * b.colunas.length > 3e6);
      if (grandes.length) {
        const nLin = grandes.reduce((s2, b) => s2 + b.linhas.length, 0), passa = grandes.some((b) => b.linhas.length > 1048575);
        if (!(await perguntar("Dados grandes demais para o Excel", `Os dados de <b>${grandes.map((b) => esc(b.nome.replace("Dados - ", ""))).join(", ")}</b> têm ${br(nLin, 0)} linhas` +
            (passa ? " (o Excel aceita até 1.048.576 por aba)" : ", volume que o navegador demoraria muito para montar como Excel") +
            `. Vou gerar um <b>.zip</b> com o Excel do relatório e esses dados em <b>CSV</b> (ponto e vírgula, vírgula decimal), que também abre no Excel.`,
          [{ rot: "Cancelar", v: false }, { rot: "Gerar .zip", v: true, classe: "prim" }]))) { prog(""); return; }
        await carregarLib("zip");
        for (const p of partes) p.blocos = p.blocos.map((b) => (grandes.includes(b) ? { ...b, foraDoExcel: true } : b));
        const zip = new window.JSZip(), restantes = partes.map((p) => ({ ...p, blocos: p.blocos.filter((b) => !b.foraDoExcel) })).filter((p) => p.blocos.length);
        if (restantes.length) zip.file("relatorio_fundos.xlsx", await gerarExcel(restantes, prog, rel.xlsImg));
        for (const b of grandes) { prog(`escrevendo ${b.nome} em CSV (${br(b.linhas.length, 0)} linhas)…`); zip.file(`${nomeArquivo(b.nome)}.csv`, await csvDeTabela(b)); }
        prog("compactando…");
        blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 3 } }, (m) => prog(`compactando… ${Math.round(m.percent)}%`));
        ext = "zip";
      } else blob = await gerarExcel(partes, prog, rel.xlsImg);
    }
    else if (rel.fmt === "pdf") blob = await gerarPDF(partes.filter((p) => p.blocos.some((b) => !b.bruto)), prog);
    else ({ blob, ext } = await gerarPNG(partes.filter((p) => p.blocos.some((b) => !b.bruto)), prog, rel.pngUm));
    const a = document.createElement("a"), hoje = new Date().toISOString().slice(0, 10);
    a.href = URL.createObjectURL(blob); a.download = `relatorio_fundos_${hoje}.${ext}`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    prog(`pronto: arquivo de ${br(blob.size / 1024 / 1024, 1)} MB baixado.`);
  } catch (e) {
    console.error(e); prog("erro: " + (e?.message || e));
  } finally {
    btn.disabled = false;
    if (comDest) { st.destExtra = null; st.destaque = destTela; renderResultado(); if (st.rk) renderRankings(); }
    if (minimizadas.length) aplicarMinimizados();
  }
}

document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.id === "btnRel" || t.id === "btnRelRk") return abrirRelatorio();
  const f = t.closest?.("#relFmt button"); if (f) { rel.fmt = f.dataset.f; salvar("relFmt", rel.fmt); return desenharFormatoRel(); }
  if (t.id === "relTudo" || t.id === "relNada") {
    $$("#relSecoes input[data-rel]:not(:disabled)").forEach((i) => { const sec = SECOES_REL.find((s) => s.k === i.dataset.rel);
      const marca = t.id === "relTudo" && !sec.bruto;          // "marcar tudo" não inclui os dados brutos (podem ser grandes)
      i.checked = marca; marca ? rel.sel.add(i.dataset.rel) : rel.sel.delete(i.dataset.rel); });
    salvar("relSel", [...rel.sel]); return desenharFormatoRel();
  }
  if (t.id === "relBaixar") return baixarRelatorio();
  const gb = t.closest?.("[data-rel-g]");
  if (gb) {
    const marca = gb.dataset.marca === "1";
    for (const sec of SECOES_REL.filter((x) => x.g === gb.dataset.relG && disponivel(x))) marca ? rel.sel.add(sec.k) : rel.sel.delete(sec.k);
    salvar("relSel", [...rel.sel]); return desenharFormatoRel();
  }
  const ld = t.closest?.("#relDestTab tr.linha-f");
  if (ld) { const c = ld.dataset.dest; rel.dest.has(c) ? rel.dest.delete(c) : rel.dest.add(c); return renderDestRel(); }
  const bo = t.closest?.("#relDestTab button.ord-f");
  if (bo) return renderDestRel();          // a ordenação em si é tratada no módulo de seleção
  if (t.id === "relDestLimpar") { rel.dest.clear(); return renderDestRel(); }
  if (t.id === "relDestTela") {
    rel.dest.clear();
    if (st.destaque.trim()) for (const c of st.res.sel) if (casa(st.destaque, st.porCnpj.get(c)?.NOME, cnpjFmt(c), st.res.apelidos[c])) rel.dest.add(c);
    return renderDestRel();
  }
});
document.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("#relDestTab tr.linha-f")) { e.preventDefault(); e.target.click(); }
});
document.addEventListener("input", (e) => { if (e.target.id === "relDestBusca") renderDestRel(); });
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.dataset?.rel) { t.checked ? rel.sel.add(t.dataset.rel) : rel.sel.delete(t.dataset.rel); salvar("relSel", [...rel.sel]); desenharFormatoRel(); }
  else if (t.name === "relPng") rel.pngUm = t.value === "um";
  else if (t.id === "relXlsImg") rel.xlsImg = t.checked;
  else if (t.id === "relDestSo") renderDestRel();
});

// ============================== zoom de arrastar dentro dos gráficos ==============================
// Arraste na diagonal = zoom nos dois eixos; na horizontal = só no eixo X; na vertical = só no eixo Y.
// Os zooms se acumulam; "Voltar" desfaz um passo e o clique duplo (ou "Ver tudo") volta ao início.
st.zoomG = {};                                   // id do gráfico -> pilha de { x: [min, max] | null, y: [min, max] | null }
const ZOOM_MIN = 10;                             // px: abaixo disso, o movimento conta como só horizontal ou só vertical

function aplicarZoomG(ch, id) {
  const z = st.zoomG[id]?.at(-1), b = ch.$base || { x: [undefined, undefined], y: [undefined, undefined] };
  const sx = ch.options.scales.x, sy = ch.options.scales.y;
  [sx.min, sx.max] = z?.x || b.x;
  [sy.min, sy.max] = z?.y || b.y;
  sy.ticks.includeBounds = !z?.y;                 // com zoom, não escreve o valor exato do limite (evita números sobrepostos)
  if (ch.config.type === "scatter") sx.ticks.includeBounds = !z?.x;
  barraZoom(id);
}
function posCriar(id, base) {
  const ch = st.graficos[id]; if (!ch) return;
  ch.$base = base;
  ativarZoom(id);
  if (st.zoomG[id]?.length) { aplicarZoomG(ch, id); ch.update("none"); } else barraZoom(id);
}
function limparZoom(...ids) { for (const id of ids) { delete st.zoomG[id]; const ch = st.graficos[id]; if (ch?.$base) { aplicarZoomG(ch, id); ch.update("none"); } } }
function voltarZoom(id, tudo) {
  const pilha = st.zoomG[id]; if (!pilha?.length) return;
  if (tudo) pilha.length = 0; else pilha.pop();
  const ch = st.graficos[id]; aplicarZoomG(ch, id); ch.update("none");
}

// botões "Voltar" e "Ver tudo" no canto do gráfico (aparecem só com zoom)
function barraZoom(id) {
  const cv = $("#" + id), caixa = cv?.parentElement; if (!caixa) return;
  let barra = $(".zoom-bar", caixa);
  if (!barra) {
    caixa.insertAdjacentHTML("beforeend", `<div class="zoom-bar" data-zoom-de="${id}"><span class="zoom-dica">arraste para dar zoom · clique duplo volta</span>
      <button type="button" class="zoom-voltar" title="Desfaz o último zoom">↶ Voltar</button><button type="button" class="zoom-tudo" title="Volta ao gráfico inteiro (ou clique duplo no gráfico)">⤢ Ver tudo</button></div>`);
    barra = $(".zoom-bar", caixa);
  }
  const n = st.zoomG[id]?.length || 0;
  barra.classList.toggle("com-zoom", n > 0);
  $(".zoom-voltar", barra).textContent = n > 1 ? `↶ Voltar (${n})` : "↶ Voltar";
}

// seleção desenhada por cima do gráfico durante o arraste
function desenharSelecao(caixa, area, r, modo) {
  let el = $(".zoom-sel", caixa);
  if (!el) { caixa.insertAdjacentHTML("beforeend", `<svg class="zoom-sel" aria-hidden="true"></svg>`); el = $(".zoom-sel", caixa); }
  if (!r) { el.style.display = "none"; return; }
  const { left: L, top: T, right: R, bottom: B } = area, sombra = escuro() ? "rgba(0,0,0,.45)" : "rgba(20,26,74,.22)";
  const { x0, y0, x1, y1 } = r, cor = escuro() ? "#ffffff" : ANIL, w = 2;
  let marcas = "";
  if (modo === "xy") {
    const k = Math.min(12, (x1 - x0) / 3, (y1 - y0) / 3);
    marcas = [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]
      .map(([x, y, sx, sy]) => `<path d="M${x + sx * k},${y} L${x},${y} L${x},${y + sy * k}"/>`).join("");
  } else if (modo === "x") {
    const m = (y0 + y1) / 2, h = Math.min(24, (y1 - y0) / 4);
    marcas = `<path d="M${x0},${m - h} L${x0},${m + h} M${x1},${m - h} L${x1},${m + h}"/>`;
  } else {
    const m = (x0 + x1) / 2, h = Math.min(24, (x1 - x0) / 4);
    marcas = `<path d="M${m - h},${y0} L${m + h},${y0} M${m - h},${y1} L${m + h},${y1}"/>`;
  }
  el.style.display = "block";
  el.innerHTML = `<path fill="${sombra}" fill-rule="evenodd" d="M${L},${T} H${R} V${B} H${L} Z M${x0},${y0} V${y1} H${x1} V${y0} Z"/>` +
    `<g fill="none" stroke="${cor}" stroke-width="${w}" stroke-linecap="square">${marcas}</g>`;
}

function ativarZoom(id) {
  const cv = $("#" + id); if (!cv || cv.dataset.zoom) return;
  cv.dataset.zoom = "1";
  const caixa = cv.parentElement;
  let ini = null, modo = null, ret = null;
  // posição do canvas dentro da caixa (a seleção é desenhada em coordenadas da caixa)
  const off = () => ({ x: cv.offsetLeft, y: cv.offsetTop });
  const areaCaixa = (ch) => { const o = off(), a = ch.chartArea; return { left: a.left + o.x, top: a.top + o.y, right: a.right + o.x, bottom: a.bottom + o.y }; };
  cv.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;          // no celular, arrastar continua rolando a página
    const ch = st.graficos[id]; if (!ch) return;
    const b = cv.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top, a = ch.chartArea;
    if (x < a.left || x > a.right || y < a.top || y > a.bottom) return;
    ini = { x, y }; modo = null; ret = null;
    ch.$tt = ch.options.plugins.tooltip.enabled; ch.options.plugins.tooltip.enabled = false;   // sem a caixinha de valores durante o arraste
    cv.setPointerCapture(e.pointerId); e.preventDefault();
  });
  cv.addEventListener("pointermove", (e) => {
    if (!ini) return;
    const ch = st.graficos[id]; if (!ch) return;
    const b = cv.getBoundingClientRect(), a = ch.chartArea;
    const x = Math.min(a.right, Math.max(a.left, e.clientX - b.left)), y = Math.min(a.bottom, Math.max(a.top, e.clientY - b.top));
    const dx = Math.abs(x - ini.x), dy = Math.abs(y - ini.y);
    if (dx < 3 && dy < 3) return;
    modo = dy < ZOOM_MIN && dx >= ZOOM_MIN ? "x" : dx < ZOOM_MIN && dy >= ZOOM_MIN ? "y" : dx >= ZOOM_MIN && dy >= ZOOM_MIN ? "xy" : null;
    const o = off();
    ret = modo === "x" ? { x0: Math.min(x, ini.x), x1: Math.max(x, ini.x), y0: a.top, y1: a.bottom }
      : modo === "y" ? { x0: a.left, x1: a.right, y0: Math.min(y, ini.y), y1: Math.max(y, ini.y) }
      : modo === "xy" ? { x0: Math.min(x, ini.x), x1: Math.max(x, ini.x), y0: Math.min(y, ini.y), y1: Math.max(y, ini.y) } : null;
    ch.tooltip?.setActiveElements([], { x: 0, y: 0 }); ch.draw();
    desenharSelecao(caixa, areaCaixa(ch), ret && { x0: ret.x0 + o.x, x1: ret.x1 + o.x, y0: ret.y0 + o.y, y1: ret.y1 + o.y }, modo);
  });
  const terminar = () => {
    if (!ini) return;
    const ch = st.graficos[id], r = ret, m = modo;
    ini = null; ret = null; modo = null;
    desenharSelecao(caixa, null, null);
    if (ch) ch.options.plugins.tooltip.enabled = ch.$tt ?? true;
    if (!ch || !r || !m) return;
    const sx = ch.scales.x, sy = ch.scales.y, topo = st.zoomG[id]?.at(-1);
    const novo = {
      x: m === "y" ? (topo?.x || null) : [sx.getValueForPixel(r.x0), sx.getValueForPixel(r.x1)],
      y: m === "x" ? (topo?.y || null) : [sy.getValueForPixel(r.y1), sy.getValueForPixel(r.y0)],
    };
    (st.zoomG[id] ||= []).push(novo);
    aplicarZoomG(ch, id); ch.update("none");
  };
  cv.addEventListener("pointerup", terminar);
  cv.addEventListener("pointercancel", () => { ini = null; desenharSelecao(caixa, null, null); const ch = st.graficos[id]; if (ch) ch.options.plugins.tooltip.enabled = ch.$tt ?? true; });
  cv.addEventListener("dblclick", () => voltarZoom(id, true));
  cv.title = "Arraste para dar zoom (na diagonal, na horizontal ou na vertical). Clique duplo volta ao gráfico inteiro.";
}
document.addEventListener("click", (e) => {
  const b = e.target.closest?.(".zoom-bar button"); if (!b) return;
  voltarZoom(b.closest(".zoom-bar").dataset.zoomDe, b.classList.contains("zoom-tudo"));
});

const semZoom = (...ids) => { for (const id of ids) delete st.zoomG[id]; };
// ============================== rankings ==============================
// Um ranking = nome + tipo de cálculo (pesos) + lista de fundos. Ficam guardados neste navegador, como os grupos.
const lerRankings = () => pref("rankings", {});
const gravarRankings = (r) => salvar("rankings", r);
const rkSel = new Set(pref("rankingsSel", []));
const salvarRkSel = () => salvar("rankingsSel", [...rkSel]);
const rkEd = { aberto: false, nomeOrig: null, modelo: "MM", cnpjs: [] };
const TOP_RANK = 10;

function resumoLateralRk() {
  const n = Object.keys(lerRankings()).length, m = [...rkSel].filter((x) => lerRankings()[x]).length;
  $("#rkResumoLat").textContent = n ? `${n} ranking(s) salvo(s) · ${m} marcado(s) para calcular` : "Nenhum ranking montado ainda.";
}
function abrirRank() { rkEd.aberto = false; renderRkLista(); $("#rkListaBox").hidden = false; $("#rkEditor").hidden = true; $("#dlgRank").showModal(); }
function renderRkLista() {
  const g = lerRankings(), nomes = Object.keys(g).sort((a, b) => a.localeCompare(b, "pt-BR"));
  for (const n of [...rkSel]) if (!g[n]) rkSel.delete(n);
  $("#rkLista").innerHTML = !nomes.length ? `<p class="nota">Nenhum ranking ainda. Clique em "＋ Novo ranking", dê um nome, escolha o tipo de cálculo e os fundos.</p>` :
    `<table class="tb gr-tab"><thead><tr><th></th><th class="t">Ranking</th><th class="t">Tipo de cálculo</th><th>Fundos</th><th>Atualizado em</th><th></th></tr></thead><tbody>${nomes.map((n) => {
      const x = g[n], M = MODELOS_RANK[x.modelo] || {};
      return `<tr class="linha-f${rkSel.has(n) ? " marcado" : ""}" data-rk="${esc(n)}" title="Clique para marcar ou desmarcar"><td><label class="tog"><input type="checkbox" data-rk-sel="${esc(n)}" ${rkSel.has(n) ? "checked" : ""}></label></td>
        <td class="t"><b>${esc(n)}</b></td><td class="t">${esc(M.nome || x.modelo)} <small class="nota">· ${esc(M.periodo || "")} · janela ${M.jmMeses || "?"}m vs ${esc(M.bench || "")}</small></td>
        <td>${x.cnpjs.length}</td><td>${x.atualizado ? new Date(x.atualizado).toLocaleDateString("pt-BR") : ""}</td>
        <td class="gr-acoes"><button class="sec mini-btn" data-rk-ed="${esc(n)}" type="button">Editar</button>
          <button class="cart-rm" data-rk-del="${esc(n)}" type="button" title="Excluir ranking">🗑</button></td></tr>`; }).join("")}</tbody></table>`;
  const m = [...rkSel].length;
  $("#rkCalcular").disabled = !m;
  $("#rkCalcular").textContent = `🏆 Calcular ${m || ""} ranking${m === 1 ? "" : "s"}`.replace("  ", " ");
  const fundos = new Set([...rkSel].flatMap((n) => g[n]?.cnpjs || []));
  $("#rkResumo").textContent = m ? `${m} ranking(s) marcado(s) · ${fundos.size} fundo(s) diferentes para carregar` : "Marque pelo menos um ranking.";
  salvarRkSel(); resumoLateralRk();
}

// ---------- editor de um ranking (nome, tipo de cálculo e fundos)
function abrirEditorRk(nome = null) {
  const x = nome ? lerRankings()[nome] : null;
  Object.assign(rkEd, { aberto: true, nomeOrig: nome, modelo: x?.modelo || "MM", cnpjs: [...(x?.cnpjs || [])] });
  $("#rkNome").value = nome || "";
  $("#rkModelo").innerHTML = Object.entries(MODELOS_RANK).map(([k, M]) => `<option value="${k}"${k === rkEd.modelo ? " selected" : ""}>${esc(M.nome)}</option>`).join("");
  const grupos = Object.keys(lerGrupos()).sort((a, b) => a.localeCompare(b, "pt-BR"));
  $("#rkEdGrupo").innerHTML = `<option value="">★ Carregar de um grupo…</option>` + grupos.map((n) => `<option value="${esc(n)}">${esc(n)} (${lerGrupos()[n].cnpjs.length})</option>`).join("");
  $("#rkEdGrupo").hidden = !grupos.length;
  $("#rkListaBox").hidden = true; $("#rkEditor").hidden = false;
  renderEditorRk(); $("#rkNome").focus();
}
function renderEditorRk() {
  const M = MODELOS_RANK[rkEd.modelo], fmtP = (k) => `${metricaRank(k).nome} ${Math.abs(M.pesos[k])}%${M.pesos[k] < 0 ? " (menor é melhor)" : ""}`;
  $("#rkModeloInfo").innerHTML = `<b>${esc(M.nome)}</b>: métricas dos últimos ${esc(M.periodo.toLowerCase())}; janela móvel de ${M.jmMeses} meses contra o ${esc(nomeIndice(M.bench))}, ` +
    `aplicações dos últimos ${JM_ANOS} anos. Pesos: ${Object.keys(M.pesos).map(fmtP).join(" · ")}.`;
  $("#rkEdSel").textContent = `Usar os fundos selecionados (${st.sel.length})`; $("#rkEdSel").disabled = !st.sel.length;
  const lista = ordenarFundos(rkEd.cnpjs.map((c) => st.porCnpj.get(c)).filter(Boolean), "rkEd");
  const fora = rkEd.cnpjs.filter((c) => !st.porCnpj.has(c));
  $("#rkEdInfo").innerHTML = `<b>${rkEd.cnpjs.length}</b> fundo(s) no ranking` + (fora.length ? ` · <span class="neg">${fora.length} fora da base atual: ${fora.map(cnpjFmt).join(", ")}</span>` : "");
  $("#rkEdFundos").innerHTML = lista.length ? `<table class="tb tab-fundos">${cabFundos("rkEd", false, "", "x")}<tbody>${lista.map((f) =>
    `<tr>${COLS_FUNDO.map((c) => celFundo(f, c)).join("")}<td><button class="cart-rm" data-rk-edrm="${f.CNPJ}" type="button" title="Tirar do ranking">×</button></td></tr>`).join("")}</tbody></table>`
    : `<p class="nota" style="padding:10px">Nenhum fundo ainda. Use os botões acima para escolher na lista, colar CNPJs, carregar um grupo ou usar os selecionados.</p>`;
}
async function juntarNoEditor(cnpjs, substituir) {
  if (substituir === undefined && rkEd.cnpjs.length) {
    substituir = await perguntar("Juntar ou substituir?", `O ranking já tem ${rkEd.cnpjs.length} fundo(s). Os ${cnpjs.length} novos entram junto ou no lugar deles?`,
      [{ rot: "Cancelar", v: null }, { rot: "＋ Juntar", v: false }, { rot: "Substituir", v: true, classe: "prim" }]);
    if (substituir == null) return;
  }
  rkEd.cnpjs = substituir ? [...new Set(cnpjs)] : [...new Set([...rkEd.cnpjs, ...cnpjs])];
  renderEditorRk();
}
async function salvarEditorRk() {
  const nome = $("#rkNome").value.trim(), g = lerRankings();
  if (!nome) { $("#rkNome").focus(); return; }
  if (rkEd.cnpjs.length < 2) { await perguntar("Poucos fundos", "Um ranking precisa de pelo menos 2 fundos.", [{ rot: "OK", v: 1, classe: "prim" }]); return; }
  if (g[nome] && nome !== rkEd.nomeOrig && !(await perguntar("Substituir o ranking?", `Já existe o ranking <b>${esc(nome)}</b> com ${g[nome].cnpjs.length} fundo(s). Substituir?`,
    [{ rot: "Cancelar", v: false }, { rot: "Substituir", v: true, classe: "prim" }]))) return;
  if (rkEd.nomeOrig && rkEd.nomeOrig !== nome) { delete g[rkEd.nomeOrig]; if (rkSel.delete(rkEd.nomeOrig)) rkSel.add(nome); }
  g[nome] = { modelo: rkEd.modelo, cnpjs: [...rkEd.cnpjs], atualizado: new Date().toISOString() };
  gravarRankings(g); rkSel.add(nome);
  rkEd.aberto = false; $("#rkEditor").hidden = true; $("#rkListaBox").hidden = false; renderRkLista();
}

// ---------- cálculo
// Para cada fundo: as métricas do período do tipo de cálculo (o mesmo cálculo da tabela de métricas), a realização do objetivo
// de retorno e a consistência na janela móvel; depois a pontuação relativa. A posição do mês anterior vem do mesmo cálculo
// feito com a data final 1 mês antes (para a coluna "Var. mês").
function rodarRanking(M, itens, fim, detalhe) {
  const peso = Number($("#peso").value) / 100, iniJM = somarMeses(fim, -12 * JM_ANOS), meses = parseInt(M.periodo, 10);
  const inicioPer = somarMeses(fim, -meses), linhas = [], fora = [];
  for (const { c, f, cad } of itens) {
    if (!f || !f.d.length) { fora.push({ c, motivo: "sem cotas na base" }); continue; }
    if (f.d[0] > fim) { fora.push({ c, motivo: "ainda não existia nessa data" }); continue; }
    const ult = f.d[upperBound(f.d, fim) - 1];
    if (fim - ult > 10) { fora.push({ c, motivo: `sem cota desde ${fmtData(ult)}` }); continue; }
    const r = calcularFundo(f, st.idx.ibov, M.periodo, peso, { fimComum: fim });
    if (!r) { fora.push({ c, motivo: "sem dados no período" }); continue; }
    const kObj = indiceObjetivo(cad.INDICADOR_DESEMPENHO);
    let obj = null;
    if (kObj && typeof r["% Anualizado"] === "number") { const rv = retornoVol(st.idx, kObj, r["Data Inicial"], r["Data Final"]); if (rv) obj = r["% Anualizado"] - rv.ret; }
    const jm = janelaMovel(f, st.idx, { bench: M.bench, meses: M.jmMeses, ini: iniJM, fim });
    const rs = jm.length ? resumoJanela(jm) : null;
    const v = {};
    for (const k of Object.keys(M.pesos)) v[k] = k === "_objetivo" ? obj : k === "_jmPos" ? rs?.pPositivas ?? null : k === "_jmBench" ? rs?.pAcima ?? null
      : typeof r[k] === "number" && Number.isFinite(r[k]) ? r[k] : null;
    linhas.push({ c, cad, r, obj, kObj, v, rs, jm: detalhe ? jm : null, curto: r["Data Inicial"] - inicioPer > 31 });
  }
  const porId = new Map(linhas.map((l) => [l.c, l]));
  const ordem = ordenarRanking(pontuar(linhas.map((l) => ({ id: l.c, v: l.v })), M.pesos), (id) => porId.get(id).r["% Acumulado"])
    .map((p, i) => ({ ...p, pos: i + 1, l: porId.get(p.id) }));
  return { ordem, fora };
}
function montarRanking(nome, def, fundos) {
  const M = MODELOS_RANK[def.modelo] || MODELOS_RANK.MM;
  const itens = def.cnpjs.filter((c) => st.porCnpj.has(c)).map((c) => ({ c, f: fundos.get(c), cad: st.porCnpj.get(c) }));
  let fim = -Infinity;
  for (const { f } of itens) if (f?.d.length) fim = Math.max(fim, f.d[f.d.length - 1]);
  if (!Number.isFinite(fim)) return { nome, M, modelo: def.modelo, fim: null, ordem: [], fora: itens.map(({ c }) => ({ c, motivo: "sem cotas na base" })), apel: {} };
  const atual = rodarRanking(M, itens, fim, true), antes = rodarRanking(M, itens, somarMeses(fim, -1), false);
  const posAnt = new Map(antes.ordem.map((x) => [x.id, x.pos]));
  for (const x of atual.ordem) x.var = posAnt.has(x.id) ? posAnt.get(x.id) - x.pos : null;
  return { nome, M, modelo: def.modelo, fim, fimAnt: somarMeses(fim, -1), iniJM: somarMeses(fim, -12 * JM_ANOS), ...atual,
    apel: apelidos(atual.ordem.map((x) => x.id)), foraDaBase: def.cnpjs.filter((c) => !st.porCnpj.has(c)) };
}
async function calcularRankings() {
  const todos = lerRankings(), nomes = [...rkSel].filter((n) => todos[n]).sort((a, b) => a.localeCompare(b, "pt-BR"));
  if (!nomes.length) return;
  const cnpjs = [...new Set(nomes.flatMap((n) => todos[n].cnpjs))].filter((c) => st.porCnpj.has(c));
  $("#dlgRank").close();
  abrirCarga(cnpjs); $("#cargaTit").textContent = `Rankings: carregando ${cnpjs.length} fundo(s)`;
  try {
    const fundos = await D.carregarFundos(cnpjs, st.idx.cdiAnterior, (feitos, total, ev) => atualizarCarga(feitos, total, ev));
    const lista = [];
    for (let i = 0; i < nomes.length; i++) {
      faseCarga(`calculando o ranking ${nomes[i]} (${i + 1} de ${nomes.length})…`, 90 + 8 * i / nomes.length); await pausa();
      lista.push(montarRanking(nomes[i], todos[nomes[i]], fundos));
    }
    st.rk = { lista, fundos, ativo: 0 }; semZoom("gRkJM");
    faseCarga("montando as tabelas…", 99); await pausa();
    renderRankings(); fecharCarga(); atualizarEspaco();
    $("#secRank").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { console.error(e); fecharCarga(e.message); }
}

// ---------- exibição
const rkAtivo = () => st.rk?.lista[st.rk.ativo];
const nomeRk = (R, c) => R.apel[c] || curto(st.porCnpj.get(c)?.NOME || c);
const coresRk = (R) => Object.fromEntries(R.ordem.map((x, i) => [x.id, PALETA[i % PALETA.length]]));
const usaIbov = (R) => R.M.bench === "IBOV";
function renderRankings() {
  if (!st.rk?.lista.length) { $("#secRank").hidden = true; return; }
  $("#secRank").hidden = false; $("#vazio").hidden = true;
  if (st.rk.ativo >= st.rk.lista.length) st.rk.ativo = 0;
  $("#rkPills").innerHTML = st.rk.lista.map((R, i) => `<button data-rk-pill="${i}" aria-pressed="${i === st.rk.ativo}">${esc(R.nome)}</button>`).join("");
  aplicarMinimizados();
  renderRkTabela(); renderRkPontos(); renderRkJM(); renderRkCorr(); renderRkPesos();
}
function linhaRk(R, x) {
  const r = x.l.r, cad = x.l.cad;
  return { _c: x.id, pos: x.pos, var: x.var, Fundo: cad.NOME, CNPJ: cnpjFmt(x.id), cvm: cad.CLASSIFICACAO_CVM || "", anbima: cad.CLASSIFICACAO_ANBIMA || "",
    pl: cad.VL_PATRIM_LIQ ?? null, rentAA: r["% Anualizado"], capt: r["Captação Líquida no Período"], pctCDI: r["%CDI"], cdiMais: r["CDI +"],
    obj: x.l.obj, objIdx: x.l.kObj, dias: usaIbov(R) ? r["% de dias acima do IBOV"] : r["% de dias acima do CDI"], beta: r.Beta, vol: r.Volatilidade,
    sharpe: r["Sharpe Anualizado"], mdd: r.Queda, recup: r["Duração da Recuperação"], total: x.total, perf: x.grupos.Performance, cons: x.grupos["Consistência"],
    risco: x.grupos.Risco, curto: x.l.curto, ini: r["Data Inicial"] };
}
const varHTML = (v) => (v == null ? `<span class="rk-novo" title="Não estava no ranking do mês anterior">novo</span>` : v > 0 ? `<span class="rk-sobe">▲ ${v}</span>`
  : v < 0 ? `<span class="rk-desce">▼ ${-v}</span>` : `<span class="rk-igual">▬ 0</span>`);
function colunasRk(R) {
  const mi = (v) => (typeof v === "number" ? br(v / 1e6, 1) : "");
  return [
    { chave: "pos", nome: "Pos.", tipo: "int", g: "Ranking" }, { chave: "var", nome: "Var. mês", tipo: "int", g: "Ranking", html: (v) => varHTML(v) },
    { chave: "Fundo", nome: "Fundo", tipo: "txt", g: "Ranking", html: (v, l) => `${l.curto ? `<span class="rk-curto" title="Histórico menor que o período do ranking (desde ${fmtData(l.ini)})">⚑</span>` : ""}<span data-mini="${esc(l._c)}">${esc(v)}</span>` },
    { chave: "total", nome: "Pontuação", tipo: "num2", g: "Ranking", html: (v) => `<b>${br(v, 1)}</b>` },
    { chave: "perf", nome: "Performance", tipo: "num2", g: "Pontos por grupo", html: (v) => br(v, 1) }, { chave: "cons", nome: "Consistência", tipo: "num2", g: "Pontos por grupo", html: (v) => br(v, 1) },
    { chave: "risco", nome: "Risco", tipo: "num2", g: "Pontos por grupo", html: (v) => br(v, 1) },
    { chave: "cvm", nome: "Classificação CVM", tipo: "txt", g: "Cadastro" }, { chave: "anbima", nome: "Classificação ANBIMA", tipo: "txt", g: "Cadastro" },
    { chave: "pl", nome: "PL (R$ mi)", tipo: "valor", g: "Cadastro", html: mi },
    { chave: "rentAA", nome: "Rent. anualizada", tipo: "pct", cor: true, g: "Performance" }, { chave: "capt", nome: "Captação líquida (R$ mi)", tipo: "valor", g: "Performance", html: (v) => `<span style="${corSinal(v)}">${mi(v)}</span>` },
    { chave: "pctCDI", nome: "Rent. %CDI", tipo: "pct", g: "Performance" }, { chave: "cdiMais", nome: "CDI +", tipo: "pct", cor: true, g: "Performance" },
    ...(R.M.pesos._objetivo ? [{ chave: "obj", nome: "Objetivo de retorno (+)", tipo: "pct", cor: true, g: "Performance",
      html: (v, l) => (v == null ? `<span class="nota" title="Sem objetivo de retorno reconhecível no cadastro da CVM">N/D</span>` : `<span style="${corSinal(v)}" title="Acima do ${esc(nomeIndice(l.objIdx))} ao ano">${brPct(v)}</span>`) }] : []),
    { chave: "dias", nome: `Dias acima do ${usaIbov(R) ? "IBOV" : "CDI"}`, tipo: "pct", g: "Consistência" },
    ...(usaIbov(R) ? [{ chave: "beta", nome: "Beta", tipo: "num2", g: "Risco" }] : []),
    { chave: "vol", nome: "Volatilidade", tipo: "pct", g: "Risco" }, { chave: "sharpe", nome: "Sharpe", tipo: "num2", cor: true, g: "Risco" },
    { chave: "mdd", nome: "MDD", tipo: "pct", cor: true, g: "Risco" }, { chave: "recup", nome: "Dias para recuperação do MDD", tipo: "int", g: "Risco" },
  ];
}
function renderRkTabela() {
  const R = rkAtivo(); if (!R) return;
  const todos = !!st.rkTodos, base = R.ordem.map((x) => linhaRk(R, x)), colunas = colunasRk(R);
  const linhas = ordenar(todos ? base : base.slice(0, TOP_RANK), "rk", colunas);
  $("#rkInfo").innerHTML = !R.fim ? "Nenhum fundo com cotas." : `<b>${esc(R.M.nome)}</b> · métricas dos últimos ${esc(R.M.periodo.toLowerCase())} até ${fmtData(R.fim)} · janela móvel de ${R.M.jmMeses} meses ` +
    `contra o ${esc(nomeIndice(R.M.bench))} (aplicações desde ${fmtData(R.iniJM)}) · <b>${R.ordem.length}</b> fundo(s) analisado(s)` +
    (R.ordem.length > TOP_RANK && !todos ? ` · mostrando o top ${TOP_RANK}` : "") + ` · "Var. mês" compara com o ranking de ${fmtData(R.fimAnt)}`;
  $("#rkTabela").innerHTML = tabelaHTML({ colunas, linhas, fixas: 3, larguras: [46, 70, 280], grupos: colunas.map((c) => c.g), ordenavel: "rk", altura: 560,
    destacar: linhas.map((l) => casa(st.destaque, l.Fundo, l.CNPJ)), classes: linhas.map((l) => (l.pos <= 3 ? "rk-top" : "")) });
  const fora = [...R.fora.map((x) => `${esc(curto(st.porCnpj.get(x.c)?.NOME || cnpjFmt(x.c), 50))} (${esc(x.motivo)})`), ...(R.foraDaBase || []).map((c) => `${cnpjFmt(c)} (fora da base)`)];
  $("#rkFora").innerHTML = (R.ordem.some((x) => x.l.curto) ? `<span class="rk-curto">⚑</span> histórico menor que o período do ranking (entra assim mesmo, com as métricas do tempo que tem). ` : "") +
    (fora.length ? `<b>Fora do ranking (${fora.length}):</b> ${fora.join("; ")}.` : "");
  const b = $("#rkExpandir"), n = R.ordem.length;
  b.hidden = n <= TOP_RANK; b.setAttribute("aria-expanded", String(todos));
  b.innerHTML = todos ? `▴ Mostrar só o top ${TOP_RANK}` : `▾ Mostrar o ranking completo <span class="nota">(${n} fundos)</span>`;
}
function renderRkPontos() {
  const R = rkAtivo(); if (!R) return;
  const ks = GRUPOS_RANK.flatMap((g) => Object.keys(R.M.pesos).filter((k) => metricaRank(k).g === g));
  const fmtValor = (m) => (v) => (v == null ? `<span class="nota">sem valor</span>` : m.tipo === "valor" ? br(v / 1e6, 1) + " mi" : esc(FMT[m.tipo]?.(v) ?? v));
  const colunas = [{ chave: "pos", nome: "Pos.", tipo: "int", g: "Ranking" }, { chave: "Fundo", nome: "Fundo", tipo: "txt", g: "Ranking", html: (v, l) => `<span data-mini="${esc(l._c)}">${esc(v)}</span>` },
    { chave: "total", nome: "Pontuação", tipo: "num2", g: "Ranking", html: (v) => `<b>${br(v, 2)}</b>` },
    ...GRUPOS_RANK.map((g) => ({ chave: `g:${g}`, nome: g, tipo: "num2", g: "Pontos por grupo", html: (v) => br(v, 2) })),
    ...ks.flatMap((k) => { const m = metricaRank(k), p = R.M.pesos[k], gnome = `${m.nome} · peso ${Math.abs(p)} · ${p > 0 ? "maior é melhor" : "menor é melhor"}`;
      return [{ chave: `v:${k}`, nome: "Valor", tipo: m.tipo, g: gnome, html: fmtValor(m) },
        { chave: `n:${k}`, nome: "Nota (0 a 1)", tipo: "num2", g: gnome, html: (v) => br(v, 2) },
        { chave: `p:${k}`, nome: `Pontos (de ${Math.abs(p)})`, tipo: "num2", g: gnome, html: (v) => `<b>${br(v, 2)}</b>` }]; })];
  const base = st.rkTodos ? R.ordem : topRk(R);
  const linhas = ordenar(base.map((x) => ({ _c: x.id, pos: x.pos, Fundo: nomeRk(R, x.id), CNPJ: cnpjFmt(x.id), total: x.total,
    ...Object.fromEntries(GRUPOS_RANK.map((g) => [`g:${g}`, x.grupos[g]])),
    ...Object.fromEntries(ks.flatMap((k) => [[`v:${k}`, x.notas[k].valor], [`n:${k}`, x.notas[k].nota], [`p:${k}`, x.notas[k].pontos]])) })), "rkPts", colunas);
  $("#rkPontos").innerHTML = tabelaHTML({ colunas, linhas, fixas: 2, larguras: [46, 240], grupos: colunas.map((c) => c.g), ordenavel: "rkPts", altura: 520,
    destacar: linhas.map((l) => casa(st.destaque, l.Fundo, l.CNPJ)), classes: linhas.map((l) => (l.pos <= 3 ? "rk-top" : "")) });
}
function topRk(R) { return R.ordem.slice(0, TOP_RANK); }
function renderRkJM() {
  const R = rkAtivo(); if (!R) return;
  const cores = coresRk(R), top = topRk(R).filter((x) => x.l.jm?.length);
  $("#rkTitJM").textContent = `Janela móvel do top ${TOP_RANK} · ${R.M.jmMeses} meses contra o ${nomeIndice(R.M.bench)}`;
  const series = top.map((x) => { const v = x.l.jm.filter((j) => j.dif != null); return { nome: `${x.pos}. ${nomeRk(R, x.id)}`, c: x.id, cor: cores[x.id], x: v.map((j) => j.ini), y: v.map((j) => j.dif) }; });
  const xs = series.flatMap((s) => [s.x[0], s.x[s.x.length - 1]]).filter((v) => v != null);
  grafico("gRkJM", series, { ref: 0, xMin: xs.length ? Math.min(...xs) : undefined, xMax: xs.length ? Math.max(...xs) : undefined, tituloX: (d) => `Aplicação em ${fmtData(d)}` });
  $("#legRkJM").innerHTML = tabelaLegenda("rkJM", top.map((x, i) => ({ Fundo: series[i].nome, _c: x.id, cor: cores[x.id],
    Final: series[i].y.length ? series[i].y[series[i].y.length - 1] : null, Mediana: x.l.rs?.med.dif ?? null })), ["Final", "Mediana"]);
  renderRkJMTab();
}
function renderRkJMTab() {
  const R = rkAtivo(); if (!R) return;
  const top = topRk(R).filter((x) => x.l.rs);
  $("#tabRkJM").innerHTML = top.length ? htmlResumoJM(top.map((x) => ({ _c: x.id, Fundo: `${x.pos}. ${x.l.cad.NOME}`, CNPJ: cnpjFmt(x.id), resumo: x.l.rs })), nomeIndice(R.M.bench), "rkJMt")
    : `<p class="nota">Nenhum fundo do top ${TOP_RANK} tem histórico para uma janela de ${R.M.jmMeses} meses.</p>`;
}
function dadosCorrRk(R) {
  const top = topRk(R); if (top.length < 2) return null;
  const ini = Math.min(...top.map((x) => x.l.r["Data Inicial"])), fim = Math.max(...top.map((x) => x.l.r["Data Final"])), cores = coresRk(R);
  const itens = top.map((x) => ({ nome: nomeRk(R, x.id), c: x.id, cnpj: cnpjFmt(x.id), cor: cores[x.id], ret: retornosFundo(st.rk.fundos.get(x.id), ini, fim) }));
  itens.push({ nome: "IBOV", cor: corIndice("IBOV"), bench: true, ret: retornosDiarios(st.idx, "IBOV", ini, fim) });
  return { itens, m: matrizCorrelacao(itens.map((i) => i.ret)), ini, fim };
}
function renderRkCorr() {
  const R = rkAtivo(); if (!R) return;
  R.corr ||= dadosCorrRk(R);
  if (!R.corr) { $("#tabRkCorr").innerHTML = `<p class="nota">Precisa de pelo menos 2 fundos.</p>`; return; }
  renderMatrizCorr("tabRkCorr", "rk", R.corr.itens, R.corr.m);
}
function tabelaPesosRk(M) {   // linhas: grupo, métrica, peso, direção (com o total de cada grupo)
  const out = [];
  for (const g of GRUPOS_RANK) {
    const ks = Object.keys(M.pesos).filter((k) => metricaRank(k).g === g);
    out.push({ g, total: true, nome: g, peso: ks.reduce((s, k) => s + Math.abs(M.pesos[k]), 0) / 100 });
    for (const k of ks) out.push({ g, nome: metricaRank(k).nome, peso: Math.abs(M.pesos[k]) / 100, dir: M.pesos[k] > 0 ? "maior é melhor" : "menor é melhor" });
  }
  return out;
}
function renderRkPesos() {
  const R = rkAtivo(); if (!R) return;
  const ls = tabelaPesosRk(R.M);
  $("#rkPesos").innerHTML = `<p class="nota">${esc(R.M.nome)}: métricas dos últimos ${esc(R.M.periodo.toLowerCase())}; janela móvel de ${R.M.jmMeses} meses contra o ${esc(nomeIndice(R.M.bench))};
    "Realização do objetivo" = rentabilidade ao ano menos a do índice que o fundo declara como objetivo na CVM.</p>
    <table class="tb rk-pesos-tab"><thead><tr><th class="t">Métrica</th><th>Peso</th><th class="t">Direção</th></tr></thead><tbody>${ls.map((l) => l.total
      ? `<tr class="cart-total"><td class="t">${esc(l.nome)}</td><td>${brPct(l.peso, 0)}</td><td></td></tr>`
      : `<tr><td class="t">${esc(l.nome)}</td><td>${brPct(l.peso, 0)}</td><td class="t">${esc(l.dir)}</td></tr>`).join("")}
      <tr class="cart-total"><td class="t">Total</td><td>100%</td><td></td></tr></tbody></table>`;
}

// ---------- partes do relatório (PDF, PNG e Excel)
function linhasRelRk(R, lista) {
  const cols = colunasRk(R).filter((c) => !["perf", "cons", "risco"].includes(c.chave));
  return { colunas: cols.map((c) => ({ nome: c.nome, tipo: c.chave === "pl" || c.chave === "capt" ? "valor" : c.chave === "var" ? "txt" : c.tipo })),
    linhas: lista.map((x) => { const l = linhaRk(R, x);
      return cols.map((c) => c.chave === "var" ? (l.var == null ? "novo" : l.var > 0 ? `▲ ${l.var}` : l.var < 0 ? `▼ ${-l.var}` : "▬ 0")
        : c.chave === "pl" || c.chave === "capt" ? (typeof l[c.chave] === "number" ? l[c.chave] / 1e6 : null) : c.chave === "Fundo" ? (l.curto ? `${l.Fundo} (*)` : l.Fundo) : l[c.chave]); }) };
}
function blocosRanking(k) {
  const L = st.rk.lista, B = [];
  const cab = (R) => `${R.nome} · ${R.M.nome} · ${R.ordem.length} fundos analisados · métricas de ${R.M.periodo.toLowerCase()} até ${fmtData(R.fim)}`;
  if (k === "rkTop") {
    for (const R of L) { const t = linhasRelRk(R, topRk(R));
      B.push({ tipo: "tabela", nome: cab(R), aba: `${R.nome} - top ${TOP_RANK}`, pdfCompacto: { 0: 7, 1: 10, 2: 60, 3: 13, 4: 17, 5: 30 }, ...t }); }
    return { titulo: `Top ${TOP_RANK} por ranking`, nota: "Pontuação de 0 a 100. (*) = histórico menor que o período do ranking. Var. mês compara com o ranking de um mês antes.", blocos: B };
  }
  if (k === "rkCompleto") {
    for (const R of L) {
      const ks = GRUPOS_RANK.flatMap((g) => Object.keys(R.M.pesos).filter((x) => metricaRank(x).g === g));
      const t = linhasRelRk(R, R.ordem);
      B.push({ tipo: "tabela", soExcel: true, nome: `${R.nome} - completo`, colunas: [...t.colunas, { nome: "Performance (pontos)", tipo: "num2" }, { nome: "Consistência (pontos)", tipo: "num2" },
          { nome: "Risco (pontos)", tipo: "num2" }, ...ks.flatMap((x) => [{ nome: `${metricaRank(x).nome}: valor`, tipo: metricaRank(x).tipo },
            { nome: `${metricaRank(x).nome}: nota (0 a 1)`, tipo: "num" }, { nome: `${metricaRank(x).nome}: pontos (peso ${Math.abs(R.M.pesos[x])})`, tipo: "num2" }])],
        linhas: R.ordem.map((x, i) => [...t.linhas[i], x.grupos.Performance, x.grupos["Consistência"], x.grupos.Risco, ...ks.flatMap((q) => [x.notas[q].valor, x.notas[q].nota, x.notas[q].pontos])]) });
    }
    return { titulo: "Rankings completos com a pontuação de cada métrica", blocos: B };
  }
  if (k === "rkJM") {
    const antes = st.rk.ativo;
    for (let i = 0; i < L.length; i++) {
      const R = L[i]; st.rk.ativo = i; semZoom("gRkJM"); renderRkJM();
      const im = imagemGrafico("gRkJM"); if (im) B.push({ tipo: "img", titulo: R.nome, ...im });
      const top = topRk(R).filter((x) => x.l.rs);
      const bn = nomeIndice(R.M.bench);
      // resumo enxuto (como no relatório de referência) no PDF; a tabela completa da janela móvel vai só para o Excel
      if (top.length) B.push({ tipo: "tabela", aba: `${R.nome} - janela`, pdfCompacto: { 0: 7, 1: 95 }, nome: `${R.nome} · janela de ${R.M.jmMeses} meses contra o ${bn}`,
        colunas: [{ nome: "Pos.", tipo: "int" }, { nome: "Fundo", tipo: "txt" }, { nome: `Mínimo (${bn}+ a.a.)`, tipo: "pct" }, { nome: `Mediana (${bn}+ a.a.)`, tipo: "pct" },
          { nome: `Máximo (${bn}+ a.a.)`, tipo: "pct" }, { nome: "Prazo (meses)", tipo: "int" }, { nome: "Janelas", tipo: "int" },
          { nome: `Consistência (acima do ${bn})`, tipo: "pct" }, { nome: "Consistência (retorno positivo)", tipo: "pct" }],
        linhas: top.map((x) => [x.pos, x.l.cad.NOME, x.l.rs.min.dif, x.l.rs.med.dif, x.l.rs.max.dif, R.M.jmMeses, x.l.rs.total, x.l.rs.pAcima, x.l.rs.pPositivas]) });
      if (top.length) B.push({ tipo: "tabela", soExcel: true, aba: `${R.nome} - janela compl`, ...tabelaResumoJM(`${R.nome} · janela completa`,
        top.map((x) => ({ nome: `${x.pos}. ${x.l.cad.NOME}`, cnpj: cnpjFmt(x.id), resumo: x.l.rs })), bn) });
    }
    st.rk.ativo = antes; renderRankings();
    return { titulo: `Janela móvel do top ${TOP_RANK}`, nota: `Diferença ao ano para o benchmark em cada data de aplicação (últimos ${JM_ANOS} anos).`, blocos: B };
  }
  if (k === "rkCorr") {
    for (const R of L) { R.corr ||= dadosCorrRk(R); if (R.corr) B.push({ tipo: "img", titulo: `${R.nome} · ${fmtData(R.corr.ini)} a ${fmtData(R.corr.fim)}`, ...imagemMatriz(R.corr.itens, R.corr.m) },
      { tipo: "tabela", ...tabelaMatriz(`${R.nome} - correlação`, R.corr.itens, R.corr.m), soExcel: true }); }
    return { titulo: `Matrizes de correlação do top ${TOP_RANK}`, blocos: B };
  }
  if (k === "rkPesos") {
    const vistos = new Set();
    for (const R of L) {
      if (vistos.has(R.modelo)) continue; vistos.add(R.modelo);
      const usados = L.filter((x) => x.modelo === R.modelo).map((x) => x.nome).join(", ");
      B.push({ tipo: "tabela", aba: `Pesos ${R.M.nome}`, nome: `${R.M.nome} (usado em: ${usados}) · métricas de ${R.M.periodo.toLowerCase()} · janela de ${R.M.jmMeses} meses contra o ${nomeIndice(R.M.bench)}`,
        colunas: [{ nome: "Métrica", tipo: "txt" }, { nome: "Peso", tipo: "pct" }, { nome: "Direção", tipo: "txt" }],
        linhas: [...tabelaPesosRk(R.M).map((l) => [l.total ? `${l.nome} (total do grupo)` : `   ${l.nome}`, l.peso, l.dir || ""]), ["Total", 1, ""]] });
    }
    return { titulo: "Critérios e pesos", nota: "Em cada métrica, o pior fundo do ranking recebe 0 e o melhor recebe o peso inteiro; os demais ficam em proporção.", blocos: B };
  }
  return null;
}

// ---------- exportar e importar rankings (arquivo)
function exportarRankings() {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ tipo: "rankings-de-fundos", versao: 1, rankings: lerRankings() }, null, 1)], { type: "application/json" }));
  a.download = `rankings_de_fundos_${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function importarRankings(arquivo) {
  let dados; try { dados = JSON.parse(await arquivo.text()); } catch { await perguntar("Arquivo inválido", "Não foi possível ler este arquivo.", [{ rot: "OK", v: 1, classe: "prim" }]); return; }
  const novos = Object.entries(dados?.rankings || {}).filter(([n, x]) => n && Array.isArray(x?.cnpjs) && MODELOS_RANK[x.modelo]), g = lerRankings();
  const rep = novos.filter(([n]) => g[n]).map(([n]) => n);
  let sob = true;
  if (rep.length) { const r = await perguntar("Rankings com o mesmo nome", `Já existem: <b>${rep.map(esc).join(", ")}</b>.`,
    [{ rot: "Cancelar", v: null }, { rot: "Manter os meus", v: false }, { rot: "Substituir pelos do arquivo", v: true, classe: "prim" }]); if (r == null) return; sob = r; }
  for (const [n, x] of novos) if (!g[n] || sob) g[n] = { modelo: x.modelo, cnpjs: x.cnpjs.map((c) => String(c).replace(/\D/g, "").padStart(14, "0")), atualizado: x.atualizado || new Date().toISOString() };
  gravarRankings(g); renderRkLista();
}

// ---------- eventos
document.addEventListener("click", async (e) => {
  const t = e.target;
  if (t.id === "abrirRank") return abrirRank();
  if (t.id === "rkNovo") return abrirEditorRk();
  if (t.dataset?.rkEd) return abrirEditorRk(t.dataset.rkEd);
  if (t.dataset?.rkDel) {
    const n = t.dataset.rkDel;
    if (!(await perguntar("Excluir o ranking?", `Excluir o ranking <b>${esc(n)}</b>?`, [{ rot: "Cancelar", v: false }, { rot: "Excluir", v: true, classe: "prim" }]))) return;
    const g = lerRankings(); delete g[n]; gravarRankings(g); rkSel.delete(n); return renderRkLista();
  }
  const lr = t.closest?.("#rkLista tr[data-rk]");
  if (lr && !t.closest("button, input, label")) { const n = lr.dataset.rk; rkSel.has(n) ? rkSel.delete(n) : rkSel.add(n); return renderRkLista(); }
  if (t.id === "rkMarcarTodos" || t.id === "rkDesmarcar") { for (const n of Object.keys(lerRankings())) t.id === "rkMarcarTodos" ? rkSel.add(n) : rkSel.delete(n); return renderRkLista(); }
  if (t.id === "rkCalcular") return calcularRankings();
  if (t.id === "rkExportar") return exportarRankings();
  // editor
  if (t.id === "rkEdLista") return abrirSeletor(rkEd.cnpjs, (lista) => { rkEd.cnpjs = lista; renderEditorRk(); }, "Fundos do ranking");
  if (t.id === "rkEdColar") return abrirColar(rkEd.cnpjs, (lista, substituir) => juntarNoEditor(lista, substituir));
  if (t.id === "rkEdSel") return juntarNoEditor([...st.sel]);
  if (t.id === "rkEdLimpar") { rkEd.cnpjs = []; return renderEditorRk(); }
  if (t.dataset?.rkEdrm) { rkEd.cnpjs = rkEd.cnpjs.filter((c) => c !== t.dataset.rkEdrm); return renderEditorRk(); }
  if (t.id === "rkEdCancelar") { rkEd.aberto = false; $("#rkEditor").hidden = true; $("#rkListaBox").hidden = false; return renderRkLista(); }
  if (t.id === "rkEdSalvar") return salvarEditorRk();
  // resultados
  if (t.closest?.("#rkExpandir")) { st.rkTodos = !st.rkTodos; renderRkTabela(); return renderRkPontos(); }
  const pill = t.closest?.("[data-rk-pill]");
  if (pill) { st.rk.ativo = Number(pill.dataset.rkPill); semZoom("gRkJM"); return renderRankings(); }
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.dataset?.rkSel) { t.checked ? rkSel.add(t.dataset.rkSel) : rkSel.delete(t.dataset.rkSel); return renderRkLista(); }
  if (t.id === "rkModelo") { rkEd.modelo = t.value; return renderEditorRk(); }
  if (t.id === "rkEdGrupo" && t.value) { const x = lerGrupos()[t.value]; t.value = ""; if (x) juntarNoEditor(x.cnpjs); return; }
  if (t.id === "rkImportar" && t.files[0]) { importarRankings(t.files[0]); t.value = ""; return; }
  if (false) return;
});
resumoLateralRk();

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
  semZoom("gAcum", "gDd");
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
  const c = el.dataset.mini, f = st.res?.fundos.get(c) || st.rk?.fundos.get(c), box = $("#mini");
  if (!f || f.d.length < 3) return;
  const ult = f.d[f.d.length - 1], i0 = lowerBound(f.d, somarMeses(ult, -12));
  const q = Array.from(f.q.subarray(Math.max(0, i0 - 1)));
  if (q.length < 3) return;
  const W = 220, H = 60, p = 3, mn = Math.min(...q), mx = Math.max(...q), amp = mx - mn || 1;
  const pts = q.map((v, i) => [p + i * (W - 2 * p) / (q.length - 1), H - p - (v - mn) / amp * (H - 2 * p)]);
  const var12 = q[q.length - 1] / q[0] - 1, cor = var12 >= 0 ? VERDE : VERMELHO;
  const linha = pts.map((t) => t[0].toFixed(1) + "," + t[1].toFixed(1)).join(" ");
  box.innerHTML = `<div class="mini-tit">${esc(st.res?.apelidos[c] || curto(st.porCnpj.get(c)?.NOME || c))}</div>
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
    ({ met: renderMetricas, risco: renderTabRisco, jm: renderTabJM, cartMet: renderCartMetricas, cartRisco: renderTabCartRisco, cartJM: renderTabCartJM,
       rk: renderRkTabela, rkPts: renderRkPontos, rkJMt: renderRkJMTab })[tab]?.(); return;
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
  if (t.closest("#riscoEixo button")) { st.riscoEixo = t.closest("button").dataset.e; salvar("riscoEixo", st.riscoEixo); delete st.ord.risco; semZoom("gRisco"); renderRisco(); return; }
  if (t.id === "btnTravar") { st.travar = !st.travar; salvar("travar", st.travar); desenharTravar(); return; }
  if (t.id === "btnTopo") { scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); return; }
  if (t.id === "abrirFontes") { $("#dlgFontes").showModal(); return; }
  if (t.closest("[data-fechar]") || t.id === "dlgFontes") { $("#dlgFontes").close(); return; }
  if (t.id === "jmAtualizar") { semZoom("gJM"); calcularJM(); renderJM(); return; }
  if (t.id === "jmBaixar") { baixarJM(); return; }
  if (t.closest("#resBusca button.add")) { adicionar([t.closest("button.add").dataset.c]); }
  else if (t.dataset.rm) remover(t.dataset.rm);
  else if (t.id === "limpar") { st.sel = []; atualizarSidebar(); }
  else if (t.closest("#periodos button")) {
    const p = t.closest("button").dataset.p;
    st.periodos.has(p) ? st.periodos.delete(p) : st.periodos.add(p); atualizarSidebar();
  }
  else if (t.id === "calcular") calcular();
  else if (t.closest("#barraPer button")) { st.perAtivo = t.closest("button").dataset.per; semZoom("gAcum", "gDd", "gRisco"); renderResultado(); }
  else if (t.closest("#relModo button")) { st.rel.modo = t.closest("button").dataset.m; semZoom("gAcum"); renderAcum(); }
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
  if (false) { /* seleção: tratada no módulo de seleção */ }
  else if (t.dataset.todos) { st.todos[t.dataset.todos] = t.checked; ({ acum: renderAcum, dd: renderDd, jm: renderJM, cartAcum: renderCartAcum, cartDd: renderCartDd, cartJM: renderCartJM, rkJM: renderRkJM })[t.dataset.todos]?.(); }
  else if (t.id === "agrupar") { st.agrupar = t.value; salvar("agrupar", st.agrupar); renderMetricas(); }
  else if (t.id === "relOn") { st.rel.on = t.checked; semZoom("gAcum"); renderAcum(); }
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
