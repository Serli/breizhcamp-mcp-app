#!/usr/bin/env bun
/**
 * Re-scrape l'intégralité du programme BreizhCamp depuis breizhcamp.org et
 * réécrit data/program.json à partir de zéro.
 *
 * Usage:  bun run refresh-data
 *
 * Le site est une app SvelteKit. Les pages programme sont rendues côté serveur
 * (les <article> de chaque session sont dans le HTML), les fiches sessions
 * exposent l'abstract + les bios des speakers, et l'équipe est embarquée dans
 * le bundle JS de la route /equipe.
 *
 * Lance manuellement quand le programme du site bouge.
 */
import fs from "node:fs/promises";
import path from "node:path";

const BASE = "https://www.breizhcamp.org";
const OUT = path.join(import.meta.dirname, "..", "data", "program.json");
const TIMEZONE = "Europe/Paris";

// Jours de l'événement. Le site n'expose pas proprement les dates par jour, on
// les fige ici (BreizhCamp 2026 : 24–26 juin 2026, campus de Beaulieu, Rennes).
const DAYS = [
  { day: 1, weekday: "mercredi", date: "2026-06-24", label: "Mercredi 24 juin 2026", path: "/programme/mercredi" },
  { day: 2, weekday: "jeudi", date: "2026-06-25", label: "Jeudi 25 juin 2026", path: "/programme/jeudi" },
  { day: 3, weekday: "vendredi", date: "2026-06-26", label: "Vendredi 26 juin 2026", path: "/programme/vendredi" },
];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const CONCURRENCY = 8;

// ───────────────────────────── HTTP helpers ────────────────────────────────

async function getHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

async function pMapPool<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency = CONCURRENCY,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

// ───────────────────────────── HTML helpers ────────────────────────────────

const decodeEntities = (s: string): string =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));

const stripTags = (s: string): string => s.replace(/<[^>]+>/g, "");

const collapse = (s: string): string => s.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

const text = (s: string): string => collapse(decodeEntities(stripTags(s)));

const inline = (s: string): string => decodeEntities(stripTags(s)).replace(/\s+/g, " ").trim();

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Le site encode les horaires des sessions comme des instants UTC dont l'heure
 * murale correspond à l'heure locale Paris voulue (bug de fuseau côté
 * breizhcamp.org), puis les rend dans son SSR avec 2 h de retard supplémentaires.
 * Résultat : les chaînes affichées (ex. "6h00") sont 2 h en avance sur l'heure
 * réelle Europe/Paris (8h00). On rétablit l'heure murale Paris en ajoutant 2 h.
 * BreizhCamp a toujours lieu en juin → toujours CEST (UTC+2) → décalage constant.
 */
const SITE_TIME_OFFSET_HOURS = 2;

/** "7h00", "8h", "14h55" → "07:00" / "08:00" / "14:55", recalé en Europe/Paris. */
function hhmm(raw: string): string {
  const m = /(\d{1,2})\s*h\s*(\d{2})?/.exec(raw);
  if (!m) return "??:??";
  const h = (parseInt(m[1], 10) + SITE_TIME_OFFSET_HOURS) % 24;
  const mm = (m[2] ?? "00").padStart(2, "0");
  return `${String(h).padStart(2, "0")}:${mm}`;
}

function durationToMin(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const h = /(\d+)\s*h(?:\s*(\d+))?/.exec(raw);
  if (h) return parseInt(h[1], 10) * 60 + (h[2] ? parseInt(h[2], 10) : 0);
  const m = /(\d+)\s*min/.exec(raw);
  if (m) return parseInt(m[1], 10);
  return null;
}

// ───────────────────────────── Schedule listing ────────────────────────────

interface ListedSpeaker {
  name: string;
  photoUrl: string | null;
}

interface ListedSession {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  room: string | null;
  track: string | null; // thématique (event-type)
  level: string | null;
  durationMin: number | null;
  isMeal: boolean;
  speakers: ListedSpeaker[];
}

/** Parse une page /programme/<jour> et retourne les sessions dédupliquées. */
function parseSchedulePage(html: string): ListedSession[] {
  const articles = html.match(/<article\b[\s\S]*?<\/article>/g) ?? [];
  const byId = new Map<string, ListedSession>();

  for (const a of articles) {
    const idMatch = /\/programme\/session\/([^"]+)/.exec(a);
    if (!idMatch) continue;
    const id = idMatch[1];
    if (byId.has(id)) continue; // chaque session apparaît 2x (vue mobile + desktop)

    const h2 = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(a);
    const title = h2
      ? text(h2[1].replace(/<div class="bookmark[\s\S]*?<\/div>/g, ""))
      : id;

    // footer schedule : "14h00 — 14h55 <span class="mobile-only">· Amphi D</span>"
    const sched = /<p class="schedule[^"]*">([\s\S]*?)<\/p>/.exec(a);
    let startTime = "??:??";
    let endTime = "??:??";
    let room: string | null = null;
    if (sched) {
      const plain = text(sched[1]);
      const times = plain.match(/\d{1,2}\s*h\s*\d{0,2}/g);
      if (times && times.length >= 1) startTime = hhmm(times[0]);
      if (times && times.length >= 2) endTime = hhmm(times[1]);
      const roomMatch = /·\s*(.+?)\s*$/.exec(plain);
      if (roomMatch) room = roomMatch[1].trim();
    }

    const etype = /<span class="event-type[^"]*">([^<]*)<\/span>/.exec(a);
    const track = etype ? text(etype[1]) : null;

    const lvl = /class="level[^"]*"[^>]*title="([^"]*)"/.exec(a);
    const level = lvl ? lvl[1] : null;

    const durClass = /duration-(\d+)/.exec(a);
    const durationMin = durClass ? parseInt(durClass[1], 10) : null;

    const isMeal = /\bis-meal\b/.test(a);

    // speakers : un ou plusieurs <span class="speaker">… <img …/> <p>Name</p></span>
    const speakers: ListedSpeaker[] = [];
    for (const sp of a.matchAll(/<span class="speaker[^"]*">([\s\S]*?)<\/span>/g)) {
      const inner = sp[1];
      const nameMatch = /<p class="[^"]*">([^<]+)<\/p>/.exec(inner);
      if (!nameMatch) continue;
      const name = text(nameMatch[1]);
      const imgMatch = /<img[^>]*src="([^"]+)"/.exec(inner);
      const photoUrl = imgMatch ? decodeEntities(imgMatch[1]) : null;
      if (name) speakers.push({ name, photoUrl: photoUrl && /^https?:/.test(photoUrl) ? photoUrl : null });
    }

    byId.set(id, { id, title, startTime, endTime, room, track, level, durationMin, isMeal, speakers });
  }

  return [...byId.values()];
}

// ───────────────────────────── Session detail ──────────────────────────────

interface DetailSpeaker {
  name: string;
  photoUrl: string | null;
  bio: string | null;
}

interface SessionDetail {
  id: string;
  abstract: string | null;
  format: string | null;
  speakers: DetailSpeaker[];
}

function extractAbstract(html: string): string | null {
  // Le bloc Description est une laptop-card <h2>Description</h2><p>…</p>(<p>…</p>)
  const block = /<h2[^>]*>\s*Description\s*<\/h2>([\s\S]*?)<\/div>/.exec(html);
  if (!block) return null;
  const paras: string[] = [];
  for (const p of block[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
    const t = text(p[1].replace(/<br\s*\/?>/g, "\n"));
    if (t) paras.push(t);
  }
  for (const li of block[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
    const t = text(li[1]);
    if (t) paras.push(`- ${t}`);
  }
  return paras.length ? paras.join("\n\n") : null;
}

function extractFormat(html: string): string | null {
  // <ul class="infos-utiles-one"> <li class="type">Thématique</li>
  //   [<li class="format">Conférence</li>] <li class="duration">55 min</li> </ul>
  const fmt = /<li class="format[^"]*"[^>]*>([^<]+)<\/li>/.exec(html);
  return fmt ? text(fmt[1]) : null;
}

function extractDetailSpeakers(html: string): DetailSpeaker[] {
  const block = /<h2[^>]*>\s*Orateur[\s\S]*?<\/h2>\s*<div class="speakers">([\s\S]*?)<\/div>\s*<\/div>/.exec(html);
  const scope = block ? block[1] : "";
  const speakers: DetailSpeaker[] = [];
  for (const m of scope.matchAll(/<div class="size-(?:lg|md)[^"]*">([\s\S]*?)<\/div>/g)) {
    const inner = m[1];
    const nameMatch = /<span class="speaker[^"]*">([\s\S]*?)<\/span>/.exec(inner);
    let name: string | null = null;
    let photoUrl: string | null = null;
    if (nameMatch) {
      const np = /<p class="[^"]*">([^<]+)<\/p>/.exec(nameMatch[1]);
      name = np ? text(np[1]) : null;
      const img = /<img[^>]*src="([^"]+)"/.exec(nameMatch[1]);
      photoUrl = img && /^https?:/.test(img[1]) ? decodeEntities(img[1]) : null;
    }
    if (!name) continue;
    const bioMatch = /<p class="bio[^"]*">([\s\S]*?)<\/p>/.exec(inner);
    const bio = bioMatch ? text(bioMatch[1].replace(/<br\s*\/?>/g, "\n")) : null;
    speakers.push({ name, photoUrl, bio });
  }
  return speakers;
}

async function fetchSessionDetail(id: string): Promise<SessionDetail> {
  const html = await getHtml(`${BASE}/programme/session/${id}`);
  return {
    id,
    abstract: extractAbstract(html),
    format: extractFormat(html),
    speakers: extractDetailSpeakers(html),
  };
}

// ───────────────────────────── Sponsors ────────────────────────────────────

interface Partner {
  name: string;
  url: string | null;
  tier: string;
  logoUrl: string | null;
}

function parseSponsors(html: string): Partner[] {
  const partners: Partner[] = [];
  // Chaque tier = <section class="sponsors-section" ...><h2>Sponsors Gold</h2>… cards …</section>
  for (const sec of html.matchAll(/<section class="sponsors-section[^"]*"[\s\S]*?<\/section>/g)) {
    const block = sec[0];
    const h2 = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(block);
    let tier = h2 ? text(h2[1]) : "Sponsor";
    tier = tier.replace(/^Sponsors?\s+/i, "").trim() || tier;
    for (const card of block.matchAll(/<div class="sponsor-card[^"]*">([\s\S]*?)<\/div>/g)) {
      const inner = card[1];
      const a = /<a\s+href="([^"]+)"[^>]*(?:aria-label="([^"]*)")?[^>]*>/.exec(inner);
      const img = /<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"|<img[^>]*alt="([^"]*)"[^>]*src="([^"]+)"/.exec(inner);
      let url: string | null = a ? decodeEntities(a[1]) : null;
      const ariaName = a && a[2] ? a[2].replace(/^Visiter le site de\s+/i, "").trim() : null;
      let logoUrl: string | null = null;
      let altName: string | null = null;
      if (img) {
        const src = img[1] ?? img[4];
        const alt = img[2] ?? img[3];
        logoUrl = src ? decodeEntities(src) : null;
        altName = alt ? decodeEntities(alt).replace(/^Logo\s+/i, "").trim() : null;
      }
      const name = (ariaName || altName || "").trim();
      if (!name) continue;
      if (logoUrl && logoUrl.startsWith("/")) logoUrl = `${BASE}${logoUrl}`;
      if (url && !/^https?:/i.test(url)) url = null;
      partners.push({ name, url, tier, logoUrl });
    }
  }
  return partners;
}

// ───────────────────────────── Content pages (FAQ / venue / about) ──────────

interface FaqEntry {
  question: string;
  answer: string;
}

/** Récupère l'<article> de contenu SSR d'une page markdown (FAQ, lieu, …). */
function extractContentArticle(html: string): string {
  const m = /<article[^>]*>([\s\S]*?)<\/article>/.exec(html);
  return m ? m[1] : html;
}

/** FAQ : suite de <h2>question</h2> suivis de <p>/<ul> jusqu'au prochain <h2>. */
function parseFaq(html: string): FaqEntry[] {
  const article = extractContentArticle(html);
  const entries: FaqEntry[] = [];
  // Découpe sur les <h2>.
  const parts = article.split(/<h2[^>]*>/);
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    const qEnd = seg.indexOf("</h2>");
    if (qEnd < 0) continue;
    const question = text(seg.slice(0, qEnd));
    const rest = seg.slice(qEnd + 5);
    const chunks: string[] = [];
    for (const p of rest.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
      const t = text(p[1].replace(/<br\s*\/?>/g, "\n"));
      if (t) chunks.push(t);
    }
    for (const li of rest.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
      const t = text(li[1]);
      if (t) chunks.push(`- ${t}`);
    }
    const answer = chunks.join("\n\n");
    if (question && answer) entries.push({ question, answer });
  }
  return entries;
}

interface VenueInfo {
  name: string | null;
  description: string | null;
  access: { title: string; description: string }[];
}

function parseVenue(html: string): VenueInfo {
  const article = extractContentArticle(html);
  const firstP = /<p[^>]*>([\s\S]*?)<\/p>/.exec(article);
  const access: { title: string; description: string }[] = [];
  const parts = article.split(/<h2[^>]*>/);
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    const qEnd = seg.indexOf("</h2>");
    if (qEnd < 0) continue;
    const title = text(seg.slice(0, qEnd));
    const p = /<p[^>]*>([\s\S]*?)<\/p>/.exec(seg.slice(qEnd + 5));
    if (title && p) access.push({ title, description: text(p[1]) });
  }
  return {
    name: "Université de Rennes — campus de Beaulieu",
    description: firstP ? text(firstP[1]) : null,
    access,
  };
}

function parseAbout(html: string): string | null {
  const article = extractContentArticle(html);
  const paras: string[] = [];
  for (const p of article.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
    const t = text(p[1]);
    if (t) paras.push(t);
    if (paras.length >= 3) break;
  }
  return paras.length ? paras.join("\n\n") : null;
}

// ───────────────────────────── Home (overview + stats) ──────────────────────

function extractMeta(html: string, name: string): string | null {
  const m = new RegExp(
    `<meta[^>]*(?:name|property)="${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*content="([^"]+)"`,
  ).exec(html);
  return m ? decodeEntities(m[1]).trim() : null;
}

interface Stat {
  label: string;
  value: string;
}

function parseHome(html: string): { tagline: string | null; headline: string | null; stats: Stat[] } {
  const tagline = extractMeta(html, "og:description") ?? extractMeta(html, "description");
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  const headline = h1 ? text(h1[1]) : null;

  // Stats : "1024+ Participants 110+ Talks 3 Jours 119 Speakers" — on cherche des
  // couples valeur/label dans le bloc de stats.
  const stats: Stat[] = [];
  const plain = inline(html.replace(/<svg[\s\S]*?<\/svg>/g, " "));
  const statRe = /(\d[\d  ]*\+?)\s*(Participants|Talks|Jours|Speakers|Conférences|Sponsors)/gi;
  const seen = new Set<string>();
  for (const m of plain.matchAll(statRe)) {
    const label = m[2];
    if (seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    stats.push({ label, value: m[1].replace(/\s/g, "") });
  }
  return { tagline, headline, stats };
}

// ───────────────────────────── Team (/equipe) ──────────────────────────────

interface TeamMember {
  id: string;
  name: string;
  photoUrl: string | null;
}

interface UserGroupOrganizer {
  name: string;
  photoUrl: string | null;
  social: { type: string; url: string } | null;
}

interface UserGroup {
  name: string;
  logoUrl: string | null;
  url: string | null;
  text: string | null;
  organizers: UserGroupOrganizer[];
}

interface TeamSection {
  key: string;
  title: string;
  members: TeamMember[];
}

interface Team {
  sections: TeamSection[];
  userGroups: UserGroup[];
  source: string;
}

function abs(p: string | null): string | null {
  if (!p) return null;
  if (/^https?:/i.test(p)) return p;
  return `${BASE}${p.startsWith("/") ? "" : "/"}${p}`;
}

async function fetchTeam(): Promise<Team> {
  const pageHtml = await getHtml(`${BASE}/equipe`);

  // Compteurs et libellés de sections depuis le HTML SSR (membres chargés via JS).
  const sectionLabels: { title: string; count: number | null }[] = [];
  for (const m of pageHtml.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>\s*(?:<span class="member-count[^"]*"[^>]*>([^<]*)<\/span>)?/g)) {
    const title = text(m[1]);
    const countMatch = m[2] ? /(\d+)/.exec(m[2]) : null;
    if (title) sectionLabels.push({ title, count: countMatch ? parseInt(countMatch[1], 10) : null });
  }

  // Le détail des membres est dans le bundle JS de la route. On récupère tous
  // les nodes immutables référencés et on retient celui qui contient les data.
  const nodeRefs = Array.from(
    new Set([...pageHtml.matchAll(/_app\/immutable\/nodes\/\d+\.[A-Za-z0-9_-]+\.js/g)].map((m) => m[0])),
  );
  let js = "";
  for (const ref of nodeRefs) {
    const candidate = await getHtml(`${BASE}/${ref}`);
    if (/\{nom:"[^"]*",photo:"[^"]*"\}/.test(candidate) || /organizers:\[/.test(candidate)) {
      js = candidate;
      break;
    }
  }

  // Tableaux de membres {nom, photo} dans l'ordre du fichier.
  const memberArrays: TeamMember[][] = [];
  for (const arr of js.matchAll(/\[(\{nom:"[^"]*",photo:"[^"]*"\}(?:,\{nom:"[^"]*",photo:"[^"]*"\})*)\]/g)) {
    const members: TeamMember[] = [];
    for (const obj of arr[1].matchAll(/\{nom:"([^"]*)",photo:"([^"]*)"\}/g)) {
      const name = decodeEntities(obj[1]);
      members.push({ id: slugify(name), name, photoUrl: abs(decodeEntities(obj[2])) });
    }
    memberArrays.push(members);
  }

  // User groups : objets avec organizers:[…].
  const userGroups: UserGroup[] = [];
  for (const g of js.matchAll(
    /\{name:"([^"]*)",logo:"([^"]*)",url:"([^"]*)"(?:,text:"([^"]*)")?,organizers:\[([^\]]*)\]\}/g,
  )) {
    const organizers: UserGroupOrganizer[] = [];
    for (const o of g[5].matchAll(
      /\{name:"([^"]*)",picture:"([^"]*)"(?:,social:\{type:"([^"]*)",handle:"([^"]*)",url:"([^"]*)"\})?\}/g,
    )) {
      organizers.push({
        name: decodeEntities(o[1]),
        photoUrl: abs(decodeEntities(o[2])),
        social: o[5] ? { type: o[3], url: decodeEntities(o[5]) } : null,
      });
    }
    userGroups.push({
      name: decodeEntities(g[1]),
      logoUrl: abs(decodeEntities(g[2])),
      url: g[3] ? decodeEntities(g[3]) : null,
      text: g[4] ? decodeEntities(g[4]) : null,
      organizers,
    });
  }

  // Mappe les tableaux aux sections via les compteurs SSR (Organisation, Comité…).
  const usedArrays = new Set<number>();
  const sections: TeamSection[] = [];
  for (const { title, count } of sectionLabels) {
    if (!/organisation|comit|associ|bureau/i.test(title)) continue;
    let idx = -1;
    if (count != null) idx = memberArrays.findIndex((a, i) => !usedArrays.has(i) && a.length === count);
    if (idx < 0) idx = memberArrays.findIndex((_, i) => !usedArrays.has(i));
    if (idx < 0) continue;
    usedArrays.add(idx);
    sections.push({ key: slugify(title), title, members: memberArrays[idx] });
  }
  // Tableaux restants (ex. anciens membres du bureau) → rattachés à l'Association.
  const leftover = memberArrays.filter((_, i) => !usedArrays.has(i)).flat();
  if (leftover.length) {
    const asso = sections.find((s) => /associ/i.test(s.title));
    if (asso) {
      const seen = new Set(asso.members.map((m) => m.id));
      for (const m of leftover) if (!seen.has(m.id)) asso.members.push(m);
    } else {
      sections.push({ key: "association", title: "Association", members: leftover });
    }
  }

  return { sections, userGroups, source: `${BASE}/equipe` };
}

// ───────────────────────────── Type inference ──────────────────────────────

function inferType(listed: ListedSession, format: string | null): string {
  if (listed.isMeal || /^eat$/i.test(listed.track ?? "")) return "break";
  const f = (format ?? "").toLowerCase();
  const t = (listed.track ?? "").toLowerCase();
  if (t === "keynote" || f.includes("keynote")) return "keynote";
  if (f.includes("atelier") || f.includes("workshop") || f.includes("hands") || f.includes("université")) return "workshop";
  if (f.includes("quickie") || f.includes("quick") || listed.durationMin === 30) return "quickie";
  return "talk";
}

// ───────────────────────────── Output model ────────────────────────────────

interface OutputSpeaker {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  city: string | null;
  photoUrl: string | null;
  bio: string | null;
  links: { type: string; url: string }[];
  url: string | null;
}

interface OutputSession {
  order: number;
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  room: string | null;
  track: string | null;
  level: string | null;
  type: string;
  format: string | null;
  tags: string[];
  abstract: string | null;
  language: string | null;
  url: string;
  speakerIds: string[];
}

// ───────────────────────────── Main pipeline ───────────────────────────────

async function main() {
  console.log(`▶ Refresh BreizhCamp program (${DAYS.length} jours)`);

  // 1. Pages programme (SSR) → sessions listées par jour.
  const listings = await Promise.all(
    DAYS.map(async (d) => {
      const html = await getHtml(`${BASE}${d.path}`);
      return { ...d, listed: parseSchedulePage(html) };
    }),
  );

  // 2. Toutes les sessions à détailler (on saute les pauses/repas).
  const allIds = Array.from(
    new Set(
      listings.flatMap((d) => d.listed.filter((s) => !s.isMeal).map((s) => s.id)),
    ),
  );
  console.log(`  • ${allIds.length} fiches sessions à fetch`);

  const details = new Map<string, SessionDetail>();
  let done = 0;
  await pMapPool(allIds, async (id) => {
    try {
      const d = await fetchSessionDetail(id);
      details.set(id, d);
      if (++done % 15 === 0 || done === allIds.length) console.log(`    session ${done}/${allIds.length}`);
    } catch (e) {
      console.warn(`    ! échec session ${id}: ${(e as Error).message}`);
    }
  });

  // 3. Registre speakers (pas de page dédiée sur le site → dérivé des sessions).
  const speakers: Record<string, OutputSpeaker> = {};
  const ensureSpeaker = (name: string, photoUrl: string | null, bio: string | null) => {
    const id = slugify(name);
    if (!id) return id;
    const prev = speakers[id];
    if (!prev) {
      speakers[id] = {
        id,
        name,
        title: null,
        company: null,
        city: null,
        photoUrl: photoUrl ?? null,
        bio: bio ?? null,
        links: [],
        url: null,
      };
    } else {
      if (!prev.photoUrl && photoUrl) prev.photoUrl = photoUrl;
      if (!prev.bio && bio) prev.bio = bio;
    }
    return id;
  };
  // Détails (photo + bio) d'abord, puis le listing complète les photos manquantes.
  for (const d of details.values()) {
    for (const sp of d.speakers) ensureSpeaker(sp.name, sp.photoUrl, sp.bio);
  }

  // 4. Pages annexes (sponsors, FAQ, lieu, à-propos, home).
  console.log("  • sponsors + infos pratiques + home + équipe");
  const [sponsorsHtml, faqHtml, venueHtml, aboutHtml, homeHtml] = await Promise.all([
    getHtml(`${BASE}/sponsors`),
    getHtml(`${BASE}/infos-pratiques/faq`),
    getHtml(`${BASE}/infos-pratiques/lieu-et-acces`),
    getHtml(`${BASE}/infos-pratiques/la-conference`),
    getHtml(`${BASE}/`),
  ]);
  const partners = parseSponsors(sponsorsHtml);
  const faq = parseFaq(faqHtml);
  const venue = parseVenue(venueHtml);
  const about = parseAbout(aboutHtml);
  const home = parseHome(homeHtml);
  const team = await fetchTeam();
  console.log(
    `    ${partners.length} sponsors, ${faq.length} FAQ, ${team.sections.reduce((n, s) => n + s.members.length, 0)} membres équipe, ${team.userGroups.length} user groups`,
  );

  // 5. Assemble le programme jour par jour.
  const themes = new Set<string>();
  const days = listings.map((d) => {
    const ordered = [...d.listed].sort((a, b) => a.startTime.localeCompare(b.startTime));
    const sessions: OutputSession[] = ordered.map((s, i) => {
      const detail = details.get(s.id);
      const format = detail?.format ?? null;
      const type = inferType(s, format);
      if (s.track && type !== "break") themes.add(s.track);
      // speakers du listing (photo) en priorité, complétés par le détail.
      const names = s.speakers.length ? s.speakers.map((x) => x.name) : (detail?.speakers ?? []).map((x) => x.name);
      const speakerIds = names.map((name) => {
        const listedPhoto = s.speakers.find((x) => x.name === name)?.photoUrl ?? null;
        return ensureSpeaker(name, listedPhoto, null);
      });
      const tags = [s.track, s.level].filter((t): t is string => Boolean(t));
      return {
        order: i + 1,
        id: s.id,
        title: s.title,
        startTime: s.startTime,
        endTime: s.endTime,
        room: s.room,
        track: type === "break" ? null : s.track,
        level: s.level,
        type,
        format,
        tags,
        abstract: detail?.abstract ?? null,
        language: null,
        url: `${BASE}/programme/session/${s.id}`,
        speakerIds: Array.from(new Set(speakerIds.filter(Boolean))),
      };
    });
    return { day: d.day, date: d.date, weekday: d.weekday, label: d.label, sessions };
  });

  const program = {
    event: "BreizhCamp 2026",
    edition: 2026,
    theme: "Matrix",
    location: "Université de Rennes — campus de Beaulieu",
    city: "Rennes",
    website: BASE,
    timezone: TIMEZONE,
    info: {
      tagline: home.tagline,
      headline: home.headline,
      dates: "24 – 26 juin 2026",
      stats: home.stats,
      themes: Array.from(themes).sort((a, b) => a.localeCompare(b, "fr")),
      about,
      venue,
      partners,
      team,
      faq,
      sources: {
        home: `${BASE}/`,
        programme: `${BASE}/programme`,
        sponsors: `${BASE}/sponsors`,
        infos: `${BASE}/infos-pratiques`,
        equipe: `${BASE}/equipe`,
      },
    },
    days,
    speakers,
  };

  await fs.writeFile(OUT, JSON.stringify(program, null, 2) + "\n", "utf-8");

  // 6. Récap.
  const totalSlots = days.reduce((n, d) => n + d.sessions.length, 0);
  const totalSessions = days.reduce((n, d) => n + d.sessions.filter((s) => s.type !== "break").length, 0);
  console.log("");
  console.log("✔ Rebuild terminé");
  console.log(`  • ${days.length} jours, ${totalSlots} créneaux (${totalSessions} sessions)`);
  console.log(`  • ${Object.keys(speakers).length} speakers, ${partners.length} sponsors`);
  console.log(`  • Écrit dans ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => {
  console.error("✗ Échec:", e);
  process.exit(1);
});
