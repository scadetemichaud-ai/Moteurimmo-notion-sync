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

/* =========================
   EXTRACTION AGENCE / TEL
========================= */

function extractAgentName(description = "") {
  const match = description.match(
    /(présenté par|vous est présenté par)\s+([^,\n]+)/i
  );
  return match ? match[2].trim() : "";
}

function extractPhone(description = "") {
  const match = description.match(
    /(\+33|0)[1-9](?:[\s.-]?\d{2}){4}/
  );
  return match ? match[0] : "";
}

function getAgencyName(ad) {
  if (ad.publisher?.name) return ad.publisher.name;

  for (const dup of ad.duplicates || []) {
    if (dup.publisher?.name) return dup.publisher.name;
  }

  return extractAgentName(ad.description || "");
}

function getAgencyPhone(ad) {
  if (ad.publisher?.phone) return ad.publisher.phone;

  for (const dup of ad.duplicates || []) {
    if (dup.publisher?.phone) return dup.publisher.phone;
  }

  return extractPhone(ad.description || "");
}

/* =========================
   AUTRES HELPERS
========================= */

function getBestUrl(ad) {
  const leboncoin = ad.duplicates?.find(d => d.origin === "leboncoin");
  if (leboncoin?.url) return leboncoin.url;

  const bienici = ad.duplicates?.find(d => d.origin === "bienici");
  if (bienici?.url) return bienici.url;

  return ad.url ?? null;
}

function getAddress(ad) {
  if (!ad.location) return "";
  const { postalCode, city } = ad.location;
  return [postalCode, city].filter(Boolean).join(" ");
}

function getCover(ad) {
  const img = ad.pictureUrls?.[0] || ad.pictureUrl;
  return img ? { external: { url: img } } : undefined;
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

    console.log("📩 Import annonce Notion");

    /* =========================
       1️⃣ CREATE PAGE (TEMPLATE)
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

    /* ⏳ micro-délai pour laisser Notion appliquer le template */
    await new Promise(r => setTimeout(r, 500));

    /* =========================
       2️⃣ UPDATE PROPERTIES
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
          rich_text: [
            { text: { content: getAgencyName(ad) || "" } },
          ],
        },

        "Téléphone AI": {
          rich_text: [
            { text: { content: getAgencyPhone(ad) || "" } },
          ],
        },
      },
    });

    console.log("✅ Page Notion complète :", page.id);
    res.sendStatus(200);
  } catch (err) {
    console.error("❌ ERREUR :", err);
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
