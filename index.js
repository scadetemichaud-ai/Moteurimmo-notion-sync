import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

/* =========================
   ENV
========================= */
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

const NOTION_HEADERS = {
  "Authorization": `Bearer ${NOTION_TOKEN}`,
  "Content-Type": "application/json",
  "Notion-Version": "2022-06-28"
};

const NOTION_CREATE_URL = "https://api.notion.com/v1/pages";
const NOTION_PAGE_URL = (id) => `https://api.notion.com/v1/pages/${id}`;

/* =========================
   HELPERS
========================= */
function translateType(raw) {
  if (!raw) return "Bien";
  const map = {
    block: "Immeuble",
    apartment: "Appartement",
    house: "Maison",
    land: "Terrain"
  };
  return map[raw] || raw;
}

function extractAgentName(description = "") {
  const patterns = [
    /présenté par\s+([A-ZÀ-Ÿ][a-zà-ÿ]+(?:[-\s][A-ZÀ-Ÿ][a-zà-ÿ]+)+)/i,
    /Ce bien vous est présenté par\s+([A-ZÀ-Ÿ][a-zà-ÿ]+(?:\s[A-ZÀ-Ÿ][a-zà-ÿ]+)+)/i,
    /([A-ZÀ-Ÿ][a-zà-ÿ]+(?:\s[A-ZÀ-Ÿ][a-zà-ÿ]+)+),?\s+votre conseiller/i,
    /([A-ZÀ-Ÿ][a-zà-ÿ]+(?:\s[A-ZÀ-Ÿ]+)+)\s*-\s*Agent/i
  ];

  for (const regex of patterns) {
    const match = description.match(regex);
    if (match) return match[1].trim();
  }
  return "";
}

function extractPhone(description = "") {
  const match = description.match(
    /(\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}/
  );
  return match ? match[0].replace(/\s+/g, "") : "";
}

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

/* =========================
   NOTION PAYLOAD BUILDER
========================= */
function buildPropertiesFromSaved(savedAd) {
  const ad = savedAd.ad;

  const description = ad.description || "";
  const city = ad.location?.city || "";

  const typeLabel = translateType(ad.category || ad.type);
  const projetValue = city ? `${typeLabel} ${city}` : typeLabel;

  const agentName =
    ad.publisher?.name ||
    extractAgentName(description);

  const agentPhone =
    ad.publisher?.phone ||
    extractPhone(description);

  return {
    "Projet": {
      title: [{ type: "text", text: { content: projetValue } }]
    },

    "Annonce": { url: ad.url || null },
    "Prix affiché": { number: ad.price ?? null },
    "Surface Habitable": { number: ad.surface ?? null },
    "Surface Terrain": { number: ad.landSurface ?? null },

    "Intérêt initial": {
      rich_text: [{ type: "text", text: { content: savedAd.comment || "" } }]
    },

    "Secteur": {
      rich_text: [{ type: "text", text: { content: city } }]
    },

    "Adresse": {
      rich_text: [{ type: "text", text: { content: city } }]
    },

    "Lettre du DPE": {
      multi_select: ad.energyGrade ? [{ name: ad.energyGrade }] : []
    },

    "Agence / AI": {
      rich_text: [{ type: "text", text: { content: agentName } }]
    },

    "Téléphone AI": {
      rich_text: [{ type: "text", text: { content: agentPhone } }]
    },

    "Date de validation": {
      date: { start: todayISO() }
    },

    "Confirmation du duo": {
      checkbox: true
    }
  };
}

/* =========================
   ROUTES
========================= */
app.get("/", (_, res) => res.json({ status: "OK" }));

app.post("/webhook", async (req, res) => {
  try {
    console.log("📩 Webhook reçu :", JSON.stringify(req.body, null, 2));

    const { event, savedAd } = req.body;

    if (!savedAd?.ad) {
      return res.status(400).json({ error: "Payload invalide" });
    }

    if (savedAd.kanbanCategory !== "Notion") {
      return res.status(200).json({ ignored: true });
    }

    /* CREATE PAGE */
    const createRes = await fetch(NOTION_CREATE_URL, {
      method: "POST",
      headers: NOTION_HEADERS,
      body: JSON.stringify({
        parent: { database_id: NOTION_DATABASE_ID }
      })
    });

    const createData = await createRes.json();
    if (!createRes.ok) {
      console.error("❌ Notion create error", createData);
      return res.status(500).json(createData);
    }

    const pageId = createData.id;
    console.log("✅ Page créée :", pageId);

    /* UPDATE PROPERTIES */
    const properties = buildPropertiesFromSaved(savedAd);

    console.log("🔁 Mise à jour propriétés :", properties);

    const updateRes = await fetch(NOTION_PAGE_URL(pageId), {
      method: "PATCH",
      headers: NOTION_HEADERS,
      body: JSON.stringify({ properties })
    });

    if (!updateRes.ok) {
      const err = await updateRes.json();
      console.error("❌ Notion update error", err);
      return res.status(500).json(err);
    }

    /* COVER */
    const coverUrl = savedAd.ad.pictureUrl;
    if (coverUrl) {
      await fetch(NOTION_PAGE_URL(pageId), {
        method: "PATCH",
        headers: NOTION_HEADERS,
        body: JSON.stringify({
          cover: { type: "external", external: { url: coverUrl } }
        })
      });
    }

    console.log("🎉 Notion OK :", pageId);
    res.status(200).json({ success: true, pageId });

  } catch (err) {
    console.error("🔥 ERREUR SERVEUR", err);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   SERVER
========================= */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () =>
  console.log(`🚀 Webhook serveur lancé sur le port ${PORT}`)
);
