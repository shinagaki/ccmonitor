---
allowed-tools: Bash, Edit, Grep
description: Release new version (patch/minor/major)
---

Release a new version of ccmonitor. Usage: /project:release patch|minor|major

Steps:
1. Update version string in ccmonitor.ts from current version to next $ARGUMENTS version
2. Stage all changes: git add .
3. Commit if there are staged changes: git commit -m "Prepare for $ARGUMENTS release"
4. Execute release: npm run release:$ARGUMENTS

This will automatically:
- Update package.json version
- Create git commit and tag
- Push to GitHub
- Publish to npm

Example usage:
- /project:release patch (3.0.1 → 3.0.2)
- /project:release minor (3.0.1 → 3.1.0)
- /project:release major (3.0.1 → 4.0.0)