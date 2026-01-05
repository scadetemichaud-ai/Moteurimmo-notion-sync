function extractAgentName(description = "") {
  const match = description.match(/([A-ZÉÈÀÇ][a-zéèàç]+\\s[A-ZÉÈÀÇ][a-zéèàç]+)/);
  return match ? match[1] : "";
}

function extractPhone(description = "") {
  const match = description.match(/(0[1-9](?:[ .-]?\\d{2}){4})/);
  return match ? match[1] : "";
}

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

function buildPropertiesFromSaved(saved, savedAd) {
  const comment = savedAd?.comment ?? "";
  const city = (saved.location?.city || "").toString();
  const rawType = saved.category || saved.type || saved.title || "";
  const typeLabel = translateType(rawType);
  const projetValue = city ? `${typeLabel} ${city}` : `${typeLabel}`;

  const description = saved.description || "";
  const agentName =
    saved.publisher?.name ||
    extractAgentName(description);

  const agentPhone =
    saved.publisher?.phone ||
    extractPhone(description);

  return {
    "Projet": {
      title: [{ type: "text", text: { content: projetValue } }]
    },

    "Annonce": { url: saved.url || null },
    "Prix affiché": { number: saved.price ?? null },
    "Surface Habitable": { number: saved.surface ?? null },
    "Surface Terrain": { number: saved.landSurface ?? null },

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
      multi_select: (saved.energyGrade || saved.gasGrade)
        ? [{ name: saved.energyGrade || saved.gasGrade }]
        : []
    },

    "Agence / AI": {
      rich_text: [{ type: "text", text: { content: agentName } }]
    },

    "Téléphone AI": {
      rich_text: [{ type: "text", text: { content: agentPhone } }]
    },

    "Date de validation": {
      date: { start: todayISO() }
    },

    "Confirmation du duo": { checkbox: true }
  };
}
