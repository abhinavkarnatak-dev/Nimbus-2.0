# Memory and skills

Memory is scoped to user, organization, repository, or task. Every recall records the memory identifier, scope, score, and a user-facing reason. Users can inspect, search, delete, disable, clear, and set retention. Tokens, secrets, complete terminal logs, hidden reasoning, and unredacted sensitive files are excluded.

Skills are immutable after publishing and assignable by supported scopes. Imports validate `SKILL.md`, frontmatter, archive size, file count, checksums, secrets, paths, and symlinks. Skill instructions do not grant tools or credentials. Scripts can run only inside a task sandbox under existing policy.
