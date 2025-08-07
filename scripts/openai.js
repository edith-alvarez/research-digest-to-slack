// Example code from github.com/models
import OpenAI from "openai";
import core from "@actions/core";

const token = process.env["PAT_TOKEN"];
const endpoint = "https://models.inference.ai.azure.com";
const modelName = "gpt-4o";

export async function makeCompletion(systemPrompt, summaryInput) {
  if (!token) {
    core.setFailed("PAT_TOKEN is missing.");
    throw new Error("Missing PAT_TOKEN");
  }

  const client = new OpenAI({ baseURL: endpoint, apiKey: token });

  const response = await client.chat.completions.create({
    model: modelName,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: summaryInput }
    ]
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    core.setFailed("No content returned from model.");
    throw new Error("Empty response from model");
  }

  return content;
}
