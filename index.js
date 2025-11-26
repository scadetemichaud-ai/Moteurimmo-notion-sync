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
  // Version récente requise pour 'template' et comportement attendu
  "Notion-Version": "2025-09-03"
};

// --- HELPERS ---
function buildPropertiesFromSaved(saved, kanban) {
  return {
    "Annonce": { url: saved.url || null },
    "Prix affiché": { number: saved.price ?? null },
    "Surface Habitable": { number: saved.surface ?? null },
    "Surface Terrain": { number: saved.landSurface ?? null },
    "Intérêt initial": {
      // Le champ est texte (rich_text) selon ta config
      rich_text: [{ type: "text", text: { content: String(kanban || "") } }]
    },
    "Adresse": {
      rich_text: [{ type: "text", text: { content: (saved.location?.city || "").toString() } }]
    },
    "Lettre du DPE": {
      // multi_select attendu — on envoie un tableau de noms si existant
      multi_select: (saved.energyGrade || saved.gasGrade)
        ? [{ name: saved.energyGrade || saved.gasGrade }]
        : []
    },
    "Agence / AI": {
      rich_text: [{ type: "text", text: { content: saved.publisher?.name || "" } }]
    },
    "Téléphone AI": {
      rich_text: [{ type: "text", text: { content: saved.publisher?.phone || "" } }]
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

    // Si pas le payload attendu
    if (!saved) {
      console.error("❌ Données invalides reçues");
      return res.status(400).json({ error: "Invalid payload" });
    }

    // Ignorer les suppressions explicitement (on ne veut pas que la suppression dans MoteurImmo supprime en Notion)
    if (event && event.toLowerCase().includes("deleted")) {
      console.log("⏭️ Événement de suppression reçu — ignoré (ne supprime pas en Notion).");
      return res.status(200).json({ ignored: true, reason: "delete ignored" });
    }

    // Filtrer sur KanbanCategory = "Notion"
    if (kanban !== "Notion") {
      console.log(`⏭️ Ignoré : KanbanCategory = "${kanban}"`);
      return res.status(200).json({ ignored: true, reason: "KanbanCategory is not 'Notion'" });
    }

    // --- 1) Créer la page en demandant le template par défaut ---
    const createPayload = {
      parent: { database_id: NOTION_DATABASE_ID },
      // Demande d'application du template par défaut (Notion applique le template)
      template: { type: "default" }
      // On ne fournit pas de 'properties' ici pour laisser Notion appliquer pleinement le template,
      // mais on va tout de suite PATCHer la page pour remplir les propriétés souhaitées.
    };

    console.log("📤 Création page (demande template default) sur Notion...");
    const createRes = await fetch(NOTION_CREATE_URL, {
      method: "POST",
      headers: NOTION_HEADERS,
      body: JSON.stringify(createPayload)
    });

    const createData = await createRes.json();

    if (!createRes.ok) {
      console.error("❌ Erreur lors de la création (Notion) :", createData);
      // Si 404 object_not_found => vérifier partage et ID DB
      return res.status(500).json({ error: createData });
    }

    const createdPageId = createData.id;
    console.log("✅ Page créée (id) :", createdPageId);

    // --- 2) PATCH : mettre à jour les propriétés (remplit la page créée) ---
    const propertiesToUpdate = buildPropertiesFromSaved(saved, kanban);

    const updatePayload = {
      properties: propertiesToUpdate
    };

    console.log("🔁 Mise à jour des propriétés de la page...", updatePayload);

    const updateRes = await fetch(NOTION_PAGE_URL(createdPageId), {
      method: "PATCH",
      headers: NOTION_HEADERS,
      body: JSON.stringify(updatePayload)
    });

    const updateData = await updateRes.json();

    if (!updateRes.ok) {
      console.error("❌ Erreur lors de la mise à jour (Notion) :", updateData);
      return res.status(500).json({ error: updateData });
    }

    // --- 3) Mettre la couverture si une image existe (PATCH cover via pages.update also works) ---
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
          console.warn("⚠️ Warning: impossible de mettre la couverture :", coverData);
        } else {
          console.log("🖼️ Couverture définie.");
        }
      } catch (err) {
        console.warn("⚠️ Erreur lors de la mise de la couverture :", err.message);
      }
    }

    console.log("🎉 Page mise à jour avec les données MoteurImmo :", createdPageId);
    return res.status(200).json({ status: "success", notion_page_id: createdPageId });

  } catch (err) {
    console.error("🔥 ERREUR serveur :", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// --- SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Webhook serveur lancé sur port ${PORT}`));
