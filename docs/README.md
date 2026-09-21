# Documentation & Reports

This directory serves as the single centralized location for all project documentation, architecture audits, implementation reports, setup guides, and changelogs.

> **Note**: Any new documentation, audit reports, or design specifications should be created directly within this `docs/` folder.

---

## Index of Documents

### Setup & Local Development
- [**PGLITE_LOCAL_SETUP.md**](./PGLITE_LOCAL_SETUP.md) — Comprehensive guide for configuring and running Kan locally with embedded PGlite (zero Docker/PostgreSQL requirement).

### Architecture Audits
- [**AUDIT_DATABASE.md**](./AUDIT_DATABASE.md) — Database architecture audit evaluating SQLite vs. embedded PGlite.
- [**AUTH_FIRST_RUN_AUDIT.md**](./AUTH_FIRST_RUN_AUDIT.md) — Authentication audit analyzing first-run setup, signup/login flows, and local Better Auth configuration.
- [**MCP_AUDIT.md**](./MCP_AUDIT.md) — Comprehensive audit of Kan's Model Context Protocol (MCP) tool inventory, schema, and capabilities.
- [**MCP_HOSTED_BACKPORT_AUDIT.md**](./MCP_HOSTED_BACKPORT_AUDIT.md) — Backport audit and roadmap for hosted HTTP MCP server (`/api/mcp`).

### Implementation Reports
- [**PGLITE_IMPLEMENTATION_REPORT.md**](./PGLITE_IMPLEMENTATION_REPORT.md) — Verification report for embedded PGlite database implementation and migrations.
- [**LOCAL_MODE_IMPLEMENTATION_REPORT.md**](./LOCAL_MODE_IMPLEMENTATION_REPORT.md) — Implementation and verification report for local credential authentication and zero-service setup.

### Project Guidelines & History
- [**CONTRIBUTING.md**](./CONTRIBUTING.md) — Contribution guidelines and development workflow.
- [**CHANGELOG.md**](./CHANGELOG.md) — Release notes and version history.
