import { searchNutritionSources } from "../../server/routes";

export const handler = async () => {
  try {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ results: await searchNutritionSources() }),
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: error instanceof Error ? error.message : "Nutrition source search failed." }),
    };
  }
};
