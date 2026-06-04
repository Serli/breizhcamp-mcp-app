import { App } from "@modelcontextprotocol/ext-apps";
import "./shared.css";
import {
  defaultAvatar,
  el,
  emptyState,
  speakerLinkPill,
  tag,
  type SpeakerLink,
} from "./shared.ts";

interface Organizer {
  id: string;
  name: string;
  role: string | null;
  photoUrl: string | null;
  links: SpeakerLink[];
}

const app = new App(
  { name: "breizhcamp-orga-card", version: "1.0.0" },
  {},
  { autoResize: true },
);

app.connect();

const root = document.getElementById("app")!;

function render(o: Organizer) {
  root.innerHTML = "";
  const container = el("div", { class: "bz-app" });

  container.appendChild(
    el("div", { style: "display:flex;gap:14px;align-items:center;" }, [
      el("img", {
        class: "bz-speaker-photo lg",
        src: o.photoUrl ?? defaultAvatar(o.name),
        alt: o.name,
      }),
      el("div", {}, [
        el("p", {
          class: "bz-subtitle",
          style: "margin:0 0 4px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:var(--bz-accent);",
        }, ["Équipe BreizhCamp"]),
        el("h1", { class: "bz-title" }, [o.name]),
        o.role ? el("div", { style: "margin-top:6px;" }, [tag(o.role, "track")]) : null,
      ]),
    ]),
  );

  if (o.links?.length) {
    const section = el("div", { class: "bz-section" }, [
      el("p", { class: "bz-section-title" }, ["Liens"]),
    ]);
    const pills = el("div", { class: "bz-link-pills" });
    for (const l of o.links) pills.appendChild(speakerLinkPill(l));
    section.appendChild(pills);
    container.appendChild(section);
  }

  container.appendChild(
    el("p", { class: "bz-subtitle", style: "margin-top:14px;" }, [
      "Toute l'équipe sur ",
      el("a", {
        class: "bz-link",
        href: "https://www.breizhcamp.org/equipe",
        target: "_blank",
        rel: "noopener noreferrer",
      }, ["breizhcamp.org/equipe"]),
    ]),
  );

  root.appendChild(container);
}

app.ontoolresult = (result: any) => {
  const sc = result?.structuredContent;
  if (!sc?.organizer) {
    root.appendChild(emptyState("Aucun membre à afficher."));
    return;
  }
  render(sc.organizer as Organizer);
};
