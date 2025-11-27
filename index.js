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
function buildPropertiesFromSaved(saved, kanban) {
  const ville = saved.location?.city || "";
  const typeBien = saved.type || saved.propertyType || "";

  return {
    "Annonce": { url: saved.url || null },

    "Prix affiché": { number: saved.price ?? null },

    "Surface Habitable": { number: saved.surface ?? null },

    "Surface Terrain": { number: saved.landSurface ?? null },

    "Intérêt initial": {
      rich_text: [{
        type: "text",
        text: { content: saved.comment ? String(saved.comment) : "" }
      }]
    },

    "Secteur": {
      rich_text: [{
        type: "text",
        text: { content: ville.toString() }
      }]
    },

    "Adresse": {
      rich_text: [{
        type: "text",
        text: { content: ville.toString() }
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

    // 🔥 NOUVEAU : Champs "Projet"
    // Exemple : "Immeuble Lyon"
    "Projet": {
      rich_text: [{
        type: "text",
        text: { content: `${typeBien} ${ville}`.trim() }
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

    if (event && event.toLowerCase().includes("deleted")) {
      console.log("⏭️ Suppression ignorée");
      return res.status(200).json({ ignored: true, reason: "delete ignored" });
    }

    if (kanban !== "Notion") {
      console.log(`⏭️ Ignoré : KanbanCategory = "${kanban}"`);
      return res.status(200).json({ ignored: true });
    }

    // --- CREATE with Default Template ---
    const createPayload = {
      parent: { database_id: NOTION_DATABASE_ID },
      template: { type: "default" }
    };

    const createRes = await fetch(NOTION_CREATE_URL, {
      method: "POST",
      headers: NOTION_HEADERS,
      body: JSON.stringify(createPayload)
    });

    const createData = await createRes.json();
    if (!createRes.ok) return res.status(500).json({ error: createData });

    const pageId = createData.id;

    // --- UPDATE PROPERTIES ---
    const updatePayload = { properties: buildPropertiesFromSaved(saved, kanban) };

    const updateRes = await fetch(NOTION_PAGE_URL(pageId), {
      method: "PATCH",
      headers: NOTION_HEADERS,
      body: JSON.stringify(updatePayload)
    });

    const updateData = await updateRes.json();
    if (!updateRes.ok) return res.status(500).json({ error: updateData });

    // --- COVER ---
    const coverUrl = saved.pictureUrl || (Array.isArray(saved.pictureUrls) && saved.pictureUrls[0]);
    if (coverUrl) {
      await fetch(NOTION_PAGE_URL(pageId), {
        method: "PATCH",
        headers: NOTION_HEADERS,
        body: JSON.stringify({
          cover: { type: "external", external: { url: coverUrl } }
        })
      }).catch(() => {});
    }

    return res.status(200).json({ status: "success", notion_page_id: pageId });

  } catch (err) {
    console.error("🔥 ERREUR serveur :", err);
    return res.status(500).json({ error: err.message });
  }
});

// --- SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Webhook serveur lancé sur port ${PORT}`));
