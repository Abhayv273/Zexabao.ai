import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const getGeminiAPIResponse = async (message, previousInteractionId = null) => {
  try {
    const options = {
      model: "gemini-3.5-flash-lite",
      input: message,
    };

    if (previousInteractionId) {
      options.previous_interaction_id = previousInteractionId;
    }

    const interaction = await ai.interactions.create(options);

    // console.log("Gemini Interaction:", interaction);

    return {
      text: interaction.output_text,
      interactionId: interaction.id,
    };
  } catch (err) {
    console.log("Gemini Error:", err);
    throw err;
  }
};

export default getGeminiAPIResponse;