import { App } from "@modelcontextprotocol/ext-apps";
import "./shared.css";
import {
  defaultAvatar,
  el,
  emptyState,
  formatTime,
  frenchDate,
  markdownToElement,
  speakerLinkPill,
  tag,
  type Speaker,
} from "./shared.ts";

const app = new App(
  { name: "breizhcamp-speaker-card", version: "1.0.0" },
  {},
  { autoResize: true },
);

app.connect();

const root = document.getElementById("app")!;

function render(sp: Speaker) {
  root.innerHTML = "";
  const container = el("div", { class: "bz-app" });

  container.appendChild(
    el("div", { style: "display:flex;gap:14px;align-items:center;" }, [
      el("img", {
        class: "bz-speaker-photo lg",
        src: sp.photoUrl ?? defaultAvatar(sp.name),
        alt: sp.name,
      }),
      el("div", {}, [
        el("h1", { class: "bz-title" }, [sp.name]),
        sp.title || sp.company
          ? el("p", { class: "bz-subtitle" }, [
              [sp.title, sp.company].filter(Boolean).join(" — "),
            ])
          : null,
      ]),
    ]),
  );

  const bioEl = markdownToElement(sp.bio);
  if (bioEl) {
    container.appendChild(
      el("div", { class: "bz-section" }, [
        el("p", { class: "bz-section-title" }, ["Bio"]),
        bioEl,
      ]),
    );
  }

  if (sp.links?.length) {
    const section = el("div", { class: "bz-section" }, [
      el("p", { class: "bz-section-title" }, ["Liens"]),
    ]);
    const pills = el("div", { class: "bz-link-pills" });
    for (const l of sp.links) pills.appendChild(speakerLinkPill(l));
    section.appendChild(pills);
    container.appendChild(section);
  }

  if (sp.talks?.length) {
    const section = el("div", { class: "bz-section" }, [
      el("p", { class: "bz-section-title" }, [
        sp.talks.length > 1 ? "Talks au BreizhCamp" : "Talk au BreizhCamp",
      ]),
    ]);
    const grid = el("div", { class: "bz-grid" });
    for (const t of sp.talks) {
      const card = el("div", { class: "bz-card upcoming" });
      card.appendChild(
        el("p", { class: "bz-time" }, [
          `Jour ${t.day} · ${frenchDate(t.date)} · ${formatTime(t.startTime, t.endTime)}`,
        ]),
      );
      card.appendChild(
        el("p", { style: "margin:6px 0 0;font-weight:600;font-size:14px;line-height:1.3;" }, [t.title]),
      );
      const tags = el("div", { style: "margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;" });
      if (t.room) tags.appendChild(tag(t.room, "room"));
      if (t.track) tags.appendChild(tag(t.track, "track"));
      card.appendChild(tags);
      grid.appendChild(card);
    }
    section.appendChild(grid);
    container.appendChild(section);
  }

  if (sp.url) {
    container.appendChild(
      el("p", { class: "bz-subtitle", style: "margin-top:14px;" }, [
        "Profil sur ",
        el("a", {
          class: "bz-link",
          href: sp.url,
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
  if (!sc?.speaker) {
    root.appendChild(emptyState("Aucun speaker à afficher."));
    return;
  }
  render(sc.speaker as Speaker);
};
