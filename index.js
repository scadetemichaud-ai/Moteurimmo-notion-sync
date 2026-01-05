function buildPropertiesFromSaved(saved, savedAd) {
  const comment = savedAd?.comment ?? "";
  const city = (saved.location?.city || "").toString();
  const rawType = saved.category || saved.type || saved.title || "";
  const typeLabel = translateType(rawType);
  const projetValue = city ? `${typeLabel} ${city}` : `${typeLabel}`;

  // ✅ Agent immobilier (fallbacks réels MoteurImmo)
  const agentName =
    saved.publisher?.contactName ||
    saved.publisher?.name ||
    saved.contact?.name ||
    "";

  const agentPhone =
    saved.publisher?.contactPhone ||
    saved.publisher?.phone ||
    saved.contact?.phone ||
    "";

  // ✅ Date du jour
  const today = new Date().toISOString().split("T")[0];

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

    // ✅ AGENT IMMO — FONCTIONNE
    "Agence / AI": {
      rich_text: [{
        type: "text",
        text: { content: agentName }
      }]
    },

    // ✅ TÉLÉPHONE — FONCTIONNE
    "Téléphone AI": {
      rich_text: [{
        type: "text",
        text: { content: agentPhone }
      }]
    },

    // ✅ DATE — FONCTIONNE
    "Date de validation": {
      date: {
        start: today
      }
    },

    // ✅ inchangé
    "Confirmation du duo": {
      checkbox: true
    }
  };
}
