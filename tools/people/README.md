How public/models/people was made (see public/models/people/PROVENANCE.md for sources). The scripts need
packages that are not project dependencies:

    npm i --no-save @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions meshoptimizer obj2gltf
    node tools/people/prep-rigged.mjs <folder of the Poly Pizza GLBs> public/models/people
    node tools/people/prep-posed.mjs "<unzipped Posed Background Characters by @Quaternius>" public/models/people/posed-humans

Faces: 128 px JPEGs in public/models/people/faces/, listed with m/f in public/models/people/manifest.json.
