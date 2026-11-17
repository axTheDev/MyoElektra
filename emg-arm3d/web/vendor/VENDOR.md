# Vendored libraries (offline-capable, no CDN)

## three.js r187 — npm `three@0.187.0`
- Source: official npm registry tarball
  `https://registry.npmjs.org/three/-/three-0.187.0.tgz` (fetched 2026-11-03)
- Integrity, checked against the registry metadata before extracting:
  - sha1 shasum `face29ee2de9bcc31a1b573a76f224e35e0b2894` — matched
  - sha512 `sha512-Qiu7R+Cmh8CstZsY1uJOSWnVlfo7ZtNLV7mF8Jltk3LB3AtDu9cRZlcnRKkAk8Y4z6KKw35z7Y7Urd7jWY8etA==` — matched
- Only `package/build/three.module.js` + `package/build/three.core.js` were
  extracted (three.module.js imports nothing else; r187 ships no minified build).
  The two file names are fixed by the internal `import './three.core.js'`,
  so the version lives in the directory name (`three-0.187.0/`) instead.
- sha256 of the extracted files:
  - `three.core.js`   `613e370f76638fdef83926642bf256dc9615684922de1ce1f63a8583e5d78578`
  - `three.module.js` `104f56145899722094556490d787aae0617cc2fc3382f31df02d724ea1aee341`
- License: MIT (https://github.com/mrdoob/three.js)
- Undo: delete this directory (nothing else references it at build time).

## three.js r187 GLTFLoader addon (same tarball)
- `package/examples/jsm/loaders/GLTFLoader.js` extracted to `three-0.187.0/GLTFLoader.js`
  from the same verified tarball above (sha1 + sha512 matched).
- It imports the bare specifier `'three'`, resolved by the import map in `index.html`,
  plus its own deps `../utils/BufferGeometryUtils.js` + `../utils/SkeletonUtils.js`
  (extracted to `web/vendor/utils/`, keep that relative layout).
- sha256:
  - `GLTFLoader.js`           `532ac726e120039acbcd6cf54328c57acbf7b438176afaa6951257126d11bff1`
  - `utils/BufferGeometryUtils.js` `7bda2a8ba836b2bcf67cb938d4b9e1bb5d1b1bc616817103ed858c0b58296ce7`
  - `utils/SkeletonUtils.js`       `b1632a703206c3d830de9fcbe515696770d04b71a15ee6b50afa6d2c3298c86f`
