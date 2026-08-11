---
role = "LLM Agent (Claude / Cursor / Copilot)"
concerns = "I need to know which version of the skill I'm operating under. If skill-data returns stale or empty context, I will produce generic advice rather than project-specific insights. I cannot detect my own staleness without skill-check."
desires = "skill-data output that is dense but not verbose. Clear instructions on which CLI commands to use during the skill session. A version number I can verify before starting."
stressor_ids = ["S-01", "S-03", "S-05"]
---

# Agent Persona

This persona voices the concerns of the LLM agent using `residual` tools during a skill session. Key insight: the agent cannot detect context staleness without explicit signals. skill-check and skill-data are the agent's primary grounding tools.

The agent's concerns:
- Operating on an old skill version without knowing it
- Receiving `skill-data` output that is empty (no stressors, no terminology) and producing vacuous responses
- Being unable to find the right `residual add` command syntax during a session
