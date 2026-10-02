/**
 * Lists the model IDs your ANTHROPIC_API_KEY can use, so you can set ANTHROPIC_MODEL.
 * Usage: npm run models
 */
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY is not set in .env");
  process.exit(1);
}

const client = new Anthropic({ apiKey });

try {
  const page = await client.models.list({ limit: 100 });
  for await (const model of page) {
    console.log(`${model.id}\t${model.display_name}`);
  }
} catch (err) {
  console.error("Could not list models:", err instanceof Error ? err.message : err);
  process.exit(1);
}
