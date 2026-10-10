# Agentville: notes for Claude

## Keep the docs in step with the code

Every change that adds or changes a feature updates the docs in the same change. A feature isn't
done until the docs match it. Fixes that change what the dashboard shows or does count too.

- **README.md**: the feature list at the top, the feature's own section, and the privacy and
  troubleshooting notes when the change touches them (what is stored, sent or served; what can
  go wrong).
- **docs/** screenshots (`farm.png`, `farm-night.png`): refresh them when the change shows in
  them. If you can't, say they are out of date.
- **docs/worlds.md**, the guide to making a world: any change to what a world gets or can do
  (the scene's fields, the messages between the frame and the page, the hooks and their
  defaults, the people and props kits, `world.json`) updates the guide, its starter world and
  its checklist in the same change. Write it for coding agents as much as for people: Claude Code
  should be able to make a world from the guide alone, so keep its examples runnable.
- **A new built-in world** goes in the README's list of worlds and the guide's catalogue, with
  its own screenshot in `docs/`.

The demo video is on demand, not part of this: update its tour (`scripts/demo-video.mjs`) or
record it (`npm run demo`) only when asked.

## Several sessions at once

When `.private/WHO-IS-DOING-WHAT.md` exists (it is git-ignored), other Claude sessions may be working
in this repo too. Before starting, read it and `.private/coordination.md`: don't start what another
session has claimed, claim yours there, and add a dated line to the log when you start and land.
