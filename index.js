import express from "express";
import fetch from "node-fetch";
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

const NOTION_HEADERS = {
  "Authorization": `Bearer ${process.env.NOTION_TOKEN}`,
  "Content-Type": "application/json",
  "Notion-Version": "2025-09-03"
};

const NOTION_CREATE_URL = "https://api.notion.com/v1/pages";
const NOTION_PAGE_URL = (id) => `https://api.notion.com/v1/pages/${id}`;

/* =========================
   UTILS
========================= */

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

function currentYear() {
  return new Date().getFullYear();
}

/* ✅ COMPTEUR FIABLE (illimité) */
async function generateCounter() {
  const year = currentYear().toString();

  const response = await notion.databases.query({
    database_id: DATABASE_ID,
    sorts: [
      {
        property: "Projet",
        direction: "descending",
      },
    ],
    page_size: 1,
  });

  if (response.results.length === 0) {
    return `${year}-001`;
  }

  const lastTitle =
    response.results[0].properties?.Projet?.title?.[0]?.plain_text || "";

  const match = lastTitle.match(/^(\d{4})-(\d{3})$/);

  if (!match || match[1] !== year) {
    return `${year}-001`;
  }

  const next = Number(match[2]) + 1;
  return `${year}-${String(next).padStart(3, "0")}`;
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

function getCoverUrl(ad) {
  return ad.pictureUrls?.[0] || ad.pictureUrl || null;
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

    /* 1️⃣ CREATE PAGE (TEMPLATE DEFAULT) */
    const createRes = await fetch(NOTION_CREATE_URL, {
      method: "POST",
      headers: NOTION_HEADERS,
      body: JSON.stringify({
        parent: { database_id: DATABASE_ID },
        template: { type: "default" }
      })
    });

    const createData = await createRes.json();
    if (!createRes.ok) {
      console.error("❌ Erreur création Notion :", createData);
      return res.sendStatus(500);
    }

    const pageId = createData.id;

    /* 2️⃣ UPDATE PROPERTIES */
    const title = await generateCounter();

    await fetch(NOTION_PAGE_URL(pageId), {
      method: "PATCH",
      headers: NOTION_HEADERS,
      body: JSON.stringify({
        properties: {
          Projet: { title: [{ text: { content: title } }] },
          Annonce: { url: getBestUrl(ad) },
          "Prix affiché": ad.price ? { number: ad.price } : null,
          "Surface Habitable": ad.surface ? { number: ad.surface } : null,
          "Surface Terrain": ad.landSurface ? { number: ad.landSurface } : null,
          "Intérêt initial": savedAd.comment
            ? { rich_text: [{ text: { content: savedAd.comment } }] }
            : null,
          Adresse: { rich_text: [{ text: { content: getAddress(ad) } }] },
          "Date de validation": { date: { start: todayISO() } },
          "Lettre du DPE": ad.energyGrade
            ? { multi_select: [{ name: ad.energyGrade }] }
            : null,
          "Agence / AI": { rich_text: [{ text: { content: getAgencyName(ad) } }] },
          "Téléphone AI": { rich_text: [{ text: { content: getAgencyPhone(ad) } }] }
        }
      })
    });

    /* 3️⃣ COVER */
    const coverUrl = getCoverUrl(ad);
    if (coverUrl) {
      await fetch(NOTION_PAGE_URL(pageId), {
        method: "PATCH",
        headers: NOTION_HEADERS,
        body: JSON.stringify({
          cover: { type: "external", external: { url: coverUrl } }
        })
      });
    }

    console.log("🎉 Page Notion complète :", pageId);
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
