# Docs: the model and the game

This repository holds two things that grow together but are different:

## The Prague model (the city)

A faithful 3D model of a piece of central Prague, built from open data (ČÚZK RÚIAN, ZABAGED, DMR 5G / DMP 1G, the
orthophoto, OpenStreetMap) and street photos. It is data plus the tools that build it, and is meant to become an
open-source project of its own (plan: `~/Documents/ChatGPT/PRAGA/split-plan.md`).

- What: `tools/` (build pipeline), `data/` (houses.json, signs.json, drawn fronts, venues), `public/data/` (the built
  scene).
- Docs: `CLAUDE.md` (start here), `realism-workflow.md`, `review-brief.md`, `grid-app.md` (the tile dashboard and its
  pipeline), `claude-code-next.md`, `handoff.md` (history).
- How detail is added: 100 m tiles reviewed against street photos (the grid app on the mini).

## The game (played in the model)

The PS1-style game on top of the city: the pigeon, the courier, people, vehicles, look, story.

- What: `src/` (runtime), `public/models/` (people, vehicles), `public/game-settings.json`.
- Docs: **`game.md`** (vision, modes, NPCs, vehicles, story, easter eggs, status: start here),
  `venues.md` (sponsored interiors), `performance.md` (load and frame budgets, the packed data formats, how to measure),
  `people-provenance/`.

## Outside the repo (owner's folder `~/Documents/ChatGPT/PRAGA/`)

Texture prompts (`texture-prompts*.md`) and the generated textures (`textures/`), downloaded models and their
licences (`models/`, `models-research.md`, `quaternius-research.md`), early game research (`game-research.md`).
