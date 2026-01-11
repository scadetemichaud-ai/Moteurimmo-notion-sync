import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

/* =========================
   ENV
========================= */

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

/* =========================
   NOTION CONFIG
========================= */

const NOTION_HEADERS = {
  Authorization: `Bearer ${NOTION_TOKEN}`,
  "Content-Type": "application/json",
  "Notion-Version": "2025-09-03"
};

const NOTION_CREATE_URL = "https://api.notion.com/v1/pages";
const NOTION_PAGE_URL = (id) => `https://api.notion.com/v1/pages/${id}`;

/* =========================
   HELPERS
========================= */

const todayISO = () => new Date().toISOString().split("T")[0];

const getBestUrl = (ad) => {
  const lbc = ad.duplicates?.find(d => d.origin === "leboncoin");
  if (lbc?.url) return lbc.url;
  const bi = ad.duplicates?.find(d => d.origin === "bienici");
  if (bi?.url) return bi.url;
  return ad.url ?? "";
};

const getCoverUrl = (ad) =>
  ad.pictureUrls?.[0] || ad.pictureUrl || null;

const getAddress = (ad) => {
  if (!ad.location) return "";
  const { address, postalCode, city } = ad.location;
  return address || [postalCode, city].filter(Boolean).join(" ");
};

const getTitle = (ad) =>
  `${ad.location?.city ?? ""} - ${ad.title ?? ""}`.trim();

const extractPhone = (text = "") =>
  text.match(/(\+33|0)[1-9](?:[\s.-]?\d{2}){4}/)?.[0] || "";

const getAgencyName = (ad) =>
  ad.publisher?.name ||
  ad.duplicates?.find(d => d.publisher?.name)?.publisher.name ||
  "";

const getAgencyPhone = (ad) =>
  ad.publisher?.phone ||
  ad.duplicates?.find(d => d.publisher?.phone)?.publisher.phone ||
  extractPhone(ad.description || "");

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

    console.log("📩 Import annonce vers Notion");

    /* =========================
       1️⃣ CREATE PAGE (DEFAULT TEMPLATE)
    ========================= */

    const createRes = await fetch(NOTION_CREATE_URL, {
      method: "POST",
      headers: NOTION_HEADERS,
      body: JSON.stringify({
        parent: { database_id: NOTION_DATABASE_ID },
        template: { type: "default" }
      })
    });

    const createData = await createRes.json();
    if (!createRes.ok) {
      console.error("❌ Création échouée :", createData);
      return res.sendStatus(500);
    }

    const pageId = createData.id;

    /* =========================
       2️⃣ BUILD PROPERTIES SAFELY
    ========================= */

    const properties = {};

    properties["Projet"] = {
      title: [{ text: { content: getTitle(ad) } }]
    };

    const url = getBestUrl(ad);
    if (url) properties["Annonce"] = { url };

    if (ad.price)
      properties["Prix affiché"] = { number: ad.price };

    if (ad.surface)
      properties["Surface Habitable"] = { number: ad.surface };

    if (ad.landSurface)
      properties["Surface Terrain"] = { number: ad.landSurface };

    if (savedAd.comment)
      properties["Intérêt initial"] = {
        rich_text: [{ text: { content: savedAd.comment } }]
      };

    const address = getAddress(ad);
    if (address)
      properties["Adresse"] = {
        rich_text: [{ text: { content: address } }]
      };

    properties["Date de validation"] = {
      date: { start: todayISO() }
    };

    if (ad.energyGrade)
      properties["Lettre du DPE"] = {
        multi_select: [{ name: ad.energyGrade }]
      };

    const agency = getAgencyName(ad);
    if (agency)
      properties["Agence / AI"] = {
        rich_text: [{ text: { content: agency } }]
      };

    const phone = getAgencyPhone(ad);
    if (phone)
      properties["Téléphone AI"] = {
        rich_text: [{ text: { content: phone } }]
      };

    /* =========================
       3️⃣ UPDATE PAGE
    ========================= */

    await fetch(NOTION_PAGE_URL(pageId), {
      method: "PATCH",
      headers: NOTION_HEADERS,
      body: JSON.stringify({ properties })
    });

    /* =========================
       4️⃣ COVER IMAGE
    ========================= */

    const coverUrl = getCoverUrl(ad);
    if (coverUrl) {
      await fetch(NOTION_PAGE_URL(pageId), {
        method: "PATCH",
        headers: NOTION_HEADERS,
        body: JSON.stringify({
          cover: {
            type: "external",
            external: { url: coverUrl }
          }
        })
      });
    }

    console.log("✅ Page Notion remplie avec succès");
    res.sendStatus(200);

  } catch (err) {
    console.error("🔥 ERREUR SERVEUR :", err);
    res.sendStatus(500);
  }
});

/* =========================
   SERVER
========================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Webhook Notion actif sur le port ${PORT}`);
});
