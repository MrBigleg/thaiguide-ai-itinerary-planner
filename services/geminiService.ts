
import { GoogleGenAI, Modality, Chat } from "@google/genai";
import { ItineraryResponse, GroundingChunk } from "../types";
import { decodeBase64, decodeAudioData } from "./audioUtils";

const apiKey = process.env.API_KEY || ''; 
const ai = new GoogleGenAI({ apiKey });

const SOMSRI_PERSONA = `
You are Somsri, a friendly, energetic, and knowledgeable local Thai tour guide. 
Identity:
- Name: Somsri.
- Role: Local Expert Guide for Thailand.
- Tone: Warm, polite (use "ka" at the end of sentences often), enthusiastic, and helpful.
- Style: Practical, cultural, and immersive. Occasionally uses Thai food metaphors for travel planning (like "adding spice" to a trip).

GUARDRAILS:
1. NEVER break character. You are a human guide, not an AI. 
2. REFUSE to answer questions unrelated to Thailand, travel, food, culture, or logistics. If asked about coding, math, or politics of other countries, politely steer back to Thailand (e.g., "I'm not sure about that, but I can tell you where to find the best Som Tum!").
3. Always provide safe and respectful recommendations.
`;

/**
 * Generates an itinerary using Maps and Search Grounding (gemini-2.5-flash)
 */
export const generateGroundedItinerary = async (
  prompt: string, 
  location?: GeolocationCoordinates
): Promise<ItineraryResponse> => {
  try {
    const toolConfig: any = {};
    if (location) {
      toolConfig.retrievalConfig = {
        latLng: {
          latitude: location.latitude,
          longitude: location.longitude
        }
      };
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        systemInstruction: `${SOMSRI_PERSONA} \nTask: Create a detailed travel itinerary. Suggest real places. Use Google Maps and Search to find locations, open times, and prices.`,
        tools: [{ googleMaps: {} }, { googleSearch: {} }],
        toolConfig,
      },
    });

    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks as GroundingChunk[];
    
    return {
      text: response.text || "No plan generated.",
      groundingChunks
    };
  } catch (error) {
    console.error("Error generating grounded itinerary:", error);
    throw error;
  }
};

/**
 * Performs deep reasoning for complex logistics (gemini-3-pro-preview with Thinking)
 */
export const analyzeComplexLogistics = async (prompt: string): Promise<string> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: prompt,
      config: {
        thinkingConfig: { thinkingBudget: 32768 }, // Max thinking budget
        systemInstruction: `${SOMSRI_PERSONA} \nTask: You are an expert logistics coordinator for Thailand travel. Analyze routes, crowds, weather, and cultural nuance deeply.`,
      },
    });
    return response.text || "Could not complete analysis.";
  } catch (error) {
    console.error("Error in thinking mode:", error);
    throw error;
  }
};

/**
 * Chat with an expert bot (gemini-3-pro-preview)
 */
export const createChatSession = (): Chat => {
  return ai.chats.create({
    model: "gemini-3-pro-preview",
    config: {
      systemInstruction: `${SOMSRI_PERSONA} \nTask: Answer questions about culture, food, etiquette, and travel plans in Thailand. Keep answers concise and helpful.`,
    }
  });
};

/**
 * Text-to-Speech (gemini-2.5-flash-preview-tts)
 */
export const generateSpeech = async (text: string): Promise<AudioBuffer> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error("No audio data returned");

    // Use a temporary context for decoding to avoid limits, ensure it's closed.
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    try {
      // Note: The TTS API returns a format that requires decoding.
      // We will use our custom decodeAudioData assuming raw PCM 24kHz mono/stereo.
      const audioBuffer = await decodeAudioData(
        decodeBase64(base64Audio),
        audioContext,
        24000,
        1
      );
      return audioBuffer;
    } finally {
      // Important: Close context to prevent leaking AudioContexts (browser limit ~6)
      await audioContext.close();
    }

  } catch (error) {
    console.error("TTS Error:", error);
    throw error;
  }
};

export const getLiveClient = () => {
    return ai.live;
}
