import { openrouter } from "@openrouter/ai-sdk-provider";
import { openai } from "@ai-sdk/openai";
export const geminiModel = openrouter("google/gemini-2.5-pro-preview");
export const gptModel = openrouter("openai/gpt-4.1");
export const gptImageGeneration = openai.image("gpt-image-1");
