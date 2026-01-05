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
  const today = new Date().toISOString().split("T")[0];
  
  return {
    // Projet (title)
    "Projet": {
      title: [
        { type: "text", text: { content: projetValue } }
      ]
    },

  "Date de validation": {
    date: {
      start: today
    }
  },

    "Annonce": { url: saved.url || null },

    "Prix affiché": { number: saved.price ?? null },

    "Surface Habitable": { number: saved.surface ?? null },

    "Surface Terrain": { number: saved.landSurface ?? null },

    "Intérêt initial": {
      rich_text: [{
        type: "text",
        text: { content: String(comment) }
      }]
    },

    "Secteur": {
      rich_text: [{
        type: "text",
        text: { content: city }
      }]
    },

    "Adresse": {
      rich_text: [{
        type: "text",
        text: { content: city }
      }]
    },

    "Lettre du DPE": {
      multi_select: (saved.energyGrade || saved.gasGrade)
        ? [{ name: saved.energyGrade || saved.gasGrade }]
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
    },

    // ✅ Case à cocher activée
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
      console.error("❌ Données invalides reçues");
      return res.status(400).json({
        error: "Invalid payload",
        pictogram: "🔴",
        message: "Payload invalide"
      });
    }

    // Ignorer suppressions (on ne supprime pas en Notion)
    if (event && event.toLowerCase().includes("deleted")) {
      console.log("⏭️ Suppression ignorée");
      return res.status(200).json({
        ignored: true,
        pictogram: "⚪",
        message: "Suppression ignorée"
      });
    }

    // Filtrer sur KanbanCategory = "Notion"
    if (kanban !== "Notion") {
      console.log(`⏭️ Ignoré : KanbanCategory = "${kanban}"`);
      return res.status(200).json({
        ignored: true,
        pictogram: "⚪",
        message: `Annonce ignorée car KanbanCategory = "${kanban}"`
      });
    }

    // 1) Créer la page en demandant le template par défaut
    const createPayload = {
      parent: { database_id: NOTION_DATABASE_ID },
      template: { type: "default" }
    };

    console.log("📤 Création page (template default) sur Notion...");
    const createRes = await fetch(NOTION_CREATE_URL, {
      method: "POST",
      headers: NOTION_HEADERS,
      body: JSON.stringify(createPayload)
    });

    const createData = await createRes.json();
    if (!createRes.ok) {
      console.error("❌ Erreur lors de la création (Notion) :", createData);
      return res.status(500).json({
        error: createData,
        pictogram: "🔴",
        message: "Erreur lors de la création Notion"
      });
    }

    const createdPageId = createData.id;
    console.log("✅ Page créée (id) :", createdPageId);

    // 2) PATCH : mettre à jour les propriétés (y compris checkbox)
    const propertiesToUpdate = buildPropertiesFromSaved(saved, savedAd);
    const updatePayload = { properties: propertiesToUpdate };

    console.log("🔁 Mise à jour des propriétés...", updatePayload);
    const updateRes = await fetch(NOTION_PAGE_URL(createdPageId), {
      method: "PATCH",
      headers: NOTION_HEADERS,
      body: JSON.stringify(updatePayload)
    });

    const updateData = await updateRes.json();
    if (!updateRes.ok) {
      console.error("❌ Erreur mise à jour (Notion) :", updateData);
      return res.status(500).json({
        error: updateData,
        pictogram: "🔴",
        message: "Erreur lors de la mise à jour des propriétés"
      });
    }

    // 3) Couverture si image
    const coverUrl = saved.pictureUrl || (Array.isArray(saved.pictureUrls) && saved.pictureUrls[0]);
    if (coverUrl) {
      try {
        const coverRes = await fetch(NOTION_PAGE_URL(createdPageId), {
          method: "PATCH",
          headers: NOTION_HEADERS,
          body: JSON.stringify({
            cover: { type: "external", external: { url: coverUrl } }
          })
        });

        if (!coverRes.ok) {
          const coverData = await coverRes.json();
          console.warn("⚠️ Impossible de mettre la couverture :", coverData);
        } else {
          console.log("🖼️ Couverture définie.");
        }
      } catch (err) {
        console.warn("⚠️ Erreur lors de la mise de la couverture :", err.message);
      }
    }

    console.log("🎉 Page Notion mise à jour :", createdPageId);
    return res.status(200).json({
      status: "success",
      notion_page_id: createdPageId,
      pictogram: "🟢",
      message: "Annonce ajoutée à Notion (Confirmation du duo cochée)"
    });

  } catch (err) {
    console.error("🔥 ERREUR serveur :", err);
    return res.status(500).json({
      error: err.message,
      pictogram: "🔴",
      message: "Erreur serveur"
    });
  }
});

// --- SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Webhook serveur lancé sur port ${PORT}`));
