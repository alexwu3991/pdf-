
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

export async function extractTextFromImage(base64Data: string): Promise<string> {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key not found in environment");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  // Using gemini-3-flash-preview for high speed and good vision capabilities
  const model = 'gemini-3-flash-preview';
  
  const imagePart = {
    inlineData: {
      mimeType: 'image/jpeg',
      data: base64Data,
    },
  };

  const textPart = {
    text: "這是一張中文佛教書籍的掃描頁面。請精確地提取頁面中的所有繁體中文文字。保持原有的段落結構，不要加入任何註釋。如果頁面有標號（如頁碼），也請一併提取。請以純文字格式輸出。"
  };

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: model,
      contents: { parts: [imagePart, textPart] },
      config: {
        temperature: 0.1, // Low temperature for higher accuracy in OCR
      }
    });

    return response.text || "無法辨識文字";
  } catch (error) {
    console.error("OCR Error:", error);
    return `辨識出錯: ${error instanceof Error ? error.message : String(error)}`;
  }
}
