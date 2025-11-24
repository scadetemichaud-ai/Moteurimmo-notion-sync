import express from "express";
import dotenv from "dotenv";
import { Client } from "@notionhq/client";

dotenv.config();

const app = express();
app.use(express.json());

// --- NOTION CONFIG ---
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;

// --- WEBHOOK MOTEURIMMO ---
app.post("/webhook", async (req, res) => {
  const event = req.body.event; // created / updated / deleted
  const bien = req.body.data;

  try {
    if (event === "created") {
      await createPage(bien);
    }

    if (event === "updated") {
      await updatePage(bien);
    }

    if (event === "deleted") {
      await deletePage(bien.id);
    }

    res.status(200).json({ status: "OK" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- CREATE ---
async function createPage(bien) {
  await notion.pages.create({
    parent: { database_id: databaseId },

    cover: bien.photos?.length
      ? { external: { url: bien.photos[0] } }
      : undefined,

    properties: {
      ID: { rich_text: [{ text: { content: bien.id } }] },
      Annonce: { url: bien.url },

      "Prix affiché": { number: bien.price || null },
      "Surface habitable": { number: bien.livable_surface || null },
      "Surface terrain": { number: bien.land_surface || null },

      "Intérêt initial": {
        number: bien.note || null
      },

      Adresse: {
        rich_text: [{ text: { content: bien.address || "" } }]
      },

      "Lettre du DPE": {
        rich_text: [{ text: { content: bien.dpe_letter || "" } }]
      },

      "Agence / AI": {
        rich_text: [{ text: { content: bien.agency || "" } }]
      },

      "Téléphone AI": {
        rich_text: [{ text: { content: bien.phone || "" } }]
      }
    }
  });
}

// --- UPDATE ---
async function updatePage(bien) {
  const page = await findPageById(bien.id);
  if (!page) return createPage(bien);

  await notion.pages.update({
    page_id: page.id,

    cover: bien.photos?.length
      ? { external: { url: bien.photos[0] } }
      : undefined,

    properties: {
      Annonce: { url: bien.url },

      "Prix affiché": { number: bien.price || null },
      "Surface habitable": { number: bien.livable_surface || null },
      "Surface terrain": { number: bien.land_surface || null },

      "Intérêt initial": { number: bien.note || null },

      Adresse: {
        rich_text: [{ text: { content: bien.address || "" } }]
      },

      "Lettre du DPE": {
        rich_text: [{ text: { content: bien.dpe_letter || "" } }]
      },

      "Agence / AI": {
        rich_text: [{ text: { content: bien.agency || "" } }]
      },

      "Téléphone AI": {
        rich_text: [{ text: { content: bien.phone || "" } }]
      }
    }
  });
}

// --- DELETE (archive) ---
async function deletePage(id) {
  const page = await findPageById(id);
  if (!page) return;

  await notion.pages.update({
    page_id: page.id,
    archived: true
  });
}

// --- FIND PAGE BY MOTEURIMMO ID ---
async function findPageById(id) {
  const response = await notion.databases.query({
    database_id: databaseId,
    filter: {
      property: "ID",
      rich_text: { equals: id }
    }
  });

  return response.results[0];
}

app.listen(3000, () => {
  console.log("Webhook MoteurImmo → Notion actif");
});
