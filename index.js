function extractAgentName(description = "") {
  const match = description.match(
    /([A-ZÀ-Ÿ][a-zà-ÿ]+(?:[-\s][A-ZÀ-Ÿ][a-zà-ÿ]+)*\s[A-ZÀ-Ÿ]{2,})/
  );
  return match ? match[1].trim() : "";
}

function extractPhone(description = "") {
  const match = description.match(
    /(\+33|0)[1-9](?:[\s.-]?\d{2}){4}/
  );
  return match ? match[0].replace(/\s+/g, "") : "";
}

function extractRSAC(description = "") {
  const match = description.match(
    /RSAC\s*(?:de\s*[A-Za-zÀ-ÿ\s-]+)?\s*(\d{9})/
  );
  return match ? match[1] : "";
}

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

function buildPropertiesFromSaved(saved, savedAd) {
  const ad = savedAd?.ad || {};
  const description = ad.description || "";

  const comment = savedAd?.comment ?? "";
  const city = ad.location?.city || "";

  const rawType = ad.category || ad.type || ad.title || "";
  const typeLabel = translateType(rawType);
  const projetValue = city ? `${typeLabel} ${city}` : typeLabel;

  const agentName =
    ad.publisher?.name ||
    extractAgentName(description);

  const agentPhone =
    ad.publisher?.phone ||
    extractPhone(description);

  const rsac = extractRSAC(description);
  const phoneMissing = !agentPhone;

  return {
    "Projet": {
      title: [{ type: "text", text: { content: projetValue } }]
    },

    "Annonce": { url: ad.url || null },
    "Prix affiché": { number: ad.price ?? null },
    "Surface Habitable": { number: ad.surface ?? null },
    "Surface Terrain": { number: ad.landSurface ?? null },

    "Intérêt initial": {
      rich_text: [{ type: "text", text: { content: String(comment) } }]
    },

    "Secteur": {
      rich_text: [{ type: "text", text: { content: city } }]
    },

    "Adresse": {
      rich_text: [{ type: "text", text: { content: city } }]
    },

    "Lettre du DPE": {
      multi_select: ad.energyGrade
        ? [{ name: ad.energyGrade }]
        : []
    },

    "Agence / AI": {
      rich_text: [
        { type: "text", text: { content: agentName } }
      ]
    },

    "Téléphone AI": {
      rich_text: [
        { type: "text", text: { content: agentPhone } }
      ]
    },

    "RSAC AI": {
      rich_text: [
        { type: "text", text: { content: rsac } }
      ]
    },

    "Téléphone manquant": {
      checkbox: phoneMissing
    },

    "Date de validation": {
      date: { start: todayISO() }
    },

    "Confirmation du duo": { checkbox: true }
  };
}
