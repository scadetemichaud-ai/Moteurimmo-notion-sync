import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

// --- ENV VARIABLES ---
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

// --- NOTION CONFIG ---
const NOTION_URL = "https://api.notion.com/v1/pages";
const NOTION_HEADERS = {
  "Authorization": `Bearer ${NOTION_TOKEN}`,
  "Content-Type": "application/json",
  "Notion-Version": "2022-06-28"
};

// --- TEST ROUTE ---
app.get("/", (req, res) => {
  res.json({ status: "OK" });
});

// --- MAIN WEBHOOK ---
app.post("/webhook", async (req, res) => {
  console.log("📩 Webhook reçu :", JSON.stringify(req.body, null, 2));

  try {
    const saved = req.body.savedAd?.ad;
    const kanban = req.body.savedAd?.kanbanCategory;

    if (!saved) {
      console.error("❌ Données invalides reçues");
      return res.status(400).json({ error: "Invalid payload" });
    }

    // --- 🔍 NOUVEAU : filtrage par KanbanCategory ---
    if (kanban !== "Notion") {
      console.log(`⏩ Ignoré : KanbanCategory = "${kanban}"`);
      return res.json({ ignored: true, reason: "KanbanCategory is not 'Notion'" });
    }

    // Mapping du JSON MoteurImmo → Propriétés Notion
    const notionPayload = {
      parent: { database_id: NOTION_DATABASE_ID },
      properties: {
        "Annonce": { url: saved.url },
        "Prix affiché": { number: saved.price || null },
        "Surface Habitable": { number: saved.surface || null },
        "Surface Terrain": { number: saved.landSurface || null },
        "Intérêt initial": {
          rich_text: [
            { type: "text", text: { content: kanban || "" } }
          ]
        },
        "Adresse": {
          rich_text: [
            { type: "text", text: { content: saved.location?.city || "" } }
          ]
        },
        "Lettre du DPE": {
          multi_select: saved.energyGrade
            ? [{ name: saved.energyGrade }]
            : []
        },
        "Agence / AI": {
          rich_text: [
            { type: "text", text: { content: saved.publisher?.name || "" } }
          ]
        },
        "Téléphone AI": {
          rich_text: [
            { type: "text", text: { content: saved.publisher?.phone || "" } }
          ]
        }
      },
      cover: saved.pictureUrl
        ? { type: "external", external: { url: saved.pictureUrl } }
        : undefined
    };

    console.log("📤 Envoi vers Notion…");

    const notionRes = await fetch(NOTION_URL, {
      method: "POST",
      headers: NOTION_HEADERS,
      body: JSON.stringify(notionPayload)
    });

    const notionData = await notionRes.json();

    if (!notionRes.ok) {
      console.error("❌ Erreur Notion :", notionData);
      return res.status(500).json({ error: notionData });
    }

    console.log("✅ Page créée :", notionData.id);
    res.json({ status: "success", notion_page_id: notionData.id });

  } catch (err) {
    console.error("🔥 ERREUR serveur :", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Webhook serveur lancé sur port ${PORT}`)
);
