import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

// --- Récupération des variables d'environnement ---
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

// --- CONFIG NOTION ---
const NOTION_URL = "https://api.notion.com/v1/pages";
const NOTION_HEADERS = {
  "Authorization": `Bearer ${NOTION_TOKEN}`,
  "Content-Type": "application/json",
  "Notion-Version": "2022-06-28"
};

// --- ROUTE DE TEST ---
app.get("/", (req, res) => {
  res.json({ status: "OK" });
});

// --- ROUTE DU WEBHOOK MOTEURIMMO ---
app.post("/webhook", async (req, res) => {
  console.log("📩 Webhook reçu :", JSON.stringify(req.body, null, 2));

  try {
    const data = req.body;

    // Vérification simple que les données nécessaires existent
    if (!data || !data.url) {
      console.error("❌ Données invalides reçues");
      return res.status(400).json({ error: "Invalid payload" });
    }

    // --- Création d'une page Notion ---
const notionPayload = {
  parent: { database_id: NOTION_DATABASE_ID },
  properties: {
    "Annonce": {
      url: data.url || null
    },
    "Prix affiché": {
      number: data.price || null
    },
    "Surface Habitable": {
      number: data.surface_habitable || null
    },
    "Surface Terrain": {
      number: data.surface_terrain || null
    },
    "Intérêt initial": {
      rich_text: [
        {
          type: "text",
          text: { content: data.rating?.toString() || "" }
        }
      ]
    },
    "Adresse": {
      rich_text: [
        {
          type: "text",
          text: { content: data.address || "" }
        }
      ]
    },
    "Lettre du DPE": {
      multi_select: data.dpe_letter
        ? data.dpe_letter.split(",").map(v => ({ name: v.trim() }))
        : []
    },
    "Agence / AI": {
      rich_text: [
        {
          type: "text",
          text: { content: data.agency || "" }
        }
      ]
    },
    "Téléphone AI": {
      rich_text: [
        {
          type: "text",
          text: { content: data.phone || "" }
        }
      ]
    }
  },
  cover: data.photo
    ? {
        type: "external",
        external: { url: data.photo }
      }
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

    console.log("✅ Page ajoutée dans Notion :", notionData.id);

    res.json({ status: "success", notion_page_id: notionData.id });

  } catch (err) {
    console.error("🔥 ERREUR serveur :", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- LANCEMENT DU SERVEUR ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Serveur webhook démarré sur le port ${PORT}`)
);
