import fs from "node:fs";
import path from "node:path";

export interface SpeakerLink {
  type: "twitter" | "linkedin" | "github" | "bluesky" | "mastodon" | "website" | "other";
  url: string;
}

export interface Speaker {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  city: string | null;
  photoUrl: string | null;
  bio: string | null;
  links: SpeakerLink[];
  url: string | null;
}

export interface Session {
  order: number;
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  room: string | null;
  track: string | null;
  level: string | null;
  type: string; // talk | keynote | quickie | workshop | break
  format: string | null;
  tags: string[];
  abstract: string | null;
  language: string | null;
  url: string;
  speakerIds: string[];
}

export interface Day {
  day: number;
  date: string;
  weekday: string;
  label: string;
  sessions: Session[];
}

export interface FaqEntry {
  question: string;
  answer: string;
}

export interface VenueInfo {
  name: string | null;
  description: string | null;
  access: { title: string; description: string }[];
}

export interface Partner {
  name: string;
  url: string | null;
  tier: string;
  logoUrl: string | null;
}

export interface TeamMember {
  id: string;
  name: string;
  photoUrl: string | null;
}

export interface UserGroupOrganizer {
  name: string;
  photoUrl: string | null;
  social: { type: string; url: string } | null;
}

export interface UserGroup {
  name: string;
  logoUrl: string | null;
  url: string | null;
  text: string | null;
  organizers: UserGroupOrganizer[];
}

export interface TeamSection {
  key: string;
  title: string;
  members: TeamMember[];
}

export interface Team {
  sections: TeamSection[];
  userGroups: UserGroup[];
  source: string;
}

export interface Stat {
  label: string;
  value: string;
}

export interface BreizhCampInfo {
  tagline: string | null;
  headline: string | null;
  dates: string;
  stats: Stat[];
  themes: string[];
  about: string | null;
  venue: VenueInfo;
  partners: Partner[];
  team: Team;
  faq: FaqEntry[];
  sources: Record<string, string>;
}

export interface Program {
  event: string;
  edition: number;
  theme: string;
  location: string;
  city: string;
  website: string;
  timezone: string;
  info: BreizhCampInfo;
  days: Day[];
  speakers: Record<string, Speaker>;
}

const PROGRAM_PATH = path.join(import.meta.dirname, "../data/program.json");
let cached: Program | null = null;

export function getProgram(): Program {
  if (!cached) {
    const raw = fs.readFileSync(PROGRAM_PATH, "utf-8");
    cached = JSON.parse(raw) as Program;
  }
  return cached;
}

export function getAllSessions(): Array<Session & { dayNumber: number; date: string; weekday: string }> {
  const program = getProgram();
  const out: Array<Session & { dayNumber: number; date: string; weekday: string }> = [];
  for (const day of program.days) {
    for (const s of day.sessions) {
      out.push({ ...s, dayNumber: day.day, date: day.date, weekday: day.weekday });
    }
  }
  return out;
}

export function findSessionById(id: string): (Session & { dayNumber: number; date: string; weekday: string }) | undefined {
  return getAllSessions().find((s) => s.id === id);
}

export function findSpeakerById(id: string): Speaker | undefined {
  return getProgram().speakers[id];
}

export function findSpeakerByName(name: string): Speaker | undefined {
  const norm = normalize(name);
  const speakers = Object.values(getProgram().speakers);
  return (
    speakers.find((s) => normalize(s.name) === norm) ??
    speakers.find((s) => normalize(s.name).includes(norm) || norm.includes(normalize(s.name)))
  );
}

export interface TeamPerson {
  id: string;
  name: string;
  role: string | null;
  photoUrl: string | null;
  links: SpeakerLink[];
}

/** Tous les membres de l'équipe + organisateurs de user groups, à plat. */
export function getTeamPeople(): TeamPerson[] {
  const team = getProgram().info.team;
  const out: TeamPerson[] = [];
  const byId = new Map<string, TeamPerson>();
  const add = (p: TeamPerson) => {
    const existing = byId.get(p.id);
    if (existing) {
      if (!existing.role && p.role) existing.role = p.role;
      if (!existing.photoUrl && p.photoUrl) existing.photoUrl = p.photoUrl;
      for (const l of p.links) if (!existing.links.some((x) => x.url === l.url)) existing.links.push(l);
      return;
    }
    byId.set(p.id, p);
    out.push(p);
  };
  for (const section of team.sections) {
    for (const m of section.members) {
      add({ id: m.id, name: m.name, role: section.title, photoUrl: m.photoUrl, links: [] });
    }
  }
  for (const g of team.userGroups) {
    for (const o of g.organizers) {
      add({
        id: normalize(o.name).replace(/\s+/g, "-"),
        name: o.name,
        role: g.name,
        photoUrl: o.photoUrl,
        links: o.social ? [{ type: linkType(o.social.type), url: o.social.url }] : [],
      });
    }
  }
  return out;
}

export function findTeamPerson(idOrName: string): TeamPerson | undefined {
  const all = getTeamPeople();
  const norm = normalize(idOrName);
  return (
    all.find((m) => m.id === idOrName) ??
    all.find((m) => normalize(m.name) === norm) ??
    all.find((m) => normalize(m.name).includes(norm) || norm.includes(normalize(m.name)))
  );
}

function linkType(t: string): SpeakerLink["type"] {
  const v = t.toLowerCase();
  if (v.includes("twitter") || v === "x") return "twitter";
  if (v.includes("linkedin")) return "linkedin";
  if (v.includes("github")) return "github";
  if (v.includes("bluesky") || v.includes("bsky")) return "bluesky";
  if (v.includes("mastodon")) return "mastodon";
  if (v.includes("web") || v.includes("site") || v.includes("blog")) return "website";
  return "other";
}

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

/** Parse "YYYY-MM-DD" + "HH:MM" interprété en Europe/Paris (UTC+2 en juin). */
export function parseEuropeParis(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+02:00`);
}

export function sessionStart(s: Session & { date: string }): Date {
  return parseEuropeParis(s.date, s.startTime);
}

export function sessionEnd(s: Session & { date: string }): Date {
  return parseEuropeParis(s.date, s.endTime);
}

/** Sessions en cours à l'instant donné. */
export function sessionsAt(instant: Date): Array<Session & { dayNumber: number; date: string; weekday: string }> {
  return getAllSessions().filter((s) => {
    if (s.startTime.includes("?")) return false;
    const start = sessionStart(s);
    const end = sessionEnd(s);
    return instant >= start && instant < end;
  });
}

/** Prochaines sessions (hors pauses) démarrant strictement après l'instant. */
export function nextSessions(instant: Date): Array<Session & { dayNumber: number; date: string; weekday: string }> {
  const upcoming = getAllSessions()
    .filter((s) => s.type !== "break" && !s.startTime.includes("?") && sessionStart(s) > instant)
    .sort((a, b) => sessionStart(a).getTime() - sessionStart(b).getTime());
  if (upcoming.length === 0) return [];
  const firstTime = sessionStart(upcoming[0]).getTime();
  return upcoming.filter((s) => sessionStart(s).getTime() === firstTime);
}

export function getDayByNumber(n: number): Day | undefined {
  return getProgram().days.find((d) => d.day === n);
}

export function searchSessions(query: string): Array<Session & { dayNumber: number; date: string; weekday: string }> {
  const q = normalize(query);
  if (!q) return [];
  const all = getAllSessions().filter((s) => s.type !== "break");
  const terms = q.split(" ").filter(Boolean);
  return all
    .map((s) => {
      const fields = [
        s.title,
        s.abstract ?? "",
        (s.tags ?? []).join(" "),
        s.track ?? "",
        s.format ?? "",
        s.room ?? "",
      ].join(" ");
      const speakerNames = (s.speakerIds ?? [])
        .map((id) => findSpeakerById(id)?.name ?? "")
        .join(" ");
      const haystackWords = new Set(normalize(`${fields} ${speakerNames}`).split(" "));
      const titleWords = new Set(normalize(s.title).split(" "));
      let score = 0;
      for (const term of terms) {
        if (titleWords.has(term)) score += 3;
        else if (haystackWords.has(term)) score += 1;
        else if (term.length >= 4) {
          const joined = [...haystackWords].join(" ");
          if (joined.includes(term)) score += 0.5;
        }
      }
      return { session: s, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((r) => r.session);
}
