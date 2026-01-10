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

function currentYear() {
  return new Date().getFullYear();
}

/**
 * Compteur annuel : 2026-001 / 2026-002
 */
async function generateCounter() {
  const year = currentYear().toString();

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

/**
 * URL prioritaire
 */
function getBestUrl(ad) {
  if (ad.duplicates?.length) {
    const leboncoin = ad.duplicates.find(d => d.origin === "leboncoin");
    if (leboncoin?.url) return leboncoin.url;

    const bienici = ad.duplicates.find(d => d.origin === "bienici");
    if (bienici?.url) return bienici.url;

    return ad.duplicates[0].url;
  }
  return ad.url ?? null;
}

/**
 * Adresse lisible
 */
function getAddress(ad) {
  if (!ad.location) return "";
  const { postalCode, city } = ad.location;
  return [postalCode, city].filter(Boolean).join(" ");
}

/**
 * Image de couverture
 */
function getCover(ad) {
  const image =
    ad.pictureUrls?.[0] ||
    ad.pictureUrl ||
    null;

  if (!image) return undefined;

  return {
    external: { url: image },
  };
}

/* =========================
   WEBHOOK
========================= */

app.post("/webhook", async (req, res) => {
  try {
    console.log("📩 Webhook reçu");

    const savedAd = req.body?.savedAd;
    if (!savedAd) return res.sendStatus(200);

    if (savedAd.kanbanCategory !== "Notion") {
      console.log("⏭️ Ignoré (hors Notion)");
      return res.sendStatus(200);
    }

    const ad = savedAd.ad;
    if (!ad) return res.sendStatus(200);

    /* =========================
       DATA
    ========================= */

    const title = await generateCounter();
    const bestUrl = getBestUrl(ad);

    const properties = {
      Projet: {
        title: [{ text: { content: title } }],
      },

      Annonce: bestUrl ? { url: bestUrl } : undefined,

      "Prix affiché": ad.price ? { number: ad.price } : undefined,

      "Surface Habitable": ad.surface ? { number: ad.surface } : undefined,

      "Surface Terrain": ad.landSurface ? { number: ad.landSurface } : undefined,

      "Intérêt initial": savedAd.comment
        ? { rich_text: [{ text: { content: savedAd.comment } }] }
        : undefined,

      "Date de validation": {
        date: { start: todayISO() },
      },

      Adresse: {
        rich_text: [{ text: { content: getAddress(ad) } }],
      },

      "Lettre du DPE": ad.energyGrade
        ? { multi_select: [{ name: ad.energyGrade }] }
        : undefined,

      "Agence / AI": ad.publisher?.name
        ? { rich_text: [{ text: { content: ad.publisher.name } }] }
        : undefined,

      "Téléphone AI": ad.publisher?.phone
        ? { rich_text: [{ text: { content: ad.publisher.phone } }] }
        : undefined,
    };

    // Nettoyage champs undefined
    Object.keys(properties).forEach(
      key => properties[key] === undefined && delete properties[key]
    );

    /* =========================
       CREATE PAGE (DEFAULT TEMPLATE)
    ========================= */

    const page = await notion.pages.create({
      parent: {
        database_id: DATABASE_ID,
      },
      properties,
      cover: getCover(ad),
    });

    console.log("✅ Page Notion créée :", page.id);
    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Erreur :", err);
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
