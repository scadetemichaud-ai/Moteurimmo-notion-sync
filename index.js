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

    // --- 🔍 Filtrage par KanbanCategory ---
    if (kanban !== "Notion") {
      console.log(`⏩ Ignoré : KanbanCategory = "${kanban}"`);
      return res.json({ ignored: true, reason: "KanbanCategory is not 'Notion'" });
    }

    // --- 1️⃣ CREATION PAGE AVEC TEMPLATE PAR DEFAUT ---
    const createPayload = {
      parent: { database_id: NOTION_DATABASE_ID },
      // ⚠️ Ne pas mettre properties → sinon Notion n'applique PAS le template
      properties: {}
    };

    console.log("📤 Création page (template par défaut)…");

    const createRes = await fetch(NOTION_URL, {
      method: "POST",
      headers: NOTION_HEADERS,
      body: JSON.stringify(createPayload)
    });

    const createData = await createRes.json();

    if (!createRes.ok) {
      console.error("❌ Erreur Notion (creation) :", createData);
      return res.status(500).json({ error: createData });
    }

    const pageId = createData.id;
    console.log("✅ Page créée avec template :", pageId);

    // --- 2️⃣ MISE À JOUR DES PROPRIETES ---
    const updatePayload = {
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
      }
    };

    console.log("📤 Mise à jour des propriétés…");

    const updateRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: "PATCH",
      headers: NOTION_HEADERS,
      body: JSON.stringify(updatePayload)
    });

    const updateData = await updateRes.json();

    if (!updateRes.ok) {
      console.error("❌ Erreur Notion (update) :", updateData);
      return res.status(500).json({ error: updateData });
    }

    console.log("✅ Propriétés mises à jour avec succès !");
    res.json({ status: "success", notion_page_id: pageId });

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
