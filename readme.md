# BreizhCamp MCP

Serveur [MCP](https://modelcontextprotocol.io/) (Model Context Protocol) qui expose le programme du [BreizhCamp 2026](https://www.breizhcamp.org/) (Rennes, 24–26 juin, campus de Beaulieu — thème **Matrix**) à un client MCP (ChatGPT, Claude Desktop, etc.). Il fournit des outils pour explorer le programme, savoir quelle conf est en cours, consulter les fiches sessions et speakers, les sponsors et l'équipe, et un jeu de widgets visuels (MCP App) au thème Matrix (vert néon sur fond noir).

Runtime : **Bun** (cible Clever Cloud).

## Outils MCP exposés

| Outil | Description | Widget |
|---|---|---|
| `infos_breizhcamp` | Vue d'ensemble : édition, thème, dates, lieu, chiffres clés, thématiques, présentation, lieu & accès, FAQ | — |
| `liste_jours` | Liste les jours de l'événement (mercredi, jeudi, vendredi) | — |
| `programme_du_jour` | Programme complet d'un jour (sessions, keynotes, ateliers, pauses) | — |
| `conf_en_cours` | Sessions en cours + prochaines, par salle | ✅ now-next |
| `conf_a_telle_heure` | Sessions à une heure donnée d'un jour donné | — |
| `detail_conference` | Détail d'une session (abstract, format, niveau, salle, speakers) | ✅ conf-card |
| `fiche_speaker` | Fiche complète d'un speaker (bio, talks) | ✅ speaker-card |
| `recherche_conference` | Recherche libre dans le programme | — |
| `liste_speakers` | Liste de tous les speakers | — |
| `liste_sponsors` | Sponsors groupés par tier (Platinum, Gold, Silver, Bronze), filtre optionnel | — |
| `liste_equipe` | Équipe : Organisation, Comité programme, Association, user groups | — |
| `fiche_membre` | Fiche d'un membre de l'équipe organisatrice | ✅ orga-card |

Les outils marqués widget renvoient une `structuredContent` accompagnée d'un `resourceUri` pointant vers une mini-app HTML embarquée (bundle vite single-file).

### Mode démo (hors événement)

Tant que la date courante n'est pas dans la fenêtre de l'événement, `conf_en_cours` rejoue **le jeudi (25 juin 2026) à l'heure courante** — pratique pour tester/démontrer le widget en dehors de l'événement. Fournir explicitement le paramètre `now` désactive ce comportement.

## Pré-requis

- [Bun](https://bun.sh) ≥ 1.1 (`curl -fsSL https://bun.sh/install | bash`)

## Installation

```bash
bun install
```

Le `postinstall` lance automatiquement `bun run build` qui bundle les 4 widgets dans `dist/client/`.

## Lancer en local

### Serveur en production

```bash
bun run start
```

Le serveur écoute sur `http://localhost:3000/mcp`.

### Mode dev (hot-reload du serveur ET des widgets)

```bash
bun run start:dev
```

### Mode dev + Inspector (tout-en-un)

```bash
bun run dev
```

Lance `start:dev` puis ouvre le [MCP Inspector](https://github.com/modelcontextprotocol/inspector). Dans l'inspector : transport **Streamable HTTP**, URL `http://localhost:3000/mcp`, **Connect**.

## Connecter un client MCP

### ChatGPT (MCP App)

Paramètres ChatGPT (section MCP / Apps) → ajouter un serveur : transport Streamable HTTP, URL `https://<ton-host>/mcp` (ou `http://localhost:3000/mcp` en local).

### Claude Desktop / Codex CLI

```json
{
  "mcpServers": {
    "breizhcamp": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

## Configuration

| Variable | Défaut | Description |
|---|---|---|
| `PORT` | `3000` | Port d'écoute |
| `NODE_ENV` | — | `development` ⇒ écoute sur `127.0.0.1`, sinon `0.0.0.0` |
| `CORS_ORIGIN` | `*` | Origine autorisée |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Fenêtre du rate limiting |
| `RATE_LIMIT_MAX` | `100` | Max requêtes/IP par fenêtre |
| `TRUST_PROXY` | — | Express `trust proxy` (requis derrière un reverse-proxy, ex. Clever) |

## Données

Toutes les données sont figées dans `data/program.json` (snapshot du site officiel scrapé une fois). Pour rebuild **entièrement** ce fichier à partir du site :

```bash
bun run refresh-data
```

Le script `scripts/refresh-data.ts` (le site est une app **SvelteKit**) :

1. Fetch `/programme/{mercredi,jeudi,vendredi}` → parse les `<article>` (rooms, horaires, thématiques, niveaux, durées, speakers).
2. Fetch les ~95 fiches `/programme/session/<id>` en parallèle → abstract verbatim, format, bios des speakers.
3. Construit le registre des speakers (le site n'expose pas de page speaker dédiée → dérivé des sessions).
4. Fetch `/sponsors` (par tier), `/infos-pratiques/{faq,lieu-et-acces,la-conference}`, la home (tagline + chiffres) et `/equipe` (équipe embarquée dans le bundle JS de la route).
5. Écrit `data/program.json`.

Dates de l'événement codées en dur en haut du script (`DAYS`). À éditer si elles changent.

## Architecture

```
server/
  index.ts        # Express + Streamable HTTP transport + landing page (thème Matrix)
  server.ts       # Déclaration du serveur MCP + outils + widgets
  program.ts      # Logique métier : chargement, recherche, sessions en cours, équipe
client/
  shared.ts       # Types + helpers DOM communs
  shared.css      # Style commun (thème Matrix : vert néon / fond noir, monospace)
  conf-card.{html,ts}    # Widget « fiche conférence »
  now-next.{html,ts}     # Widget « conf en cours / prochaine »
  speaker-card.{html,ts} # Widget « fiche speaker »
  orga-card.{html,ts}    # Widget « fiche membre de l'équipe »
data/
  program.json    # Snapshot complet (3 jours + 95 sessions + 105 speakers + 38 sponsors + équipe)
scripts/
  refresh-data.ts # Rebuild complet de data/program.json depuis breizhcamp.org
dist/             # Sortie de build (généré)
```

## Déploiement Clever Cloud (Bun)

1. Créer une app **Bun** (runtime).
2. Variables : `PORT` (auto-injectée par Clever), `TRUST_PROXY=1`, `NODE_ENV=production`.
3. Le `postinstall` se charge du build des widgets.
4. La commande de lancement est `bun run start` (auto-déduite depuis `package.json`).

## Licence

Apache-2.0.
