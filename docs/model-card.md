# Vision Model Card

## Candidate

- Upstream: `google/siglip2-base-patch16-224`
- Authoritative page checked: 2026-07-30
- Upstream license: Apache-2.0
- Intended upstream uses: zero-shot image classification, image-text retrieval, and vision encoding
- Upstream size: 0.4B F32 parameters according to the model page
- Input resolution suggested by the model identifier: 224 x 224; exact exported tensor contract is not yet established

## Release Status

Blocked. No browser-compatible, quantized, vision-only ONNX artifact with a verified source revision, conversion log, input/output tensor names, embedding size, checksum, accuracy sample, and Quest memory measurement has been selected. The upstream F32 checkpoint is not being packaged because its reported size is not a defensible standalone Quest browser payload.

The runtime implements a same-origin local model service, WebGPU-first initialization, WASM fallback, deterministic preprocessing, tensor validation, a bounded cancellable scheduler, and Cache Storage support. These are exercised without claiming model inference success.

## Required Artifact Record

Before adding a model, record:

- Exact upstream commit and files
- Conversion tool versions and command
- Quantization method and calibration set license
- SHA-256 and byte size
- Input name, shape, color order, resizing, mean, and standard deviation
- Output name, shape, embedding dimensions, and normalization
- ONNX opset and external-data files
- WebGPU and WASM compatibility
- Peak memory estimate and measured Quest values
- First and warm inference timings
- Fixture accuracy and regression thresholds
- Packaged text-embedding source, prompts, dimensions, and checksum

No image, crop, embedding, or label leaves the device.
