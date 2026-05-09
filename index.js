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
  "Notion-Version": "2022-06-28"
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

  return ad.url || "";
};

const getCoverUrl = (ad) =>
  ad.pictureUrls?.[0] || ad.pictureUrl || null;

const getAddress = (ad) => {
  if (!ad.location) return "";

  const {
    address,
    postalCode,
    city
  } = ad.location;

  return (
    address ||
    [postalCode, city].filter(Boolean).join(" ")
  );
};

const getTitle = (ad) => {
  const city = ad.location?.city || "";
  const title = ad.title || "";

  return `${city} - ${title}`.trim();
};

const extractPhone = (text = "") => {
  const match = text.match(
    /(\+33|0)[1-9](?:[\s.-]?\d{2}){4}/
  );

  return match ? match[0] : "";
};

const getAgencyName = (ad) => {
  if (ad.publisher?.name) {
    return ad.publisher.name;
  }

  for (const dup of ad.duplicates || []) {
    if (dup.publisher?.name) {
      return dup.publisher.name;
    }
  }

  return "";
};

const getAgencyPhone = (ad) => {
  if (ad.publisher?.phone) {
    return ad.publisher.phone;
  }

  for (const dup of ad.duplicates || []) {
    if (dup.publisher?.phone) {
      return dup.publisher.phone;
    }
  }

  return extractPhone(ad.description || "");
};

/* =========================
   WEBHOOK
========================= */

app.post("/webhook", async (req, res) => {
  try {

    console.log(
      "📩 WEBHOOK REÇU :",
      JSON.stringify(req.body, null, 2)
    );

    const savedAd = req.body?.savedAd;

    if (!savedAd) {
      console.log("⏭️ Aucun savedAd");
      return res.sendStatus(200);
    }

    if (savedAd.kanbanCategory !== "Notion") {
      console.log(
        `⏭️ Kanban ignoré : ${savedAd.kanbanCategory}`
      );
      return res.sendStatus(200);
    }

    const ad = savedAd.ad;

    if (!ad) {
      console.log("⏭️ Aucun objet ad");
      return res.sendStatus(200);
    }

    console.log("📩 Import annonce vers Notion");

    /* =========================
       1️⃣ CREATE PAGE
    ========================= */

    const createRes = await fetch(NOTION_CREATE_URL, {
      method: "POST",
      headers: NOTION_HEADERS,
      body: JSON.stringify({
        parent: {
          database_id: NOTION_DATABASE_ID
        },

        template: {
          type: "default"
        }
      })
    });

    const createData = await createRes.json();

    if (!createRes.ok) {
      console.error(
        "❌ Erreur création page :",
        createData
      );
      return res.sendStatus(500);
    }

    const pageId = createData.id;

    console.log("✅ Page créée :", pageId);

    /* =========================
       2️⃣ BUILD PROPERTIES
    ========================= */

    const properties = {};

    /* ===== TITRE ===== */

    properties["Projet"] = {
      title: [
        {
          text: {
            content: getTitle(ad)
          }
        }
      ]
    };

    /* ===== URL ===== */

    const url = getBestUrl(ad);

    properties["Annonce"] = {
      url: url || null
    };

    /* ===== PRIX ===== */

    properties["Prix affiché"] = {
      number:
        typeof ad.price === "number"
          ? ad.price
          : null
    };

    /* ===== SURFACE ===== */

    properties["Surface Habitable"] = {
      number:
        typeof ad.surface === "number"
          ? ad.surface
          : null
    };

    properties["Surface Terrain"] = {
      number:
        typeof ad.landSurface === "number"
          ? ad.landSurface
          : null
    };

    /* ===== COMMENTAIRE ===== */

    properties["Intérêt initial"] = {
      rich_text: [
        {
          text: {
            content: savedAd.comment || ""
          }
        }
      ]
    };

    /* ===== ADRESSE ===== */

    properties["Adresse"] = {
      rich_text: [
        {
          text: {
            content: getAddress(ad)
          }
        }
      ]
    };

    /* ===== DATE ===== */

    properties["Date de validation"] = {
      date: {
        start: todayISO()
      }
    };

    /* ===== DPE ===== */

    properties["Lettre du DPE"] = {
      multi_select: ad.energyGrade
        ? [{ name: ad.energyGrade }]
        : []
    };

    /* ===== AGENCE ===== */

    properties["Agence / AI"] = {
      rich_text: [
        {
          text: {
            content: getAgencyName(ad)
          }
        }
      ]
    };

    /* ===== TÉLÉPHONE ===== */

    properties["Téléphone AI"] = {
      rich_text: [
        {
          text: {
            content: getAgencyPhone(ad)
          }
        }
      ]
    };

    console.log(
      "🧾 PROPERTIES ENVOYÉES :",
      JSON.stringify(properties, null, 2)
    );

    /* =========================
       3️⃣ UPDATE PAGE
    ========================= */

    const updateRes = await fetch(
      NOTION_PAGE_URL(pageId),
      {
        method: "PATCH",
        headers: NOTION_HEADERS,
        body: JSON.stringify({
          properties
        })
      }
    );

    const updateData = await updateRes.json();

    if (!updateRes.ok) {
      console.error(
        "❌ Erreur update Notion :",
        JSON.stringify(updateData, null, 2)
      );

      return res.sendStatus(500);
    }

    console.log("✅ Propriétés mises à jour");

    /* =========================
       4️⃣ COVER IMAGE
    ========================= */

    const coverUrl = getCoverUrl(ad);

    if (coverUrl) {

      const coverRes = await fetch(
        NOTION_PAGE_URL(pageId),
        {
          method: "PATCH",
          headers: NOTION_HEADERS,
          body: JSON.stringify({
            cover: {
              type: "external",
              external: {
                url: coverUrl
              }
            }
          })
        }
      );

      if (!coverRes.ok) {
        const coverErr = await coverRes.json();

        console.error(
          "❌ Erreur cover :",
          coverErr
        );
      } else {
        console.log("🖼️ Cover ajoutée");
      }
    }

    console.log("🎉 Import terminé");

    return res.sendStatus(200);

  } catch (err) {

    console.error(
      "🔥 ERREUR SERVEUR :",
      err
    );

    return res.sendStatus(500);
  }
});

/* =========================
   SERVER
========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `🚀 Webhook Notion actif sur le port ${PORT}`
  );
});
