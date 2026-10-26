How public/models/vehicles was made (authors and licences: public/models/vehicles/CREDITS.md). The model script
needs packages that are not project dependencies:

    npm i --no-save @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions meshoptimizer sharp
    node tools/vehicles/prep-models.mjs <folder with sketchfab/… and kenney-… downloads> public/models/vehicles

The scale, centring and facing of each model are set at run time (src/vehicles.js). The delivery box texture
(delivery-box.png, 32 px, plain turquoise with a lid seam) was drawn by a few lines of Python; any PNG of the same
name replaces it.
