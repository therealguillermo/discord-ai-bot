import { listSkills, readSkill } from "../agent/skills/index.js";
import type { ToolDefinition } from "./types.js";

/**
 * On-demand playbooks the agent can load. Keeps the system prompt short while still giving
 * precise tool/endpoint guidance for large surfaces like the Discord REST API.
 */
export const loadSkill: ToolDefinition = {
  name: "load_skill",
  description:
    "Load an agent skill (playbook). Call with no args to list skills. Call with `name` for the skill index, " +
    "or `name` + `topic` for a specific intent. Skills: " +
    "`music` (play/skip/queue/leave — e.g. topic=\"play\"), " +
    "`features` (coins, blackjack, coinflip, purge, vote timeout, images — e.g. topic=\"coinflip\"), " +
    "`discord-api` (mute/ban/channels/roles and other REST ops — e.g. topic=\"mute\"). " +
    "Load the matching skill before guessing tools or searching 240+ Discord endpoints cold.",
  input_schema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: 'Skill name, e.g. "music", "features", or "discord-api". Omit to list available skills.',
      },
      topic: {
        type: "string",
        description: 'Optional intent/keyword, e.g. "play", "skip", "blackjack", "mute".',
      },
    },
  },
  handler: async (input) => {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) {
      const skills = listSkills();
      if (skills.length === 0) return "No skills installed.";
      return skills.map((s) => `- **${s.name}**: ${s.description}`).join("\n");
    }
    const topic = typeof input.topic === "string" ? input.topic : undefined;
    return readSkill(name, topic);
  },
};
