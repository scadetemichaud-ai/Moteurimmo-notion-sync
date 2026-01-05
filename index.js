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
function translateType(raw) {
  if (!raw) return "Type inconnu";
  const r = String(raw).toLowerCase();
  const map = {
    house: "Maison",
    apartment: "Appartement",
    flat: "Appartement",
    building: "Immeuble",
    farm: "Ferme",
    land: "Terrain",
    studio: "Studio",
    duplex: "Duplex",
    villa: "Villa",
    room: "Chambre",
    lot: "Lot"
  };
  if (map[r]) return map[r];
  return r.charAt(0).toUpperCase() + r.slice(1);
}

function buildPropertiesFromSaved(saved, savedAd) {
  const comment = savedAd?.comment ?? "";
  const city = (saved.location?.city || "").toString();
  const rawType = saved.category || saved.type || saved.title || "";
  const typeLabel = translateType(rawType);
  const projetValue = city ? `${typeLabel} ${city}` : `${typeLabel}`;

  // 📅 Date du jour (YYYY-MM-DD)
  const today = new Date().toISOString().split("T")[0];

  return {
    // Projet (title)
    "Projet": {
      title: [
        { type: "text", text: { content: projetValue } }
      ]
    },

    "Annonce": { url: saved.url || null },

    "Prix affiché": { number: saved.price ?? null },

    "Surface Habitable": { number: saved.surface ?? null },

    "Surface Terrain": { number: saved.landSurface ?? null },

    "Intérêt initial": {
      rich_text: [{
        type: "text",
        text: { content: String(comment) }
      }]
    },

    "Secteur": {
      rich_text: [{
        type: "text",
        text: { content: city }
      }]
    },

    "Adresse": {
      rich_text: [{
        type: "text",
        text: { content: city }
      }]
    },

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
    },

    // ✅ NOUVEAU CHAMP
    "Date de validation": {
      date: {
        start: today
      }
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

    if (!savedAd || !saved) {
      console.error("❌ Données invalides reçues");
      return res.status(400).json({
        error: "Invalid payload",
        pictogram: "🔴",
        message: "Payload invalide"
      });
    }

    // Ignorer suppressions
    if (event && event.toLowerCase().includes("deleted")) {
      console.log("⏭️ Suppression ignorée");
      return res.status(200).json({
        ignored: true,
        pictogram: "⚪",
