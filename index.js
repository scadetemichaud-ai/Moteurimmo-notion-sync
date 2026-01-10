import express from "express";
import { Client } from "@notionhq/client";

const app = express();
app.use(express.json());

/* =========================
   CONFIG
========================= */

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

const DATABASE_ID = process.env.NOTION_DATABASE_ID;

/* =========================
   UTILS
========================= */

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function generateCounter() {
  const year = new Date().getFullYear().toString();

  const response = await notion.databases.query({
    database_id: DATABASE_ID,
    filter: {
      property: "Projet",
      title: { starts_with: year },
    },
  });

  const index = response.results.length + 1;
  return `${year}-${String(index).padStart(3, "0")}`;
}

/* =========================
   AGENCE / TEL EXTRACTION
========================= */

function extractAgencyFromDescription(text = "") {
  const patterns = [
    /présenté par\s+([^\n,]+)/i,
    /vous est présenté par\s+([^\n,]+)/i,
    /Ce bien vous est présenté par\s+([^\n,]+)/i,
    /chez\s+([A-Z0-9&\s]+Immobilier)/i,
  ];

  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }

  return "";
}

function extractPhone(text = "") {
  const match = text.match(/(\+33|0)[1-9](?:[\s.-]?\d{2}){4}/);
  return match ? match[0] : "";
}

function getAgencyName(ad) {
  if (ad.publisher?.name) return ad.publisher.name;

  for (const d of ad.duplicates || []) {
    if (d.publisher?.name) return d.publisher.name;
  }

  return extractAgencyFromDescription(ad.description || "");
}

function getAgencyPhone(ad) {
  if (ad.publisher?.phone) return ad.publisher.phone;

  for (const d of ad.duplicates || []) {
    if (d.publisher?.phone) return d.publisher.phone;
  }

  return extractPhone(ad.description || "");
}

/* =========================
   OTHER HELPERS
========================= */

function getBestUrl(ad) {
  const priority = ["leboncoin", "bienici"];

  for (const p of priority) {
    const found = ad.duplicates?.find(d => d.origin === p);
    if (found?.url) return found.url;
  }

  return ad.url ?? null;
}

function getAddress(ad) {
  if (!ad.location) return "";
  const { postalCode, city } = ad.location;
  return [postalCode, city].filter(Boolean).join(" ");
}

function getCover(ad) {
  const url = ad.pictureUrls?.[0] || ad.pictureUrl;
  return url ? { external: { url } } : undefined;
}

/* =========================
   WEBHOOK
========================= */

app.post("/webhook", async (req, res) => {
  try {
    const savedAd = req.body?.savedAd;
    if (!savedAd || savedAd.kanbanCategory !== "Notion") {
      return res.sendStatus(200);
    }

    const ad = savedAd.ad;
    if (!ad) return res.sendStatus(200);

    console.log("📩 Création page Notion");

    /* =========================
       CREATE PAGE
       → template par défaut appliqué automatiquement
    ========================= */

    const page = await notion.pages.create({
      parent: { database_id: DATABASE_ID },
      cover: getCover(ad),
      properties: {
        Projet: {
          title: [{ text: { content: "Création…" } }],
        },
      },
    });

    // laisser Notion appliquer le template
    await sleep(600);

    /* =========================
       UPDATE PROPERTIES
    ========================= */

    const title = await generateCounter();

    await notion.pages.update({
      page_id: page.id,
      properties: {
        Projet: {
          title: [{ text: { content: title } }],
        },

        Annonce: { url: getBestUrl(ad) },

        "Prix affiché": ad.price ? { number: ad.price } : null,

        "Surface Habitable": ad.surface ? { number: ad.surface } : null,

        "Surface Terrain": ad.landSurface ? { number: ad.landSurface } : null,

        "Intérêt initial": savedAd.comment
          ? { rich_text: [{ text: { content: savedAd.comment } }] }
          : null,

        Adresse: {
          rich_text: [{ text: { content: getAddress(ad) } }],
        },

        "Date de validation": {
          date: { start: todayISO() },
        },

        "Lettre du DPE": ad.energyGrade
          ? { multi_select: [{ name: ad.energyGrade }] }
          : null,

        "Agence / AI": {
          rich_text: [{ text: { content: getAgencyName(ad) || "" } }],
        },

        "Téléphone AI": {
          rich_text: [{ text: { content: getAgencyPhone(ad) || "" } }],
        },
      },
    });

    console.log("✅ Page Notion créée :", page.id);
    res.sendStatus(200);
  } catch (err) {
    console.error("❌ ERREUR", err);
    res.sendStatus(500);
  }
});

/* =========================
   SERVER
========================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Webhook actif sur le port ${PORT}`);
});
