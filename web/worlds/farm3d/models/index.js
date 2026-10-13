// The 3D farm's animals: for each, its model's credit, its height on the farm in metres, and the clips it plays
// (walk, idle, graze; run for the sheepdog), from the models in this folder. Made by scripts/farm3d-animals.mjs: don't edit by hand.
export const MODELS = {
  "cow": {
    "title": "Cow",
    "author": "Quaternius",
    "licence": "CC0 (public domain)",
    "source": "https://static.poly.pizza/48c5f4af-07d6-4493-a261-0919967afe85.glb",
    "height": 1.45,
    "clips": {
      "walk": "Walk",
      "idle": "Idle",
      "graze": "Idle"
    },
    "hop": false
  },
  "sheep": {
    "title": "Sheep",
    "author": "Quaternius",
    "licence": "CC0 (public domain)",
    "source": "https://static.poly.pizza/a4bd2c4e-fe71-4dbd-9881-cf3ac8a00bbf.glb",
    "height": 1,
    "clips": {
      "walk": "Jump",
      "idle": "Idle",
      "graze": "Idle"
    },
    "hop": true
  },
  "horse": {
    "title": "Horse",
    "author": "Quaternius",
    "licence": "CC0 (public domain)",
    "source": "https://static.poly.pizza/d37dbc87-ca61-4b2c-a2da-d2f0c4240bef.glb",
    "height": 1.8,
    "clips": {
      "walk": "Walk",
      "idle": "Idle",
      "graze": "Eating"
    },
    "hop": false
  },
  "whitehorse": {
    "title": "White Horse",
    "author": "Quaternius",
    "licence": "CC0 (public domain)",
    "source": "https://static.poly.pizza/3edc2bd9-3378-4b43-a50d-d5e1f858562b.glb",
    "height": 1.8,
    "clips": {
      "walk": "Walk",
      "idle": "Idle",
      "graze": "Eating"
    },
    "hop": false
  },
  "sheepdog": {
    "title": "Husky",
    "author": "Quaternius",
    "licence": "CC0 (public domain)",
    "source": "https://static.poly.pizza/611d25c7-430f-4bb5-ab2c-d8f5f3cb9712.glb",
    "height": 0.85,
    "clips": {
      "walk": "Walk",
      "idle": "Idle",
      "graze": "Idle_2_HeadLow",
      "run": "Gallop"
    },
    "hop": false
  },
  "deer": {
    "title": "Deer",
    "author": "Quaternius",
    "licence": "CC0 (public domain)",
    "source": "https://static.poly.pizza/4b6c2a41-43c7-404c-ae37-e8c4645ff93b.glb",
    "height": 1.5,
    "clips": {
      "walk": "Walk",
      "idle": "Idle",
      "graze": "Eating"
    },
    "hop": false
  },
  "stag": {
    "title": "Stag",
    "author": "Quaternius",
    "licence": "CC0 (public domain)",
    "source": "https://static.poly.pizza/a9c69fbc-bf7c-4585-9a49-a82e0be1ac6b.glb",
    "height": 1.8,
    "clips": {
      "walk": "Walk",
      "idle": "Idle",
      "graze": "Eating"
    },
    "hop": false
  },
  "fox": {
    "title": "Fox",
    "author": "Quaternius",
    "licence": "CC0 (public domain)",
    "source": "https://static.poly.pizza/e18e86df-1692-48d8-ac6e-1e25ab4ad574.glb",
    "height": 0.65,
    "clips": {
      "walk": "Walk",
      "idle": "Idle",
      "graze": "Eating"
    },
    "hop": false
  },
  "duck": {
    "title": "Duck",
    "author": "jeremy",
    "licence": "CC BY 3.0",
    "source": "https://static.poly.pizza/ea819ee1-f814-4d70-8997-04a33a54c11c.glb",
    "height": 0.5,
    "clips": {},
    "hop": false
  },
  "duckling": {
    "title": "Duck 🦆",
    "author": "Ashley Alicea",
    "licence": "CC BY 3.0",
    "source": "https://static.poly.pizza/ae89a98c-fa10-4c4e-bfa3-48f33095c136.glb",
    "height": 0.32,
    "clips": {},
    "hop": false
  }
};
