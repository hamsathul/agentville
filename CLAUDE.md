# Agentville: notes for Claude

## Keep the docs in step with the code

Every change that adds or changes a feature updates the docs in the same change. A feature isn't
done until the docs match it. Fixes that change what the dashboard shows or does count too.

- **README.md**: the feature list at the top, the feature's own section, and the privacy and
  troubleshooting notes when the change touches them (what is stored, sent or served; what can
  go wrong).
- **docs/** screenshots (`farm.png`, `farm-night.png`): refresh them when the change shows in
  them. If you can't, say they are out of date.

