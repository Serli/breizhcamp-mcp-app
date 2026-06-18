import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import {
  findSessionById,
  findSpeakerById,
  findSpeakerByName,
  findTeamPerson,
  getAllSessions,
  getDayByNumber,
  getProgram,
  nextSessions,
  normalize,
  parseEuropeParis,
  searchSessions,
  sessionsAt,
  type Session,
  type Speaker,
  type TeamPerson,
} from "./program.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");
const DIST_DIR = path.join(import.meta.dirname, "../dist");

// MCP App resource URIs.
const URI_CONF_CARD = "ui://breizhcamp/conf-card.html";
const URI_NOW_NEXT = "ui://breizhcamp/now-next.html";
const URI_SPEAKER_CARD = "ui://breizhcamp/speaker-card.html";
const URI_ORGA_CARD = "ui://breizhcamp/orga-card.html";

// Origines des ressources chargées par les widgets (mappé par le host sur les
// directives CSP img-src/script-src/style-src/font-src/media-src).
// Le host n'honore PAS le wildcard global "https://*" (seuls les wildcards de
// sous-domaine "https://*.exemple.com" sont supportés) : il faut énumérer les
// origines réelles, sinon le host retombe sur son défaut et bloque les images.
//   • photos des speakers           → sessionize.com
//   • logos sponsors, photos équipe & user groups → www.breizhcamp.org
const WIDGET_CSP = {
  connectDomains: [],
  resourceDomains: [
    "https://sessionize.com",
    "https://*.sessionize.com",
    "https://www.breizhcamp.org",
  ],
};

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

type FullSession = Session & { dayNumber: number; date: string; weekday: string };

function publicSession(s: FullSession) {
  return {
    id: s.id,
    title: s.title,
    day: s.dayNumber,
    date: s.date,
    weekday: s.weekday,
    startTime: s.startTime,
    endTime: s.endTime,
    room: s.room,
    track: s.track,
    level: s.level,
    type: s.type,
    format: s.format ?? null,
    language: s.language ?? null,
    tags: s.tags ?? [],
    abstract: s.abstract ?? null,
    url: s.url ?? null,
    speakers: (s.speakerIds ?? [])
      .map((id) => findSpeakerById(id))
      .filter((sp): sp is Speaker => Boolean(sp))
      .map(publicSpeakerSummary),
  };
}

function publicSpeakerSummary(sp: Speaker) {
  return {
    id: sp.id,
    name: sp.name,
    title: sp.title,
    company: sp.company,
    city: sp.city,
    photoUrl: sp.photoUrl,
    url: sp.url,
  };
}

function publicSpeaker(sp: Speaker) {
  const talks = getAllSessions()
    .filter((s) => (s.speakerIds ?? []).includes(sp.id))
    .map((s) => ({
      id: s.id,
      title: s.title,
      day: s.dayNumber,
      date: s.date,
      weekday: s.weekday,
      startTime: s.startTime,
      endTime: s.endTime,
      room: s.room,
      track: s.track,
    }));
  return {
    id: sp.id,
    name: sp.name,
    title: sp.title,
    company: sp.company,
    city: sp.city,
    photoUrl: sp.photoUrl,
    bio: sp.bio,
    links: sp.links,
    url: sp.url,
    talks,
  };
}

function publicMember(m: TeamPerson) {
  return {
    id: m.id,
    name: m.name,
    role: m.role,
    photoUrl: m.photoUrl,
    links: m.links,
  };
}

/** Heure/date courante en Europe/Paris. */
function parisParts(d: Date): { date: string; time: string } {
  const f = new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function parseInstant(now?: string): Date {
  if (!now) return new Date();
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/.test(now)) {
    const [d, t] = now.split(/[T ]/);
    return parseEuropeParis(d, t);
  }
  const parsed = new Date(now);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Format de date invalide: "${now}" (attendu ISO 8601 ou "YYYY-MM-DDTHH:MM")`);
  }
  return parsed;
}

function textBlock(text: string) {
  return { type: "text" as const, text };
}

function asJson(obj: unknown): string {
  return JSON.stringify(obj, null, 2);
}

export function createServer() {
  const server = new McpServer({
    name: "breizhcamp-mcp",
    version,
  });

  //========== TOOL — infos_breizhcamp ==========//
  server.registerTool(
    "infos_breizhcamp",
    {
      title: "Infos générales sur le BreizhCamp",
      description:
        "Renvoie une vue d'ensemble du BreizhCamp 2026 : nom, édition, thème de l'année, dates, lieu, tagline, chiffres clés, thématiques, présentation, lieu & accès, et la FAQ complète. À utiliser pour répondre aux questions du type \"c'est quoi le BreizhCamp\", \"où ça se passe\", \"quand a lieu l'événement\", \"c'est quoi le thème\", \"FAQ\".",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const program = getProgram();
      const result = {
        event: program.event,
        edition: program.edition,
        theme: program.theme,
        location: program.location,
        city: program.city,
        website: program.website,
        timezone: program.timezone,
        dates: program.info.dates,
        tagline: program.info.tagline,
        headline: program.info.headline,
        stats: program.info.stats,
        themes: program.info.themes,
        about: program.info.about,
        venue: program.info.venue,
        days: program.days.map((d) => ({
          day: d.day,
          date: d.date,
          weekday: d.weekday,
          label: d.label,
          sessionsCount: d.sessions.filter((s) => s.type !== "break").length,
        })),
        speakersCount: Object.keys(program.speakers).length,
        sponsorsCount: program.info.partners.length,
        faq: program.info.faq,
        sources: program.info.sources,
      };
      return { content: [textBlock(asJson(result))], structuredContent: result };
    },
  );

  //========== TOOL — liste_jours ==========//
  server.registerTool(
    "liste_jours",
    {
      title: "Liste des jours du BreizhCamp",
      description:
        "Renvoie la liste des jours du BreizhCamp (numéro, date, jour de la semaine, libellé, nombre de sessions). À utiliser pour t'orienter avant de demander le programme d'un jour précis.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const program = getProgram();
      const days = program.days.map((d) => ({
        day: d.day,
        date: d.date,
        weekday: d.weekday,
        label: d.label,
        sessionsCount: d.sessions.filter((s) => s.type !== "break").length,
      }));
      const result = {
        event: program.event,
        location: program.location,
        website: program.website,
        timezone: program.timezone,
        days,
      };
      return { content: [textBlock(asJson(result))], structuredContent: result };
    },
  );

  //========== TOOL — programme_du_jour ==========//
  server.registerTool(
    "programme_du_jour",
    {
      title: "Programme d'une journée",
      description:
        "Renvoie le programme complet d'une journée du BreizhCamp (toutes les sessions, keynotes, ateliers, pauses incluses). Trié par horaire de début. Jour 1 = mercredi, 2 = jeudi, 3 = vendredi.",
      inputSchema: {
        jour: z.number().int().min(1).max(3).describe("Numéro du jour (1 = mercredi, 2 = jeudi, 3 = vendredi)"),
      },
      annotations: READ_ONLY,
    },
    async ({ jour }) => {
      const day = getDayByNumber(jour);
      if (!day) {
        return { isError: true, content: [textBlock(`Jour ${jour} inconnu.`)] };
      }
      const sessions = day.sessions.map((s) =>
        publicSession({ ...s, dayNumber: day.day, date: day.date, weekday: day.weekday }),
      );
      const result = { day: day.day, date: day.date, weekday: day.weekday, label: day.label, sessions };
      return { content: [textBlock(asJson(result))], structuredContent: result };
    },
  );

  //========== TOOL — conf_en_cours (widget) ==========//
  registerAppTool(
    server,
    "conf_en_cours",
    {
      title: "Conférences en cours et à suivre",
      description:
        "Renvoie les sessions actuellement en cours et celles qui arrivent juste après, par salle. Renvoie un widget visuel. Le paramètre `now` est optionnel (par défaut : horloge système). Hors période d'événement, bascule en mode démo sur le jeudi à l'heure courante.",
      inputSchema: {
        now: z
          .string()
          .optional()
          .describe(
            "Date/heure de référence au format ISO 8601 (ex. \"2026-06-25T14:15+02:00\") ou \"YYYY-MM-DDTHH:MM\" (interprété en Europe/Paris). Par défaut: maintenant.",
          ),
      },
      annotations: READ_ONLY,
      _meta: {
        ui: { resourceUri: URI_NOW_NEXT },
      },
    },
    async ({ now }) => {
      const program = getProgram();
      const eventDates = program.days.map((d) => d.date);
      const userProvided = Boolean(now);

      let instant = parseInstant(now);
      let demoMode = false;

      // Hors période d'événement ET sans date forcée → on rejoue le jeudi à
      // l'heure courante, pour que le widget reste démontrable hors événement.
      if (!userProvided) {
        const first = new Date(`${eventDates[0]}T00:00:00+02:00`).getTime();
        const last = new Date(`${eventDates[eventDates.length - 1]}T23:59:59+02:00`).getTime();
        const t = instant.getTime();
        if (t < first || t > last) {
          const jeudi = program.days.find((d) => d.weekday === "jeudi") ?? program.days[1] ?? program.days[0];
          const { time } = parisParts(instant);
          instant = parseEuropeParis(jeudi.date, time);
          demoMode = true;
        }
      }

      const current = sessionsAt(instant).map(publicSession);
      const upcoming = nextSessions(instant).map(publicSession);
      const result = {
        now: instant.toISOString(),
        demoMode,
        current,
        upcoming,
        eventDates,
        theme: program.theme,
      };
      return { content: [textBlock(asJson(result))], structuredContent: result };
    },
  );

  //========== TOOL — conf_a_telle_heure ==========//
  server.registerTool(
    "conf_a_telle_heure",
    {
      title: "Sessions à une heure donnée",
      description:
        "Renvoie les sessions qui se déroulent à une heure précise d'un jour donné du BreizhCamp.",
      inputSchema: {
        jour: z.number().int().min(1).max(3).describe("Numéro du jour (1 = mercredi, 2 = jeudi, 3 = vendredi)"),
        heure: z
          .string()
          .regex(/^\d{1,2}:\d{2}$/)
          .describe("Heure au format HH:MM (Europe/Paris), par exemple 14:30"),
      },
      annotations: READ_ONLY,
    },
    async ({ jour, heure }) => {
      const day = getDayByNumber(jour);
      if (!day) {
        return { isError: true, content: [textBlock(`Jour ${jour} inconnu.`)] };
      }
      const hh = heure.padStart(5, "0");
      const instant = parseEuropeParis(day.date, hh);
      const sessions = sessionsAt(instant).map(publicSession);
      const result = { day: jour, date: day.date, weekday: day.weekday, time: hh, sessions };
      return { content: [textBlock(asJson(result))], structuredContent: result };
    },
  );

  //========== TOOL — detail_conference (widget) ==========//
  registerAppTool(
    server,
    "detail_conference",
    {
      title: "Détail d'une conférence",
      description:
        "Renvoie tous les détails d'une session : titre, abstract, format, thématique, niveau, salle, horaire, et les fiches complètes de ses speakers (bio incluse). Renvoie un widget visuel.",
      inputSchema: {
        id: z
          .string()
          .describe(
            "Identifiant de la session tel qu'utilisé sur breizhcamp.org (ex. \"1127844\"). Récupérable via `programme_du_jour` ou `recherche_conference`.",
          ),
      },
      annotations: READ_ONLY,
      _meta: {
        ui: { resourceUri: URI_CONF_CARD },
      },
    },
    async ({ id }) => {
      const sess = findSessionById(id);
      if (!sess) {
        return {
          isError: true,
          content: [textBlock(`Session "${id}" introuvable.`)],
        };
      }
      const session = publicSession(sess);
      const speakers = (sess.speakerIds ?? [])
        .map((sid) => findSpeakerById(sid))
        .filter((sp): sp is Speaker => Boolean(sp))
        .map(publicSpeaker);
      const result = { session, speakers };
      return { content: [textBlock(asJson(result))], structuredContent: result };
    },
  );

  //========== TOOL — fiche_speaker (widget) ==========//
  registerAppTool(
    server,
    "fiche_speaker",
    {
      title: "Fiche d'un speaker",
      description:
        "Renvoie la fiche complète d'un speaker (bio, photo) et la liste de ses talks au BreizhCamp. Recherche par identifiant interne ou par nom (recherche tolérante).",
      inputSchema: {
        id_ou_nom: z
          .string()
          .describe(
            "Identifiant interne du speaker (ex. \"thibaut-cantet\") ou nom du speaker (ex. \"Thibaut Cantet\").",
          ),
      },
      annotations: READ_ONLY,
      _meta: {
        ui: { resourceUri: URI_SPEAKER_CARD },
      },
    },
    async ({ id_ou_nom }) => {
      const sp = findSpeakerById(id_ou_nom) ?? findSpeakerByName(id_ou_nom);
      if (!sp) {
        return {
          isError: true,
          content: [textBlock(`Speaker "${id_ou_nom}" introuvable.`)],
        };
      }
      const speaker = publicSpeaker(sp);
      return { content: [textBlock(asJson({ speaker }))], structuredContent: { speaker } };
    },
  );

  //========== TOOL — recherche_conference ==========//
  server.registerTool(
    "recherche_conference",
    {
      title: "Recherche de conférence",
      description:
        "Recherche libre dans le programme BreizhCamp : titres, abstracts, thématiques, niveaux, formats, salles, et noms de speakers. Renvoie jusqu'à 20 résultats triés par pertinence.",
      inputSchema: {
        requete: z
          .string()
          .min(2)
          .describe("Texte libre (mots-clés). Ex. \"IA\", \"kubernetes\", \"sécurité\", \"accessibilité\"."),
      },
      annotations: READ_ONLY,
    },
    async ({ requete }) => {
      const matches = searchSessions(requete).map(publicSession);
      const result = { requete, count: matches.length, sessions: matches };
      return { content: [textBlock(asJson(result))], structuredContent: result };
    },
  );

  //========== TOOL — liste_speakers ==========//
  server.registerTool(
    "liste_speakers",
    {
      title: "Liste de tous les speakers",
      description:
        "Renvoie la liste de tous les speakers du BreizhCamp (id, nom, photo). À utiliser pour parcourir l'ensemble des intervenants.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const speakers = Object.values(getProgram().speakers)
        .map(publicSpeakerSummary)
        .sort((a, b) => a.name.localeCompare(b.name, "fr"));
      const result = { count: speakers.length, speakers };
      return { content: [textBlock(asJson(result))], structuredContent: result };
    },
  );

  //========== TOOL — liste_sponsors ==========//
  server.registerTool(
    "liste_sponsors",
    {
      title: "Liste des sponsors",
      description:
        "Renvoie la liste des sponsors et partenaires du BreizhCamp, groupée par tier (Platinum, Gold, Silver, Bronze, Partenaires). Filtre optionnel par tier.",
      inputSchema: {
        tier: z
          .string()
          .optional()
          .describe(
            "Filtre optionnel par tier (insensible à la casse, ex. \"platinum\", \"gold\", \"silver\", \"bronze\"). Sans filtre, renvoie tous les sponsors.",
          ),
      },
      annotations: READ_ONLY,
    },
    async ({ tier }) => {
      const all = getProgram().info.partners;
      const filtered = tier ? all.filter((p) => normalize(p.tier) === normalize(tier)) : all;
      const order: string[] = [];
      const byTier: Record<string, typeof all> = {};
      for (const p of filtered) {
        if (!byTier[p.tier]) {
          byTier[p.tier] = [];
          order.push(p.tier);
        }
        byTier[p.tier].push(p);
      }
      const result = {
        count: filtered.length,
        tiers: order.map((t) => ({ tier: t, sponsors: byTier[t] })),
      };
      return { content: [textBlock(asJson(result))], structuredContent: result };
    },
  );

  //========== TOOL — liste_equipe ==========//
  server.registerTool(
    "liste_equipe",
    {
      title: "Équipe organisatrice du BreizhCamp",
      description:
        "Renvoie la composition de l'équipe du BreizhCamp : sections (Organisation, Comité programme, Association) avec leurs membres, et les user groups partenaires (BreizhJUG, Rennes JS, etc.) avec leurs organisateurs.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const team = getProgram().info.team;
      const result = {
        sections: team.sections.map((s) => ({
          key: s.key,
          title: s.title,
          count: s.members.length,
          members: s.members,
        })),
        userGroups: team.userGroups,
        source: team.source,
      };
      return { content: [textBlock(asJson(result))], structuredContent: result };
    },
  );

  //========== TOOL — fiche_membre (widget) ==========//
  registerAppTool(
    server,
    "fiche_membre",
    {
      title: "Fiche d'un membre de l'équipe",
      description:
        "Renvoie la fiche d'un membre de l'équipe organisatrice du BreizhCamp (Organisation, Comité programme, Association, ou organisateur d'un user group) : nom, rôle/section, photo, liens. Recherche par identifiant ou par nom (tolérante).",
      inputSchema: {
        id_ou_nom: z
          .string()
          .describe("Identifiant interne du membre (ex. \"laurent-huet\") ou son nom (ex. \"Laurent Huet\")."),
      },
      annotations: READ_ONLY,
      _meta: {
        ui: { resourceUri: URI_ORGA_CARD },
      },
    },
    async ({ id_ou_nom }) => {
      const member = findTeamPerson(id_ou_nom);
      if (!member) {
        return {
          isError: true,
          content: [textBlock(`Membre de l'équipe "${id_ou_nom}" introuvable.`)],
        };
      }
      const organizer = publicMember(member);
      return {
        content: [textBlock(asJson({ organizer }))],
        structuredContent: { organizer },
      };
    },
  );

  //========== RESOURCES — widgets MCP App ==========//
  const widgetResource = async (uri: string, file: string) => {
    const html = await fs.readFile(path.join(DIST_DIR, file), "utf-8");
    return {
      contents: [
        {
          uri,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
          _meta: {
            ui: { csp: WIDGET_CSP },
          },
        },
      ],
    };
  };

  registerAppResource(
    server,
    "Fiche conférence",
    URI_CONF_CARD,
    { _meta: { ui: { csp: WIDGET_CSP } } },
    () => widgetResource(URI_CONF_CARD, "client/conf-card.html"),
  );
  registerAppResource(
    server,
    "Conférences en cours & à suivre",
    URI_NOW_NEXT,
    { _meta: { ui: { csp: WIDGET_CSP } } },
    () => widgetResource(URI_NOW_NEXT, "client/now-next.html"),
  );
  registerAppResource(
    server,
    "Fiche speaker",
    URI_SPEAKER_CARD,
    { _meta: { ui: { csp: WIDGET_CSP } } },
    () => widgetResource(URI_SPEAKER_CARD, "client/speaker-card.html"),
  );
  registerAppResource(
    server,
    "Fiche membre de l'équipe",
    URI_ORGA_CARD,
    { _meta: { ui: { csp: WIDGET_CSP } } },
    () => widgetResource(URI_ORGA_CARD, "client/orga-card.html"),
  );

  return server;
}
