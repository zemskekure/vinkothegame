# People models: provenance

All character models here are by Quaternius (quaternius.com) and are dedicated to the public domain under
**CC0 1.0 Universal** (https://creativecommons.org/publicdomain/zero/1.0/). Nothing here is under the Quaternius
Asset License (QAL, https://quaternius.com/license.html, dated 2026-08-28): the QAL covers new releases only (on
2026-10-25 only "Bestiary – Dungeon Monsters Kit" uses it), and per QAL §7 it does not apply retroactively. Each
pack page below said "License CC0" on the download day; copies of those pages are in `docs/people-provenance/`.

Downloaded 2026-10-25. Only Standard (free) content. Credit is not required; the game credits "lidé: Quaternius (CC0)".

The quaternius.com download links (Google Drive folders) refused downloads that day ("quota exceeded"), so the
rigged models were taken from Poly Pizza, which hosts Quaternius' uploads as GLB and labels each one CC0 1.0. Poly
Pizza labels five of the ten Ultimate Modular Women "CC-BY 3.0" (Sci-Fi, Worker, Soldier, Witch, Suit); the pack is
CC0 on quaternius.com, but to stay on the safe side **none of those five is used**. Only models Poly Pizza itself
labels CC0 1.0 are here.

## Packs

| Pack | Pack page (licence) | archive.org snapshot (before the QAL) | Source of the files |
|---|---|---|---|
| Animated Men Pack (Feb 2019) | https://quaternius.com/packs/animatedmen.html (CC0) | https://web.archive.org/web/20260416205436/https://quaternius.com/packs/animatedmen.html | https://poly.pizza/bundle/Animated-Men-Pack-DAC9SDgMQT |
| Animated Women Pack (Feb 2019) | https://quaternius.com/packs/animatedwomen.html (CC0) | https://web.archive.org/web/20260327153904/https://quaternius.com/packs/animatedwomen.html | https://poly.pizza/bundle/Animated-Women-Pack-HHSKxnk1mY |
| Ultimate Modular Men (Feb 2022) | https://quaternius.com/packs/ultimatemodularcharacters.html (CC0) | https://web.archive.org/web/20260823220239/https://quaternius.com/packs/ultimatemodularcharacters.html | https://poly.pizza/bundle/Ultimate-Modular-Men-Pack-ZiH8muWqwQ |
| Ultimate Modular Women (2022) | https://quaternius.com/packs/ultimatemodularwomen.html (CC0) | https://web.archive.org/web/20260823220213/https://quaternius.com/packs/ultimatemodularwomen.html | https://poly.pizza/bundle/Ultimate-Modular-Women-Pack-aCBDXDdTNN (CC0-labelled models only) |
| Background Posed Humans (Aug 2018) | https://quaternius.com/packs/backgroundposedhumans.html (CC0) | – | https://opengameart.org/content/lowpoly-posed-humans (OpenGameArt, CC0), zip `Posed Background Characters by @Quaternius.zip`, its `License.txt` says CC0 1.0 |

## Files

SHA-256 of each original download, and what was made from it. The rigged GLBs were pruned to the clips the game
uses, deduplicated, resampled and meshopt-compressed (`tools/people/prep-rigged.mjs`); the posed humans' OBJs were
converted and merged into one GLB per body (`tools/people/prep-posed.mjs`).

| Here | Original (Poly Pizza model page → file) | SHA-256 of the original | Licence label at the source |
|---|---|---|---|
| animated-men/longsleeve.glb | https://poly.pizza/m/DLptRuewTn "Man in Long Sleeves" → static.poly.pizza/e6019b9f-aed0-400c-8df4-ce5b648e9b82.glb | 48536b0e0ea375f0831dbf5154b4c2eafda8b6c9c19ba0996dd298f2fcc9164c | CC0 1.0 |
| animated-men/shirt.glb | https://poly.pizza/m/fjHyMd5Wxw "Man" → 985eacbf-9dde-44b7-9270-4e35c8400b13.glb | 40c62848350df6d13cc6eed20f30c3406a7761542236d8a9f6c3a4060d005e97 | CC0 1.0 |
| animated-men/casual.glb | https://poly.pizza/m/HMnuH5geEG "Man" → 3746be88-6799-4817-929b-6bc067c47caa.glb | dad8fa3ca2bc7760892f9ff47f544941179e50acb2aa772cf9f035154a37fc58 | CC0 1.0 |
| animated-men/suit.glb | https://poly.pizza/m/mQnGoME1ez "Man in Suit" → 66b57880-bcb0-479a-8d72-5c3e88afaa39.glb | 31ff1539e7a9a209d4eb1107e696d798fedc7e35d84a58bbabfdc0f1b8b73763 | CC0 1.0 |
| animated-women/jacket.glb | https://poly.pizza/m/AQsd9ngvKU "Woman" → 906a0cbe-b0a4-4312-b898-0f974b6f6771.glb | bae371b11e0dcd5dbd26442025567ca9f7041781f3410259d6ec379bffcbac27 | CC0 1.0 |
| animated-women/casual.glb | https://poly.pizza/m/jpKRgGDxhk "Woman Casual" → 51d5abdd-bb87-4b8d-9967-21738ffb8437.glb | 99c4df0aaabd19022809facc68f5fb5f564d35df3a9893c273a31fdaacf68e96 | CC0 1.0 |
| animated-women/tanktop.glb | https://poly.pizza/m/XqzeZGB7iU "Woman in Tank Top" → 9a6a3e55-23ce-4d5c-89bc-7d3f30307ed0.glb | 9809532f4562ebfd3976bd96eeebd1efc1008d781aa71a15048db5bf5ae7344c | CC0 1.0 |
| animated-women/dress.glb | https://poly.pizza/m/zMyPlQXBzq "Woman in Dress" → a642af96-e239-4c5f-b50d-7661ff51deec.glb | 53db49ba84193beb60173e94396764c86f7805752582a81dfdfd7f0889a10783 | CC0 1.0 |
| modular-men/adventurer.glb | https://poly.pizza/m/5EGWBMpuXq "Adventurer" → bbe369ee-a686-42c7-adad-14356f5f2f15.glb | 4a8639cd8eee9d8a150464edc25eb0536ced464790704a64e40c8620d99f66db | CC0 1.0 |
| modular-men/farmer.glb | https://poly.pizza/m/7pn3R6hPvE "Farmer" → 81f2f0cf-6f53-4b57-92ea-dba0928620f2.glb | f7ae6e2596c6521d296fa5948783f1dac717807456ce5355e48719e81d15e9a6 | CC0 1.0 |
| modular-men/punk.glb | https://poly.pizza/m/BTALZymknF "Punk" → e56f23b5-3270-406f-8924-f77cad980c43.glb | 94afa8718093cc7f9e51cdc0b35f4432c1c2f1901177f98fbbbcb4c6fd79b163 | CC0 1.0 |
| modular-men/beach.glb | https://poly.pizza/m/DojKLcO34E "Beach Character" → f771a536-1c18-4a47-bb56-ceea4b603455.glb | 67c366f8c1e9ba3d3767213bc8660579a4f8028ed647a33c53d05596e8dd888c | CC0 1.0 |
| modular-men/hoodie.glb | https://poly.pizza/m/gKLBoRsyKe "Hoodie Character" → bcd66ec5-5e81-4901-a222-47abc875fe2a.glb | 0de1bcd789d409214cf82f66f61daeb53d2f7de6d914b23e7b3660bfb3dee61e | CC0 1.0 |
| modular-men/business.glb | https://poly.pizza/m/JFrLIKqvCH "Business Man" → e599abbe-7d73-488c-9d7e-3ead281e705c.glb | 82b81257c1e94cd9ee48cb1dcbe5ff506e81c9ce67cd0c5af542d8712dca546e | CC0 1.0 |
| modular-men/casual.glb | https://poly.pizza/m/kZ3DmIoGip "Casual Character" → 90a9e2d4-053f-42f1-99a2-8f5e1180ea7f.glb | fea7e71271203e7073f1a073fa1208de7402df276f87f80e149bf7589b5d46b4 | CC0 1.0 |
| modular-men/worker.glb | https://poly.pizza/m/Yg2bQZO6Hj "Worker" → 3a5f3056-ffe6-42eb-bd52-122afcbd22b2.glb | 9c28614f465b7dc105f908c20c22fc045f4b07caf8c5ef0e9f8049eceb6dd38d | CC0 1.0 |
| modular-women/punk.glb | https://poly.pizza/m/djXoqejw6w "Punk" → 1d368679-1d9a-4d5c-9095-877144b02d00.glb | 77cbb6838bf207fc948848ddb389ea43d4bb30c52ec62c5a2fc84bbf35c88c52 | CC0 1.0 |
| modular-women/formal.glb | https://poly.pizza/m/nIItLV9nxS "Animated Woman" (Formal) → 46d6db5a-3c9f-4238-8cdf-8eb7194498dc.glb | a6522fe53d15de21130a957d1bf2b8a9a58d4e4e9a12af646645b667a9bb2d17 | CC0 1.0 |
| modular-women/casual.glb | https://poly.pizza/m/qJ2gsTUBHL "Animated Woman" (Casual) → ba7a1955-ea51-4cb9-a561-188bdef0a6c7.glb | a2212729826b718e59e698211ed3951c22459b48733b1ee6a24fac0abf74dca8 | CC0 1.0 |
| modular-women/adventurer.glb | https://poly.pizza/m/ZwF0K7WBmu "Adventurer" → 69689495-028d-4b81-8678-792338a5693e.glb | 38e4e6429d8af5849bb23e9585266f8c17dfe3e987bda89dec58f606aaedcf31 | CC0 1.0 |
| posed-humans/male.glb, female.glb | OpenGameArt zip above (OBJ poses Standing, Walking, Sitting, Standing_Hips, Standing_Waving, LookingUp, Sitting_Cheering + 4 hairstyles each) | 31bb7e3ce0a43e6b48e81390ffc37ba0fa64f192b8e4133164df0862c9fe7193 | CC0 |

Left out on purpose (CC0 but off-style for everyday Prague): Modular Men Astronaut, SWAT, King; Modular Women
Hooded Adventurer (medieval, with a sword).

## Faces (faces/)

`faces/face_01.jpg` … `face_40.jpg` are not Quaternius'. They are generated images of fictional people made for this
game (originals in `../textures/faces/` next to the repository, 1254 px PNG), scaled to 128 px JPEG here. Which body
(m/f) each face goes on is in `manifest.json`.

## Garment fronts (fronts/)

`fronts/*.png` (a grey hoodie, a granny cardigan, a flannel shirt, a police-style jacket, a tourist T-shirt with the
castle, a waiter's shirt) are generated images made for this game, like the faces (originals in
`../textures/clothes/*_front.png`, 1254 px PNG with transparency), scaled to 192 px and cut to 64 colours. Which part
is the garment's body and which patch is its plain fabric is in `manifest.json` (`crop`, `patch`).
