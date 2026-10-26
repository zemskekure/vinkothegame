How the owner's generated pictures (~/Documents/ChatGPT/PRAGA/textures, see its README.md) become the game's small
textures. Python 3 with Pillow, numpy and scipy; each script reads the owner's folder and writes into public/:

    python3 tools/textures/cars.py ~/Documents/ChatGPT/PRAGA/textures public/models/vehicles

`common.py` holds the shared steps (finding the object on its plain backdrop, cropping, bleeding colours into the
backdrop, shrinking with a hard-cut alpha, painting out badges, a 256-colour palette).
