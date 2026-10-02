// Leitura dos dados publicados no Hugging Face (arquivos Parquet) + cache no navegador.
import { parquetReadObjects } from "https://cdn.jsdelivr.net/npm/hyparquet@1.31.2/+esm";
import { compressors } from "https://cdn.jsdelivr.net/npm/hyparquet-compressors@1.1.2/+esm";
import { diaDe, prepararFundo } from "./calculos.js";

const LIMITE_CACHE = 150 * 1024 * 1024;          // no máximo ~150 MB guardados no computador
const PREF_GUARDAR = "fundos.guardar";
const IDX_CACHE = "fundos.cacheIdx";
let BASE = "", VERSAO = "", guardar = true;

const lerLS = (k, padrao) => { try { const v = localStorage.getItem(k); return v == null ? padrao : JSON.parse(v); } catch { return padrao; } };
const gravarLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } };

export const guardarAtivo = () => guardar;
export async function definirGuardar(v) {
  guardar = v;
  gravarLS(PREF_GUARDAR, v);
  if (!v) await limparCache();
}
export async function limparCache() {
  try { for (const k of await caches.keys()) if (k.startsWith("fundos-")) await caches.delete(k); } catch { /* ok */ }
  gravarLS(IDX_CACHE, {});
}
export function espacoUsado() { return Object.values(lerLS(IDX_CACHE, {})).reduce((s, [t]) => s + t, 0); }

// ---------------------------------------------------------------------------- download com cache
async function baixar(caminho) {
  const url = BASE + caminho;
  let cache = null;
  if (guardar && "caches" in window) {
    try {
      cache = await caches.open("fundos-" + VERSAO);
      const hit = await cache.match(url);
      if (hit) { tocar(url); const b = new Uint8Array(await hit.arrayBuffer()); return b.byteLength ? b : null; }
    } catch { cache = null; }
  }
  const r = await fetch(url);
  if (r.status === 404) {                           // arquivo inexistente (ex.: grupo sem cotas no ano): guarda o "vazio"
    if (cache) try { await cache.put(url, new Response(new Uint8Array(0))); registrar(url, 0); } catch { /* ok */ }
    return null;
  }
  if (!r.ok) throw new Error(`${caminho}: HTTP ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (cache) {
    try {
      await cache.put(url, new Response(buf, { headers: { "content-type": "application/octet-stream" } }));
      registrar(url, buf.byteLength);
    } catch { /* disco cheio ou bloqueado: segue sem guardar */ }
  }
  return buf;
}
function tocar(url) { const idx = lerLS(IDX_CACHE, {}); if (idx[url]) { idx[url][1] = Date.now(); gravarLS(IDX_CACHE, idx); } }
async function registrar(url, tam) {
  const idx = lerLS(IDX_CACHE, {});
  idx[url] = [tam, Date.now()];
  let total = Object.values(idx).reduce((s, [t]) => s + t, 0);
  if (total > LIMITE_CACHE) {                       // apaga os usados há mais tempo
    const cache = await caches.open("fundos-" + VERSAO);
    for (const [u] of Object.entries(idx).sort((a, b) => a[1][1] - b[1][1])) {
      if (total <= LIMITE_CACHE * 0.8) break;
      await cache.delete(u); total -= idx[u][0]; delete idx[u];
    }
  }
  gravarLS(IDX_CACHE, idx);
}

const lerParquet = async (buf) =>
  parquetReadObjects({ file: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), compressors });

// ---------------------------------------------------------------------------- inicialização
export async function iniciar(base) {
  BASE = base;
  guardar = lerLS(PREF_GUARDAR, true);
  const r = await fetch(BASE + "meta.json", { cache: "no-store" });
  if (!r.ok) throw new Error(`meta.json não encontrado (HTTP ${r.status}) em ${BASE}`);
  const meta = await r.json();
  VERSAO = meta.gerado_em;
  if (lerLS("fundos.versao", null) !== VERSAO) {    // saiu atualização: apaga a versão anterior guardada
    try { for (const k of await caches.keys()) if (k.startsWith("fundos-") && k !== "fundos-" + VERSAO) await caches.delete(k); } catch { /* ok */ }
    gravarLS(IDX_CACHE, {});
    gravarLS("fundos.versao", VERSAO);
  }
  return meta;
}

export async function carregarLista() {
  const linhas = await lerParquet(await baixar("fundos.parquet"));
  for (const f of linhas) {
    f.NOME = f.NOME || "(sem nome)";
    f._busca = (f.NOME + " " + (f.GESTOR || "")).toUpperCase();
    f._dia = f.DT_COMPTC ? diaDe(f.DT_COMPTC) : null;
  }
  return linhas;
}

export async function carregarIndices() {
  const linhas = await lerParquet(await baixar("indices.parquet"));
  const serie = (nome) => {
    const v = linhas.filter((r) => r.INDICE === nome).sort((a, b) => a.DATA - b.DATA);
    return { d: Int32Array.from(v.map((r) => diaDe(r.DATA))), v: Float64Array.from(v.map((r) => r.VALOR)) };
  };
  const cdi = serie("CDI"), ibov = serie("IBOV");
  const cdiAnterior = new Map();                     // CDI do dia ANTERIOR da série (regra do VBA)
  for (let i = 1; i < cdi.d.length; i++) cdiAnterior.set(cdi.d[i], cdi.v[i - 1]);
  return { cdi, ibov, cdiAnterior };
}

// ---------------------------------------------------------------------------- cotas dos fundos
let meta_grupos = 1024;
export const definirGrupos = (n) => { meta_grupos = n; };
const grupoDe = (cnpj) => String(parseInt(cnpj.slice(-6), 10) % meta_grupos).padStart(4, "0");
const grupos = new Map();                            // grupo -> Promise<Map<cnpj, linhas[]>>

function carregarGrupo(g) {
  if (!grupos.has(g)) {
    grupos.set(g, (async () => {
      const porFundo = new Map();
      const bufs = await Promise.all(["hist", "ano"].map((p) => baixar(`cotas/${p}/g${g}.parquet`)));
      for (const buf of bufs) {
        if (!buf) continue;
        for (const r of await lerParquet(buf)) {
          if (!porFundo.has(r.CNPJ)) porFundo.set(r.CNPJ, []);
          porFundo.get(r.CNPJ).push({ d: diaDe(r.DT_COMPTC), q: r.VL_QUOTA, capt: r.CAPTC_DIA, resg: r.RESG_DIA,
            pl: r.VL_PATRIM_LIQ, cot: r.NR_COTST == null ? null : Number(r.NR_COTST) });
        }
      }
      for (const v of porFundo.values()) v.sort((a, b) => a.d - b.d);
      return porFundo;
    })().catch((e) => { grupos.delete(g); throw e; }));
  }
  return grupos.get(g);
}

// carrega vários fundos em paralelo (até 6 downloads ao mesmo tempo)
export async function carregarFundos(cnpjs, cdiAnterior, aoAvancar) {
  const fila = [...new Set(cnpjs.map(grupoDe))];
  let feitos = 0;
  const trabalhar = async () => {
    while (fila.length) {
      const g = fila.shift();
      await carregarGrupo(g);
      aoAvancar?.(++feitos, feitos + fila.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, fila.length) }, trabalhar));
  const out = new Map();
  for (const c of cnpjs) {
    const linhas = (await carregarGrupo(grupoDe(c))).get(c);
    if (linhas?.length) out.set(c, prepararFundo(linhas, cdiAnterior));
  }
  return out;
}
