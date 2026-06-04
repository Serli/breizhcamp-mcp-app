import { marked } from "marked";

marked.use({
  breaks: true,
  gfm: true,
});

/** Rend du markdown de confiance (scrapé sur breizhcamp.org) dans un .bz-md. */
export function markdownToElement(md: string | null | undefined): HTMLElement | null {
  if (!md || !md.trim()) return null;
  const html = marked.parse(md, { async: false }) as string;
  const div = document.createElement("div");
  div.className = "bz-md";
  div.innerHTML = html;
  for (const a of div.querySelectorAll("a")) {
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  }
  return div;
}

export interface SpeakerSummary {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  city: string | null;
  photoUrl: string | null;
  url: string | null;
}

export interface SpeakerLink {
  type: "twitter" | "linkedin" | "github" | "bluesky" | "mastodon" | "website" | "other";
  url: string;
}

export interface Speaker extends SpeakerSummary {
  bio: string | null;
  links: SpeakerLink[];
  talks: Array<{
    id: string;
    title: string;
    day: number;
    date: string;
    weekday: string;
    startTime: string;
    endTime: string;
    room: string | null;
    track: string | null;
  }>;
}

export interface SessionPublic {
  id: string;
  title: string;
  day: number;
  date: string;
  weekday: string;
  startTime: string;
  endTime: string;
  room: string | null;
  track: string | null;
  level: string | null;
  type: string;
  format: string | null;
  language: string | null;
  tags: string[];
  abstract: string | null;
  url: string | null;
  speakers: SpeakerSummary[];
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Partial<Record<string, string>> = {},
  children: Array<Node | string | null | undefined> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

export function formatTime(start: string, end: string): string {
  return `${start} – ${end}`;
}

export function frenchDate(date: string): string {
  try {
    const d = new Date(`${date}T12:00:00`);
    return d.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  } catch {
    return date;
  }
}

const LINK_ICONS: Record<string, string> = {
  twitter: "𝕏",
  linkedin: "in",
  github: "GH",
  bluesky: "BS",
  mastodon: "🐘",
  website: "🌐",
  other: "↗",
};

export function speakerLinkPill(link: SpeakerLink): HTMLElement {
  return el(
    "a",
    {
      class: "bz-link-pill",
      href: link.url,
      target: "_blank",
      rel: "noopener noreferrer",
    },
    [`${LINK_ICONS[link.type] ?? "↗"} ${link.type}`],
  );
}

export function speakerCard(s: SpeakerSummary): HTMLElement {
  const photo = el("img", {
    class: "bz-speaker-photo",
    src: s.photoUrl ?? defaultAvatar(s.name),
    alt: s.name,
    loading: "lazy",
  });
  const info = el("div", {}, [
    el("p", { class: "bz-speaker-name" }, [s.name]),
    s.title || s.company
      ? el("p", { class: "bz-speaker-role" }, [
          [s.title, s.company].filter(Boolean).join(" — "),
        ])
      : null,
  ]);
  const attrs: Record<string, string> = {
    class: "bz-speaker",
    style: "text-decoration:none;color:inherit;",
  };
  if (s.url) {
    attrs.href = s.url;
    attrs.target = "_blank";
    attrs.rel = "noopener noreferrer";
  }
  return el(s.url ? "a" : "div", attrs, [photo, info]);
}

export function defaultAvatar(name: string): string {
  const initials = encodeURIComponent(
    name
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase(),
  );
  return `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='80' height='80' fill='%23071509'/><text x='50%25' y='55%25' fill='%2300ff41' font-family='monospace' font-size='28' font-weight='700' text-anchor='middle'>${initials}</text></svg>`;
}

export function tag(text: string, cls = ""): HTMLElement {
  return el("span", { class: `bz-tag ${cls}`.trim() }, [text]);
}

export function emptyState(message: string): HTMLElement {
  return el("div", { class: "bz-empty" }, [message]);
}
