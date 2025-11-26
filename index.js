import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

// --- ENV VARIABLES ---
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

// --- NOTION CONFIG ---
const NOTION_CREATE_URL = "https://api.notion.com/v1/pages";
const NOTION_PAGE_URL = (pageId) => `https://api.notion.com/v1/pages/${pageId}`;
const NOTION_HEADERS = {
  "Authorization": `Bearer ${NOTION_TOKEN}`,
  "Content-Type": "application/json",
  "Notion-Version": "2025-09-03"
};

// --- HELPERS ---
function buildPropertiesFromSaved(saved) {
  return {
    "Annonce": { url: saved.url || null },

    "Prix affiché": { number: saved.price ?? null },

    "Surface Habitable": { number: saved.surface ?? null },

    "Surface Terrain": { number: saved.landSurface ?? null },

    // 🔥 Secteur = ville
    "Secteur": {
      rich_text: [{
        type: "text",
        text: { content: (saved.location?.city || "").toString() }
      }]
    },

    // 🔥 Adresse = ville
    "Adresse": {
      rich_text: [{
        type: "text",
        text: { content: (saved.location?.city || "").toString() }
      }]
    },

    // 🔥 Lettre DPE
    "Lettre du DPE": {
      multi_select: (saved.energyGrade || saved.gasGrade)
        ? [{ name: saved.energyGrade || saved.gasGrade }]
        : []
    },

    "Agence / AI": {
      rich_text: [{
        type: "text",
        text: { content: saved.publisher?.name || "" }
      }]
    },

    "Téléphone AI": {
      rich_text: [{
        type: "text",
        text: { content: saved.publisher?.phone || "" }
      }]
    }
  };
}

// --- TEST ROUTE ---
app.get("/", (req, res) => res.json({ status: "OK" }));

// --- MAIN WEBHOOK ---
app.post("/webhook", async (req, res) => {
  console.log("📩 Webhook reçu :", JSON.stringify(req.body, null, 2));

  try {
    const event = req.body.event;
    const savedAd = req.body.savedAd;
    const saved = savedAd?.ad;
    const kanban = savedAd?.kanbanCategory;

    if (!saved) {
      console.error("❌ Données invalides reçues");
      return res.status(400).json({ error: "Invalid payload" });
    }

    // 🔥 Ignore DELETE
    if (event && event.toLowerCase().includes("deleted")) {
      console.log("⏭️ Suppression ignorée");
      return res.status(200).json({ ignored: true, reason: "delete ignored" });
    }

    // 🔥 On ne crée QUE si KanbanCategory = "Notion"
    if (kanban !== "Notion") {
      console.log(`⏭️ Ignoré : KanbanCategory = "${kanban}"`);
      return res.status(200).json({ ignored: true });
    }

    // --- CREATE with Default
