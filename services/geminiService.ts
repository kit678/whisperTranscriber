import { GoogleGenAI } from "@google/genai";
import { AiMode } from '../types';

const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

export const refineText = async (text: string, instruction: string): Promise<string> => {
     if (!apiKey) {
    throw new Error("API Key is missing. Refinement unavailable.");
  }

  try {
    // Using Gemini 3 Flash for text processing
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Original Text: "${text}"\n\nInstruction: ${instruction}\n\nOutput only the result.`,
    });

    return response.text || text;
  } catch (error) {
    console.error("Gemini Text Refine Error:", error);
    throw error;
  }
}