import { App } from "@modelcontextprotocol/ext-apps";
import "./shared.css";
import {
  el,
  emptyState,
  formatTime,
  frenchDate,
  tag,
  type SessionPublic,
} from "./shared.ts";

const app = new App(
  { name: "breizhcamp-now-next", version: "1.0.0" },
  {},
  { autoResize: true },
);

app.connect();

const root = document.getElementById("app")!;

interface Payload {
  now: string;
  demoMode?: boolean;
  current: SessionPublic[];
  upcoming: SessionPublic[];
  eventDates: string[];
  theme?: string;
}

function sessionCard(s: SessionPublic, variant: "live" | "upcoming"): HTMLElement {
  const card = el("div", { class: `bz-card ${variant}` });

  const head = el(
    "div",
    {
      style:
        "display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap;",
    },
    [
      el("span", { class: "bz-time" }, [formatTime(s.startTime, s.endTime)]),
      s.room ? tag(s.room, "room") : null,
    ],
  );
  card.appendChild(head);

  card.appendChild(
    el("p", { style: "margin:6px 0 0;font-weight:600;font-size:14px;line-height:1.3;" }, [s.title]),
  );

  if (s.track) {
    card.appendChild(el("div", { style: "margin-top:6px;" }, [tag(s.track, "track")]));
  }

  if (s.speakers?.length) {
    const names = s.speakers.map((sp) => sp.name).join(", ");
    card.appendChild(el("p", { class: "bz-speakers-line" }, [`▸ ${names}`]));
  }

  return card;
}

function isInEventWindow(now: Date, eventDates: string[]): boolean {
  if (eventDates.length === 0) return false;
  const first = new Date(`${eventDates[0]}T00:00:00+02:00`).getTime();
  const last = new Date(`${eventDates[eventDates.length - 1]}T23:59:59+02:00`).getTime();
  return now.getTime() >= first && now.getTime() <= last;
}

function render(p: Payload) {
  root.innerHTML = "";
  const container = el("div", { class: "bz-app" });

  const nowDate = new Date(p.now);
  const inWindow = isInEventWindow(nowDate, p.eventDates);
  const demo = Boolean(p.demoMode);

  const clock = nowDate.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  });
  const dateLabel = frenchDate(
    new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(nowDate),
  );

  const title = demo ? "BreizhCamp — aperçu" : inWindow ? "BreizhCamp en direct" : "BreizhCamp";
  const subtitle = demo
    ? `Mode démo · ${dateLabel} · ${clock}`
    : inWindow
      ? `${dateLabel} · ${clock}`
      : "Hors période d'événement";

  container.appendChild(
    el("div", { class: "bz-header" }, [
      el("div", {}, [
        el(
          "h1",
          { class: "bz-title" },
          [
            (inWindow && !demo) ? el("span", { class: "bz-live-dot", style: "margin-right:8px;" }) : null,
            title,
          ],
        ),
        el("p", { class: "bz-subtitle" }, [subtitle]),
      ]),
    ]),
  );

  if (p.current.length > 0) {
    container.appendChild(
      el("p", { class: "bz-section-title", style: "margin-top:14px;" }, ["// En cours"]),
    );
    const grid = el("div", { class: "bz-grid" });
    for (const s of p.current) grid.appendChild(sessionCard(s, "live"));
    container.appendChild(grid);
  }

  if (p.upcoming.length > 0) {
    container.appendChild(
      el("p", { class: "bz-section-title", style: "margin-top:14px;" }, ["// Prochainement"]),
    );
    const grid = el("div", { class: "bz-grid" });
    for (const s of p.upcoming) grid.appendChild(sessionCard(s, "upcoming"));
    container.appendChild(grid);
  }

  if (p.current.length === 0 && p.upcoming.length === 0) {
    container.appendChild(
      emptyState(
        inWindow
          ? "Aucune session prévue à cette heure."
          : "Le BreizhCamp n'a pas encore commencé (ou est terminé). Explore les jours via les outils du serveur.",
      ),
    );
  }

  root.appendChild(container);
}

app.ontoolresult = (result: any) => {
  const sc = result?.structuredContent;
  if (!sc) {
    root.appendChild(emptyState("Aucune donnée à afficher."));
    return;
  }
  render(sc as Payload);
};
