# License Audit

## Approved Runtime Foundations

| Dependency                    | Version           | License evidence                                                               | Decision                           |
| ----------------------------- | ----------------- | ------------------------------------------------------------------------------ | ---------------------------------- |
| `@iwsdk/core`                 | 0.4.2             | installed package metadata: MIT                                                | approved                           |
| `three` via `super-three`     | 0.181.0 alias     | installed lock/package metadata; transitive audit required in generated report | approved subject to release report |
| `@babylonjs/havok`            | 1.3.14 transitive | lock metadata: MIT                                                             | approved through IWSDK             |
| IWSDK Vite/reference packages | 0.4.2             | package metadata audit required in generated report                            | development only                   |

## Reference Repositories

Neither `ARDings/EverythingController` nor `aribornstein/mr-boxing` exposed a LICENSE/COPYING file in repository search. Their source and assets are not approved for copying or redistribution. Only independently rewritten concepts may be used.

## Models and Production Assets

- SigLIP2 candidate selection and its exact source revision, conversion chain, license, tensor contract, and checksums must be recorded in `docs/model-card.md` before a model is committed.
- Existing starter GLTF, texture, and audio files have no provenance record in this repository and are not approved as production assets until the license manifest identifies their origin.
- No boxer, glove, animation, texture, sound, or ONNX asset from either reference may be reused without documented origin and license.
- Original placeholders may be used for development when marked as such and emitted by the license manifest.

## Release Gate

`npm run assets:licenses` must fail for a distributable asset without origin, author, license identifier, source URL or original-work marker, and SHA-256 hash.
