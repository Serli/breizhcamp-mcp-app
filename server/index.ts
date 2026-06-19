#!/usr/bin/env node
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { Request, Response } from "express";
import { createServer } from "./server.js";
import cors from "cors";
import rateLimit from "express-rate-limit";

const parseIntEnv = (value: string | undefined, fallback: number) => {
  const parsed = parseInt(value || "", 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const PORT = parseIntEnv(process.env.PORT, 3000);
const HOST = process.env.NODE_ENV === "development" ? "127.0.0.1" : "0.0.0.0";
const RATE_LIMIT_WINDOW_MS = parseIntEnv(process.env.RATE_LIMIT_WINDOW_MS, 60 * 1000);
const RATE_LIMIT_MAX = parseIntEnv(process.env.RATE_LIMIT_MAX, 100);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const app = createMcpExpressApp({ host: HOST });

const trustProxyRaw = process.env.TRUST_PROXY;
if (trustProxyRaw !== undefined) {
  const asInt = parseInt(trustProxyRaw, 10);
  let trustProxy: boolean | number | string;
  if (trustProxyRaw === "true") trustProxy = true;
  else if (trustProxyRaw === "false") trustProxy = false;
  else if (!Number.isNaN(asInt) && String(asInt) === trustProxyRaw) trustProxy = asInt;
  else trustProxy = trustProxyRaw;
  app.set("trust proxy", trustProxy);
}

app.use(cors({ origin: CORS_ORIGIN }));

app.use(
  rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    limit: RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

const handle = async (req: Request, res: Response) => {
  try {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      transport.close();
      server.close();
    });
  } catch (error: unknown) {
    console.error("Erreur /mcp :", error instanceof Error ? error.message : error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Erreur interne" },
        id: null,
      });
    }
  }
};

app.post("/mcp", handle);
app.get("/mcp", handle);

const firstHeader = (value: string | string[] | undefined): string | undefined => {
  if (!value) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  const first = raw.split(",")[0]?.trim();
  return first || undefined;
};

const resolveBaseUrl = (req: Request): string => {
  const proto = firstHeader(req.headers["x-forwarded-proto"]) || req.protocol;
  const host = firstHeader(req.headers["x-forwarded-host"]) || req.get("host");
  return `${proto}://${host}`;
};

app.get("/", (req: Request, res: Response) => {
  res.type("html").send(landingHtml(resolveBaseUrl(req)));
});

app.delete("/mcp", (_req: Request, res: Response) => {
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    }),
  );
});

app.listen(PORT, () => {
  console.log(`Serveur MCP breizhcamp (Streamable HTTP) sur http://localhost:${PORT}/mcp`);
});

process.on("SIGINT", () => {
  console.log("\nArrêt en cours...");
  process.exit(0);
});

// ───────────────────────────── Landing page ────────────────────────────────

const TOOLS: Array<{ name: string; widget: boolean; description: string }> = [
  { name: "infos_breizhcamp", widget: false, description: "Vue d'ensemble : édition, thème, dates, lieu, chiffres clés, thématiques, FAQ." },
  { name: "liste_jours", widget: false, description: "Liste les jours de l'événement (mercredi, jeudi, vendredi)." },
  { name: "programme_du_jour", widget: false, description: "Programme complet d'un jour (sessions, keynotes, ateliers, pauses)." },
  { name: "conf_en_cours", widget: true, description: "Sessions en cours et prochaines, par salle (mode démo sur le jeudi hors événement)." },
  { name: "conf_a_telle_heure", widget: false, description: "Sessions à une heure donnée d'un jour donné." },
  { name: "detail_conference", widget: true, description: "Détail d'une session : abstract, format, niveau, salle, speakers." },
  { name: "fiche_speaker", widget: true, description: "Fiche complète d'un speaker (bio, talks)." },
  { name: "recherche_conference", widget: false, description: "Recherche libre dans le programme (titres, abstracts, thèmes, speakers)." },
  { name: "liste_speakers", widget: false, description: "Liste de tous les speakers." },
  { name: "liste_sponsors", widget: false, description: "Sponsors groupés par tier (Platinum, Gold, Silver, Bronze), filtre optionnel." },
  { name: "liste_equipe", widget: false, description: "Équipe : Organisation, Comité programme, Association, user groups." },
  { name: "fiche_membre", widget: true, description: "Fiche d'un membre de l'équipe organisatrice." },
];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function landingHtml(baseUrl: string): string {
  const mcpUrl = `${baseUrl}/mcp`;
  const toolRows = TOOLS.map(
    (t) => `
        <tr>
          <td><code>${escapeHtml(t.name)}</code></td>
          <td>${t.widget ? '<span class="badge">widget</span>' : ""}</td>
          <td>${escapeHtml(t.description)}</td>
        </tr>`,
  ).join("");

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>BreizhCamp MCP — serveur de démo</title>
  <style>
    :root {
      --bg: #020402;
      --bg-soft: #061206;
      --card: #07150a;
      --text: #c8facc;
      --muted: #5f9c6a;
      --accent: #00ff41;
      --accent-dim: #00b32d;
      --border: #114a22;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background:
        radial-gradient(1200px 600px at 80% -10%, rgba(0,255,65,0.08), transparent),
        linear-gradient(180deg, var(--bg), var(--bg-soft));
      color: var(--text);
      font-family: "SF Mono", "JetBrains Mono", Menlo, Consolas, "Courier New", monospace;
      line-height: 1.55;
      min-height: 100vh;
    }
    .wrap { max-width: 880px; margin: 0 auto; padding: 48px 24px 64px; }
    h1 {
      margin: 0 0 6px;
      font-size: 30px;
      letter-spacing: -0.01em;
      text-shadow: 0 0 12px rgba(0,255,65,0.55);
    }
    h1 .accent { color: var(--accent); }
    .tagline { color: var(--muted); margin: 0 0 32px; }
    h2 { margin: 36px 0 12px; font-size: 16px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent); }
    p { margin: 0 0 14px; }
    a { color: var(--accent); }
    a:hover { text-decoration: none; }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 18px 20px;
      margin: 12px 0;
      box-shadow: inset 0 0 24px rgba(0,255,65,0.04);
    }
    .endpoint { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .endpoint code { font-size: 15px; color: var(--accent); text-shadow: 0 0 8px rgba(0,255,65,0.5); }
    code, pre { font-family: inherit; font-size: 13px; }
    pre {
      background: #010701;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px 16px;
      overflow-x: auto;
      margin: 0;
      color: var(--text);
    }
    table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
    th { color: var(--muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }
    td code { color: var(--accent); }
    .badge {
      display: inline-block; padding: 1px 8px; border-radius: 999px;
      background: rgba(0,255,65,0.12); color: var(--accent);
      font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
      border: 1px solid var(--border);
    }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
    .grid h3 { margin: 0 0 6px; font-size: 14px; color: var(--accent); }
    .grid p { font-size: 13px; color: var(--muted); margin: 0; }
    .foot { margin-top: 48px; color: var(--muted); font-size: 12px; border-top: 1px solid var(--border); padding-top: 16px; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1><span class="accent">&gt;_</span> BreizhCamp MCP</h1>
    <p class="tagline">Serveur <a href="https://modelcontextprotocol.io/" target="_blank" rel="noopener">MCP</a> qui expose le programme du
      <a href="https://www.breizhcamp.org/" target="_blank" rel="noopener">BreizhCamp 2026</a> (Rennes, 24–26 juin · thème <em>Matrix</em>) à un client MCP : ChatGPT, Claude Desktop, MCP Inspector, etc. Cherche une conf, sait quelle session est en cours, sort une fiche speaker — avec des widgets visuels. Un projet <a href="https://www.serli.com" target="_blank" rel="noopener">Serli</a>.</p>

    <h2>Endpoint MCP</h2>
    <div class="card endpoint">
      <code>POST ${escapeHtml(mcpUrl)}</code>
      <span class="badge">Streamable HTTP</span>
    </div>

    <h2>Connecter un client</h2>

    <div class="card">
      <h3 style="margin:0 0 8px;color:var(--accent);">ChatGPT</h3>
      <ol style="margin:0;padding-left:18px;color:var(--muted);font-size:14px;line-height:1.7;">
        <li><em>Paramètres → Applications → Paramètres avancés → mode développeur</em></li>
        <li><em>Paramètres → Applications → Créer une appli</em></li>
        <li>URL : <code>${escapeHtml(mcpUrl)}</code></li>
        <li>Aucune authentification</li>
      </ol>
    </div>

    <div class="card">
      <h3 style="margin:0 0 8px;color:var(--accent);">Claude</h3>
      <p style="margin:0 0 6px;color:var(--muted);font-size:14px;font-weight:600;">Web</p>
      <ol style="margin:0 0 12px;padding-left:18px;color:var(--muted);font-size:14px;line-height:1.7;">
        <li><em>Sidebar → Personnaliser → Connecteurs → Ajouter → Connecteur personnalisé</em></li>
        <li>URL : <code>${escapeHtml(mcpUrl)}</code></li>
      </ol>
      <p style="margin:0 0 6px;color:var(--muted);font-size:14px;font-weight:600;">Desktop / Codex CLI</p>
      <pre>{
  "mcpServers": {
    "breizhcamp": {
      "url": "${escapeHtml(mcpUrl)}"
    }
  }
}</pre>
    </div>

    <div class="card">
      <h3 style="margin:0 0 8px;color:var(--accent);">Mistral (Vibe)</h3>
      <ol style="margin:0;padding-left:18px;color:var(--muted);font-size:14px;line-height:1.7;">
        <li><em>Context → Connecteurs → Ajouter un connecteur → Connecteur MCP personnalisé</em></li>
        <li>URL : <code>${escapeHtml(mcpUrl)}</code></li>
      </ol>
    </div>

    <div class="card">
      <h3 style="margin:0 0 8px;color:var(--accent);">MCP Inspector</h3>
      <p style="margin:0;color:var(--muted);font-size:14px;">
        <code>bunx @modelcontextprotocol/inspector streamable-http ${escapeHtml(mcpUrl)}</code>
        ou
        <code>npx @modelcontextprotocol/inspector streamable-http ${escapeHtml(mcpUrl)}</code>
      </p>
    </div>

    <h2>Outils exposés</h2>
    <div class="card" style="padding:0;overflow:hidden;">
      <table>
        <thead>
          <tr><th>Nom</th><th></th><th>Description</th></tr>
        </thead>
        <tbody>${toolRows}
        </tbody>
      </table>
    </div>

    <h2>Idées de prompts</h2>
    <div class="grid">
      <div class="card">
        <h3>« Qu'est-ce qui se passe maintenant au BreizhCamp ? »</h3>
        <p>→ appelle <code>conf_en_cours</code> + widget en direct (ou démo sur le jeudi hors événement).</p>
      </div>
      <div class="card">
        <h3>« Trouve-moi les confs sur l'IA »</h3>
        <p>→ appelle <code>recherche_conference</code>.</p>
      </div>
      <div class="card">
        <h3>« Parle-moi de ce speaker »</h3>
        <p>→ appelle <code>fiche_speaker</code> + widget fiche speaker.</p>
      </div>
      <div class="card">
        <h3>« Qui sponsorise le BreizhCamp ? »</h3>
        <p>→ appelle <code>liste_sponsors</code>.</p>
      </div>
      <div class="card">
        <h3>« Qui organise l'événement ? »</h3>
        <p>→ appelle <code>liste_equipe</code>.</p>
      </div>
      <div class="card">
        <h3>« C'est quoi le thème cette année ? »</h3>
        <p>→ appelle <code>infos_breizhcamp</code> (thème Matrix, dates, lieu, FAQ).</p>
      </div>
    </div>

    <p class="foot">
      Un projet <a href="https://www.serli.com" target="_blank" rel="noopener">Serli</a> ·
      données scrappées depuis <a href="https://www.breizhcamp.org/" target="_blank" rel="noopener">breizhcamp.org</a> ·
      code source sur <a href="https://github.com/Serli/breizhcamp-mcp-app" target="_blank" rel="noopener">GitHub</a>.
    </p>
  </div>
</body>
</html>`;
}
