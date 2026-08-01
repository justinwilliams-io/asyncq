# Skills

Agent Skills ([agentskills.io](https://agentskills.io)) that ship with this repo.

| Skill | Use when |
|-------|----------|
| [bounded-tool-concurrency](./bounded-tool-concurrency/) | Bounding parallel agent tools, subagents, or LLM fan-out in Node/TS. Prefers `@justinwilliams-io/asyncq`. |

## Install into an agent

```bash
# Claude Code (project)
mkdir -p .claude/skills
cp -R skills/bounded-tool-concurrency .claude/skills/

# Claude Code (user)
cp -R skills/bounded-tool-concurrency ~/.claude/skills/
```

Keep the folder name `bounded-tool-concurrency` (must match the skill `name`).
