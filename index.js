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

function getTodayISO() {
  return new Date().toISOString().split("T")[0];
}

function getYear() {
  return new Date().getFullYear();
}

/**
 * Génère le compteur annuel : 2026-001 / 2026-002
 */
async function generateAnnualCounter() {
  const year = getYear().toString();

  const response = await notion.databases.query({
    database_id: DATABASE_ID,
    filter: {
      property: "Projet",
      title: {
        starts_with: year,
      },
    },
  });

  const count = response.results.length + 1;
  const padded = String(count).padStart(3, "0");

  return `${year}-${padded}`;
}

/**
 * Priorité URL : leboncoin > bienici > autre
 */
function getBestUrl(ad) {
  if (ad.duplicates?.length) {
    const leboncoin = ad.duplicates.find(d => d.origin === "leboncoin");
    if (leboncoin) return leboncoin.url;

    const bienici = ad.duplicates.find(d => d.origin === "bienici");
    if (bienici) return bienici.url;

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

/* =========================
   WEBHOOK
========================= */

app.post("/webhook", async (req, res) => {
  try {
    console.log("📩 Webhook reçu");

    const savedAd = req.body?.savedAd;
    if (!savedAd) return res.sendStatus(200);

    if (savedAd.kanbanCategory !== "Notion") {
      console.log("⏭️ Ignoré (kanbanCategory ≠ Notion)");
      return res.sendStatus(200);
    }

    const ad = savedAd.ad;
    if (!ad) return res.sendStatus(200);

    /* =========================
       DATA EXTRACTION
    ========================= */

    const title = await generateAnnualCounter();
    const bestUrl = getBestUrl(ad);

    const properties = {
      Projet: {
        title: [
          {
            text: { content: title },
          },
        ],
      },

      Annonce: bestUrl
        ? { url: bestUrl }
        : undefined,

      "Prix affiché": ad.price
        ? { number: ad.price }
        : undefined,

      "Surface Habitable": ad.surface
        ? { number: ad.surface }
        : undefined,

      "Surface Terrain": ad.landSurface
        ? { number: ad.landSurface }
        : undefined,

      "Intérêt initial": savedAd.comment
        ? {
            rich_text: [
              {
                text: { content: savedAd.comment },
              },
            ],
          }
        : undefined,

      "Date de validation": {
        date: { start: getTodayISO() },
      },

      Adresse: {
        rich_text: [
          {
            text: { content: getAddress(ad) },
          },
        ],
      },

      "Lettre du DPE": ad.energyGrade
        ? {
            multi_select: [
              { name: ad.energyGrade },
            ],
          }
        : undefined,

      "Agence / AI": ad.publisher?.name
        ? {
            rich_text: [
              {
                text: { content: ad.publisher.name },
              },
            ],
          }
        : undefined,

      "Téléphone AI": ad.publisher?.phone
        ? {
            rich_text: [
              {
                text: { content: ad.publisher.phone },
              },
            ],
          }
        : undefined,
    };

    /* =========================
       CLEAN UNDEFINED
    ========================= */

    Object.keys(properties).forEach(
      key => properties[key] === undefined && delete properties[key]
    );

    /* =========================
       CREATE NOTION PAGE
    ========================= */

    const page = await notion.pages.create({
      parent: { database_id: DATABASE_ID },
      properties,
    });

    console.log("✅ Page créée :", page.id);
    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Erreur webhook :", error);
    res.sendStatus(500);
  }
});

/* =========================
   SERVER
========================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Webhook actif sur le port ${PORT}`)
);
