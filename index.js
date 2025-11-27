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
  "Notion-Version": "2022-06-28"
};

// --- HELPERS ---
function buildProperties(saved) {
  return {
    "Annonce": { url: saved.url || null },

    "Prix affiché": { number: saved.price ?? null },

    "Surface Habitable": { number: saved.surface ?? null },

    "Surface Terrain": { number: saved.landSurface ?? null },

    // 🟢 "Intérêt initial" = contenu du commentaire envoyé par le webhook
    "Intérêt initial": {
      rich_text: [{
        type: "text",
        text: { content: saved.comment || "" }
      }]
    },

    "Secteur": {
      rich_text: [{
        type: "text",
        text: { content: saved.location?.city || "" }
      }]
    },

    "Adresse": {
      rich_text: [{
        type: "text",
        text: { content: saved.location?.city || "" }
      }]
    },

    "Lettre du DPE": {
      multi_select: saved.energyGrade
        ? [{ name: saved.energyGrade }]
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

    if (!saved) {
      console.error("❌ Données invalides reçues");
      return res.status(400).json({ error: "Invalid payload" });
    }

    // IGNORE suppression
    if (event && event.toLowerCase().includes("deleted")) {
      return res.status(200).json({ ignored: true });
    }

    // IGNORE si KanbanCategory ≠ "Notion"
    if (savedAd.kanbanCategory !== "Notion") {
      return res.status(200).json({ ignored: true });
    }

    // 🔥 Injection du commentaire pour le mettre dans "Intérêt initial"
    saved.comment = savedAd.comment;

    // --- CREATE PAGE ---
    const createPayload = {
      parent: { database_id: NOTION_DATABASE_ID },
      properties: {
        "Nom": {
          title: [{
            type: "text",
            text: { content: saved.title || "Sans titre" }
          }]
        }
      }
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
    const updatePayload = { properties: buildProperties(saved) };

    await fetch(NOTION_PAGE_URL(pageId), {
      method: "PATCH",
      headers: NOTION_HEADERS,
      body: JSON.stringify(updatePayload)
    });

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
