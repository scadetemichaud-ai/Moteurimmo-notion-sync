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

  return {
    "Projet": {
      title: [{ type: "text", text: { content: projetValue } }]
    },

    "Annonce": { url: saved.url || null },
    "Prix affiché": { number: saved.price ?? null },
    "Surface Habitable": { number: saved.surface ?? null },
    "Surface Terrain": { number: saved.landSurface ?? null },

    "Intérêt initial": {
      rich_text: [{ type: "text", text: { content: String(comment) } }]
    },

    "Secteur": {
      rich_text: [{ type: "text", text: { content: city } }]
    },

    "Adresse": {
      rich_text: [{ type: "text", text: { content: city } }]
    },

    "Lettre du DPE": {
      multi_select: (saved.energyGrade || saved.gasGrade)
        ? [{ name: saved.energyGrade || saved.gasGrade }]
        : []
    },

    "Agence / AI": {
      rich_text: [{ type: "text", text: { content: saved.publisher?.name || "" } }]
    },

    "Téléphone AI": {
      rich_text: [{ type: "text", text: { content: saved.publisher?.phone || "" } }]
    },

    "Confirmation du duo": {
      checkbox: true
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
      return res.status(400).json({ error: "Invalid payload" });
    }

    if (event && event.toLowerCase().includes("deleted")) {
      return res.status(200).json({ ignored: true });
    }

    if (kanban !== "Notion") {
      return res.status(200).json({ ignored: true });
    }

    // 1) Création page (template par défaut "Nouvelle page")
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
    if (!createRes.ok) {
      return res.status(500).json({ error: createData });
    }

    const createdPageId = createData.id;

    // 2) Mise à jour propriétés
    const updatePayload = {
      properties: buildPropertiesFromSaved(saved, savedAd)
    };

    await fetch(NOTION_PAGE_URL(createdPageId), {
      method: "PATCH",
      headers: NOTION_HEADERS,
      body: JSON.stringify(updatePayload)
    });

    // 3) Couverture
    const coverUrl = saved.pictureUrl || saved.pictureUrls?.[0];
    if (coverUrl) {
      await fetch(NOTION_PAGE_URL(createdPageId), {
        method: "PATCH",
        headers: NOTION_HEADERS,
        body: JSON.stringify({
          cover: { type: "external", external: { url: coverUrl } }
        })
      });
    }

    return res.status(200).json({
      status: "success",
      notion_page_id: createdPageId
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

// --- SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Webhook serveur lancé sur port ${PORT}`)
);
