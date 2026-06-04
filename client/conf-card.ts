import { App } from "@modelcontextprotocol/ext-apps";
import "./shared.css";
import {
  el,
  emptyState,
  formatTime,
  frenchDate,
  markdownToElement,
  speakerCard,
  speakerLinkPill,
  tag,
  type SessionPublic,
  type Speaker,
} from "./shared.ts";

const app = new App(
  { name: "breizhcamp-conf-card", version: "1.0.0" },
  {},
  { autoResize: true },
);

app.connect();

const root = document.getElementById("app")!;

function render(session: SessionPublic, speakers: Speaker[]) {
  root.innerHTML = "";
  const container = el("div", { class: "bz-app" });

  container.appendChild(
    el("div", { class: "bz-header" }, [
      el("div", {}, [
        el("p", { class: "bz-subtitle" }, [
          `Jour ${session.day} · ${frenchDate(session.date)} · ${formatTime(session.startTime, session.endTime)}`,
        ]),
      ]),
    ]),
  );

  container.appendChild(el("h1", { class: "bz-title" }, [session.title]));

  const meta = el("div", { class: "bz-meta" });
  if (session.room) meta.appendChild(tag(session.room, "room"));
  if (session.track) meta.appendChild(tag(session.track, "track"));
  if (session.format) meta.appendChild(tag(session.format));
  if (session.level) meta.appendChild(tag(session.level, "level"));
  if (session.language) meta.appendChild(tag(session.language));
  container.appendChild(meta);

  if (session.abstract && session.abstract.trim()) {
    container.appendChild(
      el("div", { class: "bz-section" }, [
        el("p", { class: "bz-section-title" }, ["Description"]),
        el("div", { class: "bz-abstract" }, [session.abstract]),
      ]),
    );
  }

  if (speakers.length > 0) {
    const speakersSection = el("div", { class: "bz-section" }, [
      el("p", { class: "bz-section-title" }, [
        speakers.length > 1 ? "Orateur·ices" : "Orateur·ice",
      ]),
    ]);
    const grid = el("div", { class: "bz-grid" });
    for (const sp of speakers) {
      const card = el("div", { class: "bz-card" });
      card.appendChild(speakerCard(sp));
      const bioEl = markdownToElement(sp.bio);
      if (bioEl) {
        bioEl.classList.add("compact");
        bioEl.style.marginTop = "10px";
        bioEl.style.fontSize = "12px";
        bioEl.style.color = "var(--bz-text-muted)";
        card.appendChild(bioEl);
      }
      if (sp.links?.length) {
        const pills = el("div", { class: "bz-link-pills", style: "margin-top:8px;" });
        for (const l of sp.links) pills.appendChild(speakerLinkPill(l));
        card.appendChild(pills);
      }
      grid.appendChild(card);
    }
    speakersSection.appendChild(grid);
    container.appendChild(speakersSection);
  }

  if (session.url) {
    container.appendChild(
      el("p", { class: "bz-subtitle", style: "margin-top:14px;" }, [
        "Fiche complète sur ",
        el("a", {
          class: "bz-link",
          href: session.url,
          target: "_blank",
          rel: "noopener noreferrer",
        }, ["breizhcamp.org"]),
      ]),
    );
  }

  root.appendChild(container);
}

app.ontoolresult = (result: any) => {
  const sc = result?.structuredContent;
  if (!sc || !sc.session) {
    root.appendChild(emptyState("Aucune conférence à afficher."));
    return;
  }
  render(sc.session as SessionPublic, (sc.speakers ?? []) as Speaker[]);
};
