#!/usr/bin/env node
/**
 * Generador de SVGs del perfil con datos REALES de la API de GitHub.
 *
 * - Sin dependencias (Node >= 20, fetch nativo).
 * - SVG puro: nada de <foreignObject> (no renderiza en Safari / app movil de GitHub).
 * - Animaciones con SMIL (<animate>), que GitHub permite en imagenes.
 *
 * Uso:
 *   GH_TOKEN=$(gh auth token) node scripts/generate-svgs.mjs
 *   (en Actions usa secrets.GITHUB_TOKEN automaticamente)
 *
 * Flags:
 *   --static-only   solo regenera los SVG estaticos (hero, terminal, cards, footer), sin red.
 */
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ───────────────────────────── CONFIG ─────────────────────────────
const CONFIG = {
  user: "DavidCreat",
  displayName: "David Fonseca",
  role: "Full Stack Developer & DevOps",
  city: "Ibagué, Tolima · CO", // ciudad natal / base
  web: "eas1.com.es",
  blog: "dev.to/davidcreat",
  mail: "david.fonseca12p@gmail.com",
  org: "EAS1 HOSTING",
  utcOffset: -5, // America/Bogota (sin horario de verano)
  // Repos destacados (orden = orden en el README). Edita libremente.
  featured: [
    "Sistema-de-Gestion-Orgnizada",
    "fesc-student-agenda",
    "Archivo_Central",
    "Angular-.Net",
    "TaylorViz",
    "metodos_calculo_app",
  ],
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "assets");

// ───────────────────────────── THEME ─────────────────────────────
const C = {
  bg0: "#05060a",
  bg1: "#0b0e17",
  card: "#0c0d12",
  line: "#2a2410",
  gold: "#FFD700",
  goldDeep: "#B8860B",
  cream: "#FFF8DC",
  text: "#E6E1CF",
  muted: "#8A7A3A",
  dim: "#5c5530",
  ok: "#7EE787",
};
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const MONO = "ui-monospace,'SF Mono','Cascadia Code',Consolas,'Liberation Mono',monospace";

// ───────────────────────────── HELPERS ─────────────────────────────
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const fmt = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : String(n));

function wrap(text, maxChars, maxLines) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars) {
      lines.push(cur.trim());
      cur = w;
      if (lines.length === maxLines) break;
    } else cur += " " + w;
  }
  if (lines.length < maxLines && cur.trim()) lines.push(cur.trim());
  const used = lines.join(" ").length;
  if (used < words.join(" ").length && lines.length) {
    let last = lines[lines.length - 1];
    if (last.length > maxChars - 1) last = last.slice(0, maxChars - 1);
    lines[lines.length - 1] = last.replace(/[\s.,;:]+$/, "") + "…";
  }
  return lines;
}

/** Marco comun: fondo, rejilla sutil, esquinas doradas. */
function frame(w, h, id, { grid = true, radius = 12, corners = true } = {}) {
  return `
  <defs>
    <linearGradient id="${id}-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.bg0}"/><stop offset=".5" stop-color="${C.bg1}"/><stop offset="1" stop-color="${C.bg0}"/>
    </linearGradient>
    <radialGradient id="${id}-glow" cx=".2" cy="0" r="1">
      <stop offset="0" stop-color="${C.gold}" stop-opacity=".14"/><stop offset=".6" stop-color="${C.gold}" stop-opacity="0"/>
    </radialGradient>
    <pattern id="${id}-grid" width="32" height="32" patternUnits="userSpaceOnUse">
      <path d="M32 0H0V32" fill="none" stroke="${C.gold}" stroke-opacity=".05"/>
    </pattern>
    <clipPath id="${id}-clip"><rect width="${w}" height="${h}" rx="${radius}"/></clipPath>
  </defs>
  <g clip-path="url(#${id}-clip)">
    <rect width="${w}" height="${h}" fill="url(#${id}-bg)"/>
    ${grid ? `<rect width="${w}" height="${h}" fill="url(#${id}-grid)"/>` : ""}
    <rect width="${w}" height="${h}" fill="url(#${id}-glow)"/>
  </g>
  <rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="${radius}" fill="none" stroke="${C.gold}" stroke-opacity=".22"/>
  ${corners ? `<g stroke="${C.gold}" stroke-width="2" fill="none" stroke-linecap="round">
    <path d="M14 26V14H26"/><path d="M${w - 14} 26V14H${w - 26}"/>
    <path d="M14 ${h - 26}V${h - 14}H26"/><path d="M${w - 14} ${h - 26}V${h - 14}H${w - 26}"/>
  </g>` : ""}`;
}

const svg = (w, h, body, title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}" fill="none">
  <title>${esc(title)}</title>${body}
</svg>
`;

/**
 * Animacion "segura": el valor BASE del atributo es el final (visible), asi los
 * visores que no ejecutan SMIL (app movil, reduced-motion, miniaturas) muestran
 * la imagen completa. El retraso se codifica con keyTimes en vez de `begin`
 * para no mostrar un parpadeo del estado final antes de empezar.
 */
function anim(attr, from, to, delay, dur, spline = false) {
  const total = +(Number(delay) + Number(dur)).toFixed(3);
  const k = (Number(delay) / total).toFixed(4);
  const ease = spline ? ` calcMode="spline" keySplines="0 0 1 1;.2 .8 .2 1"` : "";
  return `<animate attributeName="${attr}" values="${from};${from};${to}" keyTimes="0;${k};1" dur="${total}s" fill="freeze"${ease}/>`;
}

const fadeIn = (delay, dur = 0.6) => anim("opacity", 0, 1, delay, dur);

const pulse = (dur = 1.8) =>
  `<animate attributeName="opacity" values="1;.25;1" dur="${dur}s" repeatCount="indefinite"/>`;

/** Barra que crece desde 0 hasta width (el width base del elemento debe ser el final). */
const growW = (w, delay, dur = 0.9) => anim("width", 0, w, delay, dur, true);

/** Barra vertical que crece hacia arriba desde `base`. */
const growUp = (y, h, base, delay, dur = 0.7) => anim("height", 0, h, delay, dur, true) + anim("y", base, y, delay, dur, true);

// ───────────────────────────── GITHUB API ─────────────────────────────
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

async function gql(query, variables = {}) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "profile-svg-generator" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function fetchData() {
  const base = await gql(
    `query($login:String!){
      user(login:$login){
        id login name location createdAt
        followers{totalCount}
        pullRequests{totalCount}
        issues{totalCount}
        repositories(ownerAffiliations:OWNER, isFork:false, privacy:PUBLIC, first:100, orderBy:{field:PUSHED_AT,direction:DESC}){
          totalCount
          nodes{
            name description stargazerCount forkCount pushedAt isArchived
            primaryLanguage{name color}
            languages(first:10, orderBy:{field:SIZE,direction:DESC}){edges{size node{name color}}}
          }
        }
      }
    }`,
    { login: CONFIG.user },
  );
  const u = base.user;

  // Commits por año (grafo de contribuciones), desde el año de creacion de la cuenta.
  const firstYear = new Date(u.createdAt).getUTCFullYear();
  const nowYear = new Date().getUTCFullYear();
  const years = [];
  for (let y = firstYear; y <= nowYear; y++) years.push(y);
  const yq = years
    .map(
      (y) =>
        `y${y}: contributionsCollection(from:"${y}-01-01T00:00:00Z", to:"${y}-12-31T23:59:59Z"){ totalCommitContributions restrictedContributionsCount contributionCalendar{ totalContributions } }`,
    )
    .join("\n");
  const yd = await gql(`query($login:String!){ user(login:$login){ ${yq} } }`, { login: CONFIG.user });
  const perYear = years.map((y) => ({
    year: y,
    commits: yd.user[`y${y}`].totalCommitContributions,
    total: yd.user[`y${y}`].contributionCalendar.totalContributions,
  }));

  // Horas reales de commit (hasta 100 commits propios por repo publico).
  const hours = new Array(24).fill(0);
  const repos = u.repositories.nodes;
  for (let i = 0; i < repos.length; i += 10) {
    const chunk = repos.slice(i, i + 10);
    const q = chunk
      .map(
        (r, j) =>
          `r${j}: repository(owner:"${CONFIG.user}", name:${JSON.stringify(r.name)}){ defaultBranchRef{ target{ ... on Commit{ history(first:100, author:{id:"${u.id}"}){ nodes{ authoredDate } } } } } }`,
      )
      .join("\n");
    const d = await gql(`query{ ${q} }`);
    for (const k of Object.keys(d)) {
      const nodes = d[k]?.defaultBranchRef?.target?.history?.nodes ?? [];
      for (const n of nodes) {
        const h = (new Date(n.authoredDate).getUTCHours() + 24 + CONFIG.utcOffset) % 24;
        hours[h]++;
      }
    }
  }

  // Lenguajes por bytes (todos los repos publicos propios).
  const langMap = new Map();
  for (const r of repos)
    for (const e of r.languages.edges) {
      const cur = langMap.get(e.node.name) || { name: e.node.name, color: e.node.color || C.gold, size: 0, repos: 0 };
      cur.size += e.size;
      cur.repos += 1;
      langMap.set(e.node.name, cur);
    }
  const langs = [...langMap.values()].sort((a, b) => b.size - a.size);

  return {
    login: u.login,
    location: u.location,
    createdAt: u.createdAt,
    followers: u.followers.totalCount,
    prs: u.pullRequests.totalCount,
    issues: u.issues.totalCount,
    repoCount: u.repositories.totalCount,
    stars: repos.reduce((a, r) => a + r.stargazerCount, 0),
    forks: repos.reduce((a, r) => a + r.forkCount, 0),
    repos,
    perYear,
    commits: perYear.reduce((a, y) => a + y.commits, 0),
    contributions: perYear.reduce((a, y) => a + y.total, 0),
    hours,
    langs,
    generatedAt: new Date().toISOString(),
  };
}

// ───────────────────────────── DYNAMIC CARDS ─────────────────────────────

function statsBoard(d) {
  const W = 1200, H = 340, cw = 270, gap = 20, x0 = 25, y0 = 24, ch = 292;
  const cards = [0, 1, 2, 3].map((i) => x0 + i * (cw + gap));
  const since = new Date(d.createdAt);
  const yearsOn = ((Date.now() - since) / (365.25 * 864e5)).toFixed(1);
  const sinceTxt = since.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

  const cardBox = (x, n, title, sub) => `
  <g transform="translate(${x} ${y0})">${fadeIn(0.1 + n * 0.15)}
    <rect width="${cw}" height="${ch}" rx="10" fill="${C.card}" fill-opacity=".85" stroke="${C.gold}" stroke-opacity=".2"/>
    <rect x="0" y="0" width="${cw}" height="2" fill="${C.gold}">${growW(cw, 0.3 + n * 0.15, 1.2)}</rect>
    <text x="18" y="28" font-family="${MONO}" font-size="10" letter-spacing="2" fill="${C.muted}">▸ 0${n + 1} / ${esc(sub)}</text>
    <circle cx="${cw - 20}" cy="24" r="3.5" fill="${C.gold}">${pulse()}</circle>
    <text x="18" y="56" font-family="${SANS}" font-size="18" font-weight="800" letter-spacing="1.5" fill="${C.cream}">${esc(title)}</text>
    <line x1="18" y1="70" x2="${cw - 18}" y2="70" stroke="${C.gold}" stroke-opacity=".18"/>`;

  // 01 profile
  const rows = [
    ["user", "@" + d.login],
    ["org", CONFIG.org],
    ["loc", CONFIG.city], // fija: el campo "location" del perfil puede no coincidir
    ["since", sinceTxt],
    ["repos", `${d.repoCount} public`],
    ["followers", String(d.followers)],
  ];
  const c1 =
    cardBox(cards[0], 0, "PROFILE", "PROFILE") +
    rows
      .map(
        ([k, v], i) => `
    <text x="18" y="${98 + i * 28}" font-family="${MONO}" font-size="11" fill="${C.muted}">${k}</text>
    <text x="${cw - 18}" y="${98 + i * 28}" text-anchor="end" font-family="${MONO}" font-size="12" font-weight="600" fill="${C.text}">${esc(v)}</text>`,
      )
      .join("") +
    `<text x="18" y="${ch - 16}" font-family="${MONO}" font-size="10" fill="${C.muted}">on github ▸ <tspan fill="${C.gold}">${yearsOn} years</tspan></text></g>`;

  // 02 languages (bytes)
  const total = d.langs.reduce((a, l) => a + l.size, 0) || 1;
  const top = d.langs.slice(0, 6);
  const c2 =
    cardBox(cards[1], 1, "LANGUAGES", "BY CODE SIZE") +
    top
      .map((l, i) => {
        const pct = (l.size / total) * 100;
        const bw = Math.max(2, ((cw - 36) * pct) / 100);
        const y = 92 + i * 30;
        return `
    <circle cx="23" cy="${y - 4}" r="4" fill="${l.color}"/>
    <text x="34" y="${y}" font-family="${SANS}" font-size="12" font-weight="600" fill="${C.text}">${esc(l.name)}</text>
    <text x="${cw - 18}" y="${y}" text-anchor="end" font-family="${MONO}" font-size="11" fill="${C.gold}">${pct.toFixed(1)}%</text>
    <rect x="18" y="${y + 7}" width="${cw - 36}" height="4" rx="2" fill="${C.gold}" fill-opacity=".08"/>
    <rect x="18" y="${y + 7}" width="${bw.toFixed(1)}" height="4" rx="2" fill="${l.color}">${growW(bw.toFixed(1), 0.6 + i * 0.1)}</rect>`;
      })
      .join("") +
    `<text x="18" y="${ch - 16}" font-family="${MONO}" font-size="10" fill="${C.muted}">polyglot ▸ <tspan fill="${C.gold}">${d.langs.length} languages</tspan></text></g>`;

  // 03 commits per year
  const ys = d.perYear;
  const maxC = Math.max(1, ...ys.map((y) => y.commits));
  const plotH = 150, bwid = Math.min(30, (cw - 36) / ys.length - 8);
  const step = (cw - 36) / ys.length;
  const c3 =
    cardBox(cards[2], 2, "COMMITS / YEAR", "TIMELINE") +
    ys
      .map((y, i) => {
        const h = Math.max(2, (y.commits / maxC) * plotH);
        const x = 18 + i * step + (step - bwid) / 2;
        const base = 92 + plotH;
        return `
    <rect x="${x.toFixed(1)}" y="${base - h}" width="${bwid.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${C.gold}" fill-opacity="${(0.35 + 0.65 * (y.commits / maxC)).toFixed(2)}">
      ${growUp((base - h).toFixed(1), h.toFixed(1), base, (0.7 + i * 0.08).toFixed(2), 0.8)}
    </rect>
    <text x="${(x + bwid / 2).toFixed(1)}" y="${base - h - 6}" text-anchor="middle" font-family="${MONO}" font-size="10" font-weight="700" fill="${C.cream}">${y.commits}</text>
    <text x="${(x + bwid / 2).toFixed(1)}" y="${base + 16}" text-anchor="middle" font-family="${MONO}" font-size="10" fill="${C.muted}">'${String(y.year).slice(2)}</text>`;
      })
      .join("") +
    `<text x="18" y="${ch - 16}" font-family="${MONO}" font-size="10" fill="${C.muted}">peak ▸ <tspan fill="${C.gold}">${ys.reduce((a, b) => (b.commits > a.commits ? b : a)).year}</tspan></text></g>`;

  // 04 totals
  const tiles = [
    [fmt(d.commits), "COMMITS"],
    [fmt(d.contributions), "CONTRIBS"],
    [fmt(d.prs), "PULL REQS"],
    [fmt(d.stars), "STARS"],
    [fmt(d.repoCount), "REPOS"],
    [fmt(d.followers), "FOLLOWERS"],
  ];
  const c4 =
    cardBox(cards[3], 3, "OVERALL", "TOTALS") +
    tiles
      .map(([v, k], i) => {
        const tx = 18 + (i % 2) * 120, ty = 84 + Math.floor(i / 2) * 62;
        return `
    <rect x="${tx}" y="${ty}" width="112" height="52" rx="6" fill="${C.gold}" fill-opacity=".04" stroke="${C.gold}" stroke-opacity=".12"/>
    <text x="${tx + 12}" y="${ty + 28}" font-family="${SANS}" font-size="22" font-weight="800" fill="${C.gold}">${esc(v)}</text>
    <text x="${tx + 12}" y="${ty + 44}" font-family="${MONO}" font-size="9" letter-spacing="1.5" fill="${C.muted}">${k}</text>`;
      })
      .join("") +
    `<text x="18" y="${ch - 16}" font-family="${MONO}" font-size="10" fill="${C.muted}">sync ▸ <tspan fill="${C.gold}">${d.generatedAt.slice(0, 10)}</tspan></text></g>`;

  return svg(W, H, frame(W, H, "sb") + c1 + c2 + c3 + c4, `GitHub stats for ${d.login}`);
}

function tier(v, steps) {
  // steps: [[min, rank], ...] de mayor a menor
  for (const [min, r] of steps) if (v >= min) return r;
  return "C";
}

function trophies(d) {
  const W = 1200, H = 300;
  const yearsOn = Math.floor((Date.now() - new Date(d.createdAt)) / (365.25 * 864e5));
  const items = [
    ["COMMITS", d.commits, tier(d.commits, [[2000, "SSS"], [1000, "SS"], [500, "S"], [250, "AAA"], [100, "AA"], [50, "A"], [10, "B"]])],
    ["REPOS", d.repoCount, tier(d.repoCount, [[100, "SSS"], [80, "SS"], [50, "S"], [30, "AAA"], [20, "AA"], [10, "A"], [3, "B"]])],
    ["STARS", d.stars, tier(d.stars, [[1000, "SSS"], [500, "SS"], [200, "S"], [100, "AAA"], [50, "AA"], [25, "A"], [5, "B"]])],
    ["PULL REQS", d.prs, tier(d.prs, [[500, "SSS"], [200, "SS"], [100, "S"], [50, "AAA"], [25, "AA"], [10, "A"], [1, "B"]])],
    ["LANGUAGES", d.langs.length, tier(d.langs.length, [[20, "SSS"], [15, "SS"], [12, "S"], [10, "AAA"], [8, "AA"], [5, "A"], [2, "B"]])],
    ["FOLLOWERS", d.followers, tier(d.followers, [[1000, "SSS"], [500, "SS"], [200, "S"], [100, "AAA"], [50, "AA"], [20, "A"], [5, "B"]])],
    ["YEARS", yearsOn, tier(yearsOn, [[10, "SSS"], [8, "SS"], [6, "S"], [5, "AAA"], [4, "AA"], [2, "A"], [1, "B"]])],
  ];
  const rankFill = (r) => (r.startsWith("S") ? C.gold : r.startsWith("A") ? "#E8C766" : C.muted);
  const cw = 152, gap = 13, x0 = (W - (items.length * cw + (items.length - 1) * gap)) / 2;

  const cup = (r) => `
      <path d="M-22 -30H22V-8C22 6 12 16 0 16C-12 16 -22 6 -22 -8Z" fill="${rankFill(r)}" fill-opacity=".9"/>
      <path d="M-22 -24H-32V-14C-32 -6 -26 0 -20 0M22 -24H32V-14C32 -6 26 0 20 0" stroke="${rankFill(r)}" stroke-width="3"/>
      <rect x="-5" y="16" width="10" height="10" fill="${rankFill(r)}" fill-opacity=".8"/>
      <rect x="-16" y="26" width="32" height="6" rx="2" fill="${rankFill(r)}"/>
      <path d="M-14 -26H-4V-6" stroke="#fff" stroke-opacity=".35" stroke-width="3" stroke-linecap="round"/>`;

  const body = items
    .map(([label, val, r], i) => {
      const x = x0 + i * (cw + gap);
      return `
  <g transform="translate(${x.toFixed(1)} 78)">${fadeIn(0.15 + i * 0.12)}
    <rect width="${cw}" height="190" rx="10" fill="${C.card}" fill-opacity=".85" stroke="${rankFill(r)}" stroke-opacity="${r.startsWith("S") ? ".55" : ".22"}"/>
    <text x="${cw / 2}" y="28" text-anchor="middle" font-family="${SANS}" font-size="15" font-weight="900" letter-spacing="2" fill="${rankFill(r)}">${r}</text>
    <g transform="translate(${cw / 2} 84)">${cup(r)}</g>
    <text x="${cw / 2}" y="148" text-anchor="middle" font-family="${SANS}" font-size="24" font-weight="800" fill="${C.cream}">${fmt(val)}</text>
    <text x="${cw / 2}" y="170" text-anchor="middle" font-family="${MONO}" font-size="10" letter-spacing="2" fill="${C.muted}">${label}</text>
  </g>`;
    })
    .join("");

  const head = `
  <text x="${W / 2}" y="40" text-anchor="middle" font-family="${SANS}" font-size="20" font-weight="800" letter-spacing="4" fill="${C.cream}">ACHIEVEMENTS</text>
  <text x="${W / 2}" y="60" text-anchor="middle" font-family="${MONO}" font-size="10" letter-spacing="2" fill="${C.muted}">calculado con datos reales de la API · ${d.generatedAt.slice(0, 10)}</text>`;
  return svg(W, H, frame(W, H, "tr") + head + body, `Achievements for ${d.login}`);
}

function productiveHours(d) {
  const W = 495, H = 195;
  const max = Math.max(1, ...d.hours);
  const total = d.hours.reduce((a, b) => a + b, 0);
  const peak = d.hours.indexOf(max);
  const px = 22, py = 52, pw = W - 44, ph = 100;
  const bw = pw / 24 - 4;
  const bars = d.hours
    .map((v, h) => {
      const bh = Math.max(2, (v / max) * ph);
      const x = px + h * (pw / 24) + 2;
      const y = py + ph - bh;
      const isPeak = h === peak;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${isPeak ? C.cream : C.gold}" fill-opacity="${(0.25 + 0.75 * (v / max)).toFixed(2)}">
      ${growUp(y.toFixed(1), bh.toFixed(1), py + ph, (0.2 + h * 0.03).toFixed(2), 0.6)}
    </rect>`;
    })
    .join("\n    ");
  const labels = [0, 6, 12, 18, 23]
    .map((h) => `<text x="${(px + h * (pw / 24) + 2 + bw / 2).toFixed(1)}" y="${py + ph + 16}" text-anchor="middle" font-family="${MONO}" font-size="9" fill="${C.muted}">${String(h).padStart(2, "0")}h</text>`)
    .join("");
  const share = (from, to) => d.hours.slice(from, to).reduce((a, b) => a + b, 0) / (total || 1);
  const night = share(0, 6) + share(22, 24);
  const persona = night > 0.3 ? "night owl" : share(6, 12) > 0.35 ? "early bird" : "day shift";
  const body = `
  <text x="22" y="30" font-family="${SANS}" font-size="15" font-weight="800" fill="${C.gold}">Productive Time</text>
  <text x="${W - 22}" y="30" text-anchor="end" font-family="${MONO}" font-size="10" fill="${C.muted}">UTC${CONFIG.utcOffset} · ${total} commits</text>
  <line x1="${px}" y1="${py + ph + 0.5}" x2="${px + pw}" y2="${py + ph + 0.5}" stroke="${C.gold}" stroke-opacity=".2"/>
    ${bars}
  ${labels}
  <text x="22" y="${H - 12}" font-family="${MONO}" font-size="10" fill="${C.muted}">peak ▸ <tspan fill="${C.cream}">${String(peak).padStart(2, "0")}:00</tspan> · profile ▸ <tspan fill="${C.gold}">${persona}</tspan></text>`;
  return svg(W, H, frame(W, H, "ph", { grid: false, radius: 8, corners: false }) + body, "Commits by hour of day");
}

function languagesCard(d) {
  const W = 495, H = 195;
  const total = d.langs.reduce((a, l) => a + l.size, 0) || 1;
  const top = d.langs.slice(0, 8);
  const other = d.langs.slice(8).reduce((a, l) => a + l.size, 0);
  const segs = other > 0 ? [...top, { name: "Other", color: C.dim, size: other }] : top;
  const bx = 22, by = 46, bw = W - 44;
  let acc = 0;
  const bar = segs
    .map((l, i) => {
      const w = (l.size / total) * bw;
      const x = bx + acc;
      acc += w;
      return `<rect x="${x.toFixed(1)}" y="${by}" width="${w.toFixed(1)}" height="10" fill="${l.color}">${growW(w.toFixed(1), 0.2 + i * 0.08, 0.5)}</rect>`;
    })
    .join("");
  const legend = segs
    .map((l, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = 22 + col * 235, y = 86 + row * 21;
      return `<g>${fadeIn(0.5 + i * 0.06, 0.4)}<circle cx="${x + 5}" cy="${y - 4}" r="5" fill="${l.color}"/>
    <text x="${x + 16}" y="${y}" font-family="${SANS}" font-size="12" fill="${C.text}">${esc(l.name)}</text>
    <text x="${x + 215}" y="${y}" text-anchor="end" font-family="${MONO}" font-size="11" fill="${C.gold}">${((l.size / total) * 100).toFixed(1)}%</text></g>`;
    })
    .join("\n  ");
  const body = `
  <text x="22" y="30" font-family="${SANS}" font-size="15" font-weight="800" fill="${C.gold}">Most Used Languages</text>
  <text x="${W - 22}" y="30" text-anchor="end" font-family="${MONO}" font-size="10" fill="${C.muted}">${d.repoCount} public repos · bytes</text>
  <clipPath id="lgc"><rect x="${bx}" y="${by}" width="${bw}" height="10" rx="5"/></clipPath>
  <rect x="${bx}" y="${by}" width="${bw}" height="10" rx="5" fill="${C.gold}" fill-opacity=".06"/>
  <g clip-path="url(#lgc)">${bar}</g>
  ${legend}`;
  return svg(W, H, frame(W, H, "lg", { grid: false, radius: 8, corners: false }) + body, "Most used languages");
}

function repoCard(r) {
  const W = 400, H = 140;
  const desc = wrap(r.description || "Sin descripcion.", 54, 2);
  const lang = r.primaryLanguage;
  const updated = new Date(r.pushedAt).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  const book = `<path d="M0 1.5A1.5 1.5 0 0 1 1.5 0H11v11H2a1 1 0 0 0 0 2h9v1H1.5A1.5 1.5 0 0 1 0 12.5Z" fill="${C.gold}"/>`;
  const star = `<path d="M6 0l1.8 3.8 4.2.5-3.1 2.9.8 4.1L6 9.3 2.3 11.3l.8-4.1L0 4.3l4.2-.5Z" fill="${C.gold}"/>`;
  const fork = `<g stroke="${C.gold}" stroke-width="1.4" fill="none"><circle cx="2.5" cy="2" r="1.6"/><circle cx="9.5" cy="2" r="1.6"/><circle cx="6" cy="11" r="1.6"/><path d="M2.5 3.6V5a1.5 1.5 0 0 0 1.5 1.5h4A1.5 1.5 0 0 0 9.5 5V3.6M6 6.5v2.9"/></g>`;
  let fx = 20;
  const foot = [];
  if (lang) {
    foot.push(`<circle cx="${fx + 6}" cy="114" r="6" fill="${lang.color || C.gold}"/><text x="${fx + 18}" y="118" font-family="${SANS}" font-size="12" fill="${C.text}">${esc(lang.name)}</text>`);
    fx += 30 + lang.name.length * 7.2;
  }
  foot.push(`<g transform="translate(${fx} 108)">${star}</g><text x="${fx + 17}" y="118" font-family="${MONO}" font-size="12" fill="${C.text}">${r.stargazerCount}</text>`);
  fx += 45;
  foot.push(`<g transform="translate(${fx} 107)">${fork}</g><text x="${fx + 17}" y="118" font-family="${MONO}" font-size="12" fill="${C.text}">${r.forkCount}</text>`);
  const body = `
  <g transform="translate(20 22)">${book}</g>
  <text x="40" y="34" font-family="${SANS}" font-size="15" font-weight="800" fill="${C.gold}">${esc(r.name.length > 34 ? r.name.slice(0, 33) + "…" : r.name)}</text>
  <circle cx="${W - 24}" cy="29" r="3.5" fill="${C.gold}">${pulse(2.4)}</circle>
  ${desc.map((l, i) => `<text x="20" y="${64 + i * 18}" font-family="${SANS}" font-size="12.5" fill="${C.text}" fill-opacity=".85">${esc(l)}</text>`).join("\n  ")}
  ${foot.join("\n  ")}
  <text x="${W - 20}" y="118" text-anchor="end" font-family="${MONO}" font-size="10" fill="${C.muted}">${updated}</text>`;
  return svg(W, H, frame(W, H, "rc", { grid: false, radius: 8, corners: false }) + body, `${r.name} repository`);
}

// ───────────────────────────── STATIC ART (antes con foreignObject) ─────────────────────────────

function hero() {
  const W = 1200, H = 320;
  const cx = 1010, cy = 160;
  const dots = [[640, 300], [720, 60], [780, 250], [860, 40], [700, 150], [880, 290]]
    .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="1.6" fill="${C.cream}"><animate attributeName="opacity" values=".1;.9;.1" dur="${3 + i * 0.7}s" begin="${i * 0.4}s" repeatCount="indefinite"/></circle>`)
    .join("");
  const orbit = (r, dur, rev, dash) => `
    <circle r="${r}" stroke="${C.gold}" stroke-opacity=".35" ${dash ? `stroke-dasharray="${dash}"` : ""}/>
    <g><circle cx="${r}" cy="0" r="4" fill="${C.gold}"/><animateTransform attributeName="transform" type="rotate" from="${rev ? 360 : 0}" to="${rev ? 0 : 360}" dur="${dur}s" repeatCount="indefinite"/></g>`;
  const badges = [["Available for hire", true], ["TypeScript", false], ["Laravel", false], ["Spring Boot", false], ["DevOps", false]];
  let bx = 64;
  const badgeSvg = badges
    .map(([t, hot], i) => {
      const w = t.length * 7.4 + 30;
      const g = `<g transform="translate(${bx} 236)">${fadeIn(1.6 + i * 0.12, 0.4)}
      <rect width="${w.toFixed(0)}" height="28" rx="14" fill="${hot ? C.gold : C.gold}" fill-opacity="${hot ? 1 : 0.06}" stroke="${C.gold}" stroke-opacity="${hot ? 1 : 0.35}"/>
      ${hot ? `<circle cx="14" cy="14" r="3.5" fill="${C.bg0}">${pulse(1.2)}</circle>` : ""}
      <text x="${hot ? 24 : 15}" y="18.5" font-family="${MONO}" font-size="11.5" font-weight="700" fill="${hot ? C.bg0 : C.cream}">${esc(t)}</text></g>`;
      bx += w + 10;
      return g;
    })
    .join("");
  const role = "Full Stack Developer & DevOps Engineer";
  const roleW = role.length * 10.2;
  const body = `
  <defs>
    <linearGradient id="hn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="${C.gold}"/><stop offset="1" stop-color="${C.goldDeep}"/></linearGradient>
    <radialGradient id="hcore"><stop offset="0" stop-color="${C.cream}"/><stop offset=".5" stop-color="${C.gold}"/><stop offset="1" stop-color="${C.goldDeep}"/></radialGradient>
    <radialGradient id="hhalo"><stop offset="0" stop-color="${C.gold}" stop-opacity=".35"/><stop offset="1" stop-color="${C.gold}" stop-opacity="0"/></radialGradient>
    <clipPath id="typeclip"><rect x="64" y="158" width="${roleW + 60}" height="40">${growW(roleW + 60, 0.8, 1.6)}</rect></clipPath>
    <linearGradient id="scan" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.gold}" stop-opacity="0"/><stop offset=".5" stop-color="${C.gold}" stop-opacity=".10"/><stop offset="1" stop-color="${C.gold}" stop-opacity="0"/></linearGradient>
  </defs>
  <rect y="-60" width="${W}" height="60" fill="url(#scan)"><animate attributeName="y" from="-60" to="${H}" dur="6s" repeatCount="indefinite"/></rect>
  ${dots}
  <g transform="translate(${cx} ${cy})">
    <circle r="120" fill="url(#hhalo)"/>
    ${orbit(118, 22, false, "2 6")}
    ${orbit(86, 14, true)}
    ${orbit(54, 9, false, "1 4")}
    <circle r="30" fill="url(#hcore)"><animate attributeName="r" values="28;31;28" dur="3s" repeatCount="indefinite"/></circle>
    <text y="7" text-anchor="middle" font-family="${SANS}" font-size="20" font-weight="900" fill="${C.bg0}">DF</text>
    <text y="150" text-anchor="middle" font-family="${MONO}" font-size="10" letter-spacing="3" fill="${C.gold}">SYSTEM ONLINE<animate attributeName="opacity" values="1;.4;1" dur="2s" repeatCount="indefinite"/></text>
  </g>
  <g>${fadeIn(0.1)}
    <text x="64" y="74" font-family="${MONO}" font-size="12" letter-spacing="4" fill="${C.muted}">PORTFOLIO // V2026 // ${esc(CONFIG.city.toUpperCase())}</text>
  </g>
  <g>${fadeIn(0.3, 0.8)}
    <text x="62" y="140" font-family="${SANS}" font-size="64" font-weight="900" letter-spacing="-1.5" fill="url(#hn)">${esc(CONFIG.displayName)}</text>
  </g>
  <g clip-path="url(#typeclip)">
    <text x="64" y="186" font-family="${MONO}" font-size="17" font-weight="600" fill="${C.cream}"><tspan fill="${C.gold}">&lt;</tspan>${esc(role)}<tspan fill="${C.gold}">/&gt;</tspan></text>
  </g>
  <rect x="${64 + roleW + 36}" y="170" width="9" height="20" fill="${C.gold}"><animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite"/></rect>
  ${badgeSvg}`;
  return svg(W, H, frame(W, H, "hero") + body, `${CONFIG.displayName} — ${role}`);
}

function terminal() {
  const W = 900, H = 440;
  const P = { user: C.gold, at: C.muted, host: C.cream, path: "#79C0FF", key: "#FFA657", str: "#A5D6FF", num: "#D2A8FF", out: "#8B949E", ok: C.ok };
  const t = (txt, fill) => `<tspan fill="${fill}">${esc(txt)}</tspan>`;
  const prompt = (cmd, flag) =>
    t("david", P.user) + t("@", P.at) + t(CONFIG.web, P.host) + " " + t("~/about", P.path) + " " + t("❯", C.gold) + " " + t(cmd, "#fff") + " " + t(flag, P.out);
  const kv = (k, v, comma = true) => t("  ", P.out) + t(`"${k}"`, P.key) + t(": ", P.out) + v + (comma ? t(",", P.out) : "");
  const lines = [
    prompt("whoami", "--verbose"),
    t("{", P.out),
    kv("name", t(`"${CONFIG.displayName}"`, P.str)),
    kv("role", t(`"Full Stack Developer & DevOps"`, P.str)),
    kv("location", t(`"Ibagué, Tolima, Colombia"`, P.str)),
    kv("stack", t("[", P.out) + t(`"TypeScript"`, P.str) + t(", ", P.out) + t(`"Laravel"`, P.str) + t(", ", P.out) + t(`"Spring Boot"`, P.str) + t("]", P.out)),
    kv("company", t(`"${CONFIG.org}"`, P.str)),
    kv("coffee_per_day", t("3.14", P.num)),
    kv("status", t(`"building the future"`, P.ok), false),
    t("}", P.out),
    "",
    prompt("mission", "--short"),
    t(`"Transformo café en arquitecturas que escalan."`, P.ok),
  ];
  const lh = 26, y0 = 92;
  const body = lines
    .map((l, i) => {
      if (!l) return "";
      const isPrompt = i === 0 || i === 11;
      const begin = (0.4 + i * 0.32).toFixed(2);
      const y = y0 + i * lh;
      if (isPrompt) {
        return `<clipPath id="tl${i}"><rect x="28" y="${y - 18}" width="820" height="26">${growW(820, begin, 0.9)}</rect></clipPath>
    <text xml:space="preserve" x="32" y="${y}" font-family="${MONO}" font-size="15" clip-path="url(#tl${i})">${l}</text>`;
      }
      return `<text xml:space="preserve" x="32" y="${y}" font-family="${MONO}" font-size="15">${l}${fadeIn(begin, 0.25)}</text>`;
    })
    .join("\n  ");
  const lastY = y0 + 12 * lh;
  const caretX = 32 + 47 * 9.05;
  const chrome = `
  <defs><linearGradient id="tbar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#151927"/><stop offset="1" stop-color="#0b0e16"/></linearGradient></defs>
  <rect width="${W}" height="${H}" rx="14" fill="#07090f"/>
  <path d="M0 14A14 14 0 0 1 14 0H${W - 14}A14 14 0 0 1 ${W} 14V44H0Z" fill="url(#tbar)"/>
  <line x1="0" y1="44.5" x2="${W}" y2="44.5" stroke="${C.gold}" stroke-opacity=".15"/>
  <circle cx="24" cy="22" r="6.5" fill="#ff5f57"/><circle cx="46" cy="22" r="6.5" fill="#febc2e"/><circle cx="68" cy="22" r="6.5" fill="#28c840"/>
  <text x="${W / 2}" y="27" text-anchor="middle" font-family="${MONO}" font-size="12" fill="${C.muted}">david <tspan fill="${C.gold}">//</tspan> zsh <tspan fill="${C.gold}">//</tspan> ~/about-me</text>
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="14" stroke="${C.gold}" stroke-opacity=".35"/>`;
  const caret = `<rect x="${caretX}" y="${lastY - 14}" width="9" height="18" fill="${C.gold}"><animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite"/></rect>`;
  return svg(W, H, chrome + "\n  " + body + caret, "Terminal — whoami");
}

function whoamiCards() {
  const W = 1200, H = 440, cw = 368, gap = 20, x0 = 28;
  const cards = [
    {
      n: "01", t: "SNAPSHOT", s: "who.am.i()",
      lines: [
        ["Full-Stack Dev convirtiendo ideas en", C.text],
        ["código. Obsesión por la DX, sistemas", C.text],
        ["escalables y experiencias que se", C.text],
        ["sienten instantáneas.", C.text],
      ],
      tags: ["TS", "Laravel", "Spring", "DevOps"],
      foot: ["mindset ▸", "build · ship · iterate"],
    },
    {
      n: "02", t: "CURRENTLY", s: "active.streams()",
      list: [["SHIP", "EAS1 HOSTING · infra"], ["CODE", "Laravel & Spring Boot"], ["LEARN", "DevOps & AI agents"], ["BUILD", "Flutter · Unity · Python"]],
      foot: ["status ▸", "available for hire"],
    },
    {
      n: "03", t: "FIND ME", s: "contact.channels()",
      list: [["WEB", CONFIG.web], ["BLOG", CONFIG.blog], ["MAIL", CONFIG.mail], ["GEO", "Ibagué, Tolima · UTC−5"]],
      foot: ["uptime ▸", "24 / 7"],
    },
  ];
  const body = cards
    .map((c, i) => {
      const x = x0 + i * (cw + gap);
      let inner = "";
      if (c.lines) {
        inner += c.lines.map(([l, f], j) => `<text x="24" y="${150 + j * 24}" font-family="${SANS}" font-size="14.5" fill="${f}">${esc(l)}</text>`).join("");
        let tx = 24;
        inner += c.tags
          .map((tg) => {
            const w = tg.length * 8 + 20;
            const g = `<rect x="${tx}" y="262" width="${w}" height="24" rx="5" fill="${C.gold}" fill-opacity=".08" stroke="${C.gold}" stroke-opacity=".35"/><text x="${tx + w / 2}" y="278" text-anchor="middle" font-family="${MONO}" font-size="12" font-weight="700" fill="${C.gold}">${esc(tg)}</text>`;
            tx += w + 8;
            return g;
          })
          .join("");
      } else {
        inner += c.list
          .map(
            ([k, v], j) => `<g transform="translate(24 ${150 + j * 40})">${fadeIn(0.6 + i * 0.15 + j * 0.1, 0.4)}
        <text font-family="${MONO}" font-size="13" fill="${C.gold}">▸</text>
        <text x="20" font-family="${MONO}" font-size="11" letter-spacing="1.5" fill="${C.muted}">${k}</text>
        <text x="82" font-family="${SANS}" font-size="14" font-weight="600" fill="${C.cream}">${esc(v)}</text></g>`,
          )
          .join("");
      }
      return `
  <g transform="translate(${x} 28)">${fadeIn(0.1 + i * 0.18)}
    <rect width="${cw}" height="384" rx="12" fill="${C.card}" fill-opacity=".85" stroke="${C.gold}" stroke-opacity=".22"/>
    <rect width="${cw}" height="2" fill="${C.gold}">${growW(cw, 0.4 + i * 0.18, 1.2)}</rect>
    <text x="24" y="38" font-family="${MONO}" font-size="11" letter-spacing="2" fill="${C.muted}">▸ ${c.n} / ${c.t}</text>
    <circle cx="${cw - 26}" cy="34" r="4" fill="${C.gold}">${pulse()}</circle>
    <text x="24" y="80" font-family="${SANS}" font-size="28" font-weight="900" letter-spacing="2" fill="${C.cream}">${c.t}</text>
    <text x="24" y="102" font-family="${MONO}" font-size="12" fill="${C.gold}">${c.s}</text>
    <line x1="24" y1="120" x2="${cw - 24}" y2="120" stroke="${C.gold}" stroke-opacity=".2"/>
    ${inner}
    <line x1="24" y1="330" x2="${cw - 24}" y2="330" stroke="${C.gold}" stroke-opacity=".12"/>
    <text x="24" y="358" font-family="${MONO}" font-size="11" fill="${C.muted}">${esc(c.foot[0])} <tspan fill="${C.gold}">${esc(c.foot[1])}</tspan></text>
  </g>`;
    })
    .join("");
  return svg(W, H, frame(W, H, "wc") + body, "whoami — snapshot, currently, find me");
}

function footer() {
  const W = 1200, H = 200;
  const body = `
  <defs>
    <linearGradient id="fn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="${C.gold}"/><stop offset="1" stop-color="${C.goldDeep}"/></linearGradient>
    <linearGradient id="hz" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.gold}" stop-opacity="0"/><stop offset=".5" stop-color="${C.gold}"/><stop offset="1" stop-color="${C.gold}" stop-opacity="0"/></linearGradient>
  </defs>
  <rect x="0" y="${H - 3}" width="${W}" height="1.5" fill="url(#hz)"><animate attributeName="opacity" values=".3;1;.3" dur="4s" repeatCount="indefinite"/></rect>
  <text x="56" y="62" font-family="${MONO}" font-size="11" letter-spacing="4" fill="${C.muted}">END OF TRANSMISSION</text>
  <text x="54" y="118" font-family="${SANS}" font-size="46" font-weight="900" letter-spacing="-1" fill="url(#fn)">${esc(CONFIG.displayName)}</text>
  <text x="56" y="148" font-family="${MONO}" font-size="13" fill="${C.cream}"><tspan fill="${C.gold}">&lt;/&gt;</tspan> Full Stack Developer &amp; DevOps Engineer</text>
  <g transform="translate(${W - 56} 0)">
    <circle cx="-150" cy="58" r="4" fill="${C.ok}">${pulse(1.4)}</circle>
    <text x="0" y="62" text-anchor="end" font-family="${MONO}" font-size="11" letter-spacing="3" fill="${C.ok}">SYSTEM ONLINE</text>
    <text x="0" y="104" text-anchor="end" font-family="${SANS}" font-size="15" font-style="italic" fill="${C.text}">"El mejor código es el que nunca tuviste que explicar."</text>
    <text x="0" y="140" text-anchor="end" font-family="${MONO}" font-size="11" letter-spacing="2" fill="${C.muted}">V2026.11 <tspan fill="${C.gold}">·</tspan> IBAGUÉ, CO <tspan fill="${C.gold}">·</tspan> MIT</text>
  </g>`;
  return svg(W, H, frame(W, H, "ft") + body, `${CONFIG.displayName} — end of transmission`);
}

// ───────────────────────────── README SYNC ─────────────────────────────
async function syncReadmeRepos(featured) {
  const file = path.join(ROOT, "README.md");
  const md = await readFile(file, "utf8");
  const rows = [];
  for (let i = 0; i < featured.length; i += 2) {
    const pair = featured.slice(i, i + 2).map(
      (r) => `  <a href="https://github.com/${CONFIG.user}/${r.name}"><img src="./assets/repos/${r.name}.svg" width="49%" alt="${esc(r.name)}"/></a>`,
    );
    rows.push(pair.join("\n"));
  }
  const block = `<!-- REPOS:START -->\n<p align="center">\n${rows.join("\n</p>\n<p align=\"center\">\n")}\n</p>\n<!-- REPOS:END -->`;
  const next = md.replace(/<!-- REPOS:START -->[\s\S]*?<!-- REPOS:END -->/, block);
  if (next !== md) await writeFile(file, next);
}

// ───────────────────────────── MAIN ─────────────────────────────
async function main() {
  await mkdir(path.join(OUT, "repos"), { recursive: true });
  const write = (name, content) => writeFile(path.join(OUT, name), content);

  await Promise.all([write("hero.svg", hero()), write("terminal.svg", terminal()), write("whoami-cards.svg", whoamiCards()), write("footer.svg", footer())]);
  console.log("static: hero, terminal, whoami-cards, footer");

  if (process.argv.includes("--static-only")) return;
  if (!TOKEN) throw new Error("Falta GH_TOKEN o GITHUB_TOKEN");

  const d = await fetchData();
  await Promise.all([
    write("stats-board.svg", statsBoard(d)),
    write("trophies.svg", trophies(d)),
    write("productive-hours.svg", productiveHours(d)),
    write("languages.svg", languagesCard(d)),
  ]);
  const byName = new Map(d.repos.map((r) => [r.name, r]));
  const featured = CONFIG.featured.map((n) => byName.get(n)).filter(Boolean);
  await Promise.all(featured.map((r) => write(path.join("repos", `${r.name}.svg`), repoCard(r))));
  await syncReadmeRepos(featured);
  console.log(
    `dynamic: commits=${d.commits} contribs=${d.contributions} prs=${d.prs} stars=${d.stars} repos=${d.repoCount} followers=${d.followers} langs=${d.langs.length} hourSamples=${d.hours.reduce((a, b) => a + b, 0)} featured=${featured.length}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
