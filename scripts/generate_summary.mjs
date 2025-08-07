import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import core from '@actions/core';
import { makeCompletion } from './openai.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function extractKeywords(text, keywords) {
  const found = [];
  for (const kw of keywords) {
    if (text.toLowerCase().includes(kw.toLowerCase())) {
      found.push(kw);
    }
  }
  return found;
}

function truncateByWords(text, maxWords = 2500) {
  return (text || "").split(/\s+/).slice(0, maxWords).join(" ");
}

function splitTextWithLimit(text, maxLen = 2900) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    let chunk = remaining.slice(0, maxLen);
    const lastNewline = chunk.lastIndexOf("\n");
    if (lastNewline > 1000) chunk = chunk.slice(0, lastNewline);
    chunks.push(chunk.trim());
    remaining = remaining.slice(chunk.length).trim();
  }
  return chunks;
}

function hardCodedSlackBlocks(summaryText) {
  const sections = [];
  const parts = summaryText.split(/\[SECTION\]\s*(.+)/g).map(s => s.trim()).filter(Boolean);

  const sectionEmojis = {
    "Summary": "🧠",
    "Top 5 Findings": "🔍",
    "Soundbites": "🎤",
    "Comms Summary": "📢",
    "One-liner": "💡",
    "LinkedIn Post": "🔗"
  };

  for (let i = 0; i < parts.length; i += 2) {
    const title = parts[i];
    const content = parts[i + 1] || "";

    const emoji = sectionEmojis[title] || "";
    const chunks = splitTextWithLimit(content, 2900);

    sections.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${emoji} ${title}:*`
      }
    });

    chunks.forEach(chunk => {
      sections.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: chunk
        }
      });
    });
  }

  return sections;
}

(async () => {
  const inputPath = process.argv[2] || "data/input.json";
  let articles;

  try {
    const raw = fs.readFileSync(inputPath, "utf-8");
    articles = JSON.parse(raw);
    core.info(`🧠 Loaded ${articles.length} research articles from ${inputPath}`);
    if (!articles.length) {
      core.setFailed("❌ No research articles found to summarize.");
      process.exit(1);
    }
    core.info(`📝 Summarizing article: ${articles[0].title}`);
  } catch (err) {
    core.setFailed("❌ Invalid JSON input: " + err.message);
    process.exit(1);
  }

  const HIGHLIGHT_KEYWORDS = [
    "Copilot", "AI Code Review", "Pair Programming with AI", "LLM in IDEs",
    "AI Developer Tools", "Developer Productivity AI", "Human-in-the-loop",
    "AI trust", "Education AI", "Responsible AI", "AI Alignment", "Fairness in AI",
    "AI open source", "AI Agents", "AI Assistants", "Autonomous Software Agents",
    "AI in APIs", "Developer Workflows", "Future of work"
  ];

  const article = articles[0];
  const rawTitle = article.title;
  const linkedTitle = rawTitle; // for parent message only
  const articleLink = `<${article.link}|Open full paper>`; // for thread
  const foundKeywords = extractKeywords(JSON.stringify(article), HIGHLIGHT_KEYWORDS);
  const shortFullText = truncateByWords(article.full_text, 2500);

  const summaryInput = `
**Title:** ${rawTitle}
**Matched Keywords:** ${foundKeywords.join(", ")}

**Abstract:**\n${article.summary || ""}

**Full Paper Content (truncated):**\n${shortFullText}
`;

  const systemPrompt = `
  You are an AI research advisor.
  
  Summarize the following research article using exactly six sections, labeled with [SECTION] headers, in this exact order:
  
  [SECTION] Summary  
  [SECTION] Top 5 Findings  
  [SECTION] Soundbites  
  [SECTION] Comms Summary  
  [SECTION] One-liner  
  [SECTION] LinkedIn Post
  
  You must prefix each section with [SECTION] in all caps, followed by the section title exactly as shown.
  Do not use markdown headings, bullets, or colons in place of the section markers.
  Respond in clear markdown, and bold any matched keywords.
  `;

  core.info("🤖 Generating structured research summary...");
  const summary = await makeCompletion(systemPrompt, summaryInput);

  const cleanedSummary = summary
    .replace(/```(markdown)?/gi, "")
    .replace(/```/g, "")
    .trim();

  const requiredSections = [
    "Summary", "Top 5 Findings", "Soundbites",
    "Comms Summary", "One-liner", "LinkedIn Post"
  ];

  const missingSections = requiredSections.filter(name => {
  const pattern = new RegExp(`(\\[SECTION\\]|\\*\\*|#+)\\s*${name}`, "i");
  return !pattern.test(cleanedSummary);
});

  if (missingSections.length > 0) {
    core.setFailed(`❌ Summary missing required sections: ${missingSections.join(", ")}`);
    fs.writeFileSync("invalid_summary_output.txt", summary);
    process.exit(1);
  }
  core.info("✅ Summary generated.");

  const today = new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric"
  });

   const parentPayload = {
    text: `📚 Research Briefing – ${today}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `📚 Research Briefing – ${today}`,
          emoji: true
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Here’s today’s top research insight:\n*${linkedTitle}*`
        }
      }
    ]
  };

  const threadReplyPayload = {
  text: "Full research breakdown below 👇",
  blocks: [
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `📌 *Matched Keywords:* ${foundKeywords.map(k => `\`${k}\``).join(", ")}`
        }
      ]
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${articleLink}`  // 👈 Add this line to include the clickable link
      }
    },
    { type: "divider" },
    ...hardCodedSlackBlocks(cleanedSummary)
  ]
};

  fs.writeFileSync("parent_payload.json", JSON.stringify(parentPayload, null, 2));
  fs.writeFileSync("thread_reply_payload.json", JSON.stringify(threadReplyPayload, null, 2));
  core.info("✅ Saved parent_payload.json and thread_reply_payload.json");
})();
