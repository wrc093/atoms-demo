# Vendored syntax validation dependencies

MIT-licensed packages from PyPI wheels. Imported only inside the isolated HTML checker subprocess. No network access or package installation is needed at runtime.

- html5lib-1.1-py2.py3-none-any.whl: SHA-256 `0d78f8fde1c230e99fe37986a60526d7049ed4bf8a9fadbad5f00e22e58e041d`
- six-1.17.0-py2.py3-none-any.whl: SHA-256 `4721f391ed90541fddacab5acf947aa0d3dc7d27b2e1e8eda2be8970586c3274`
- webencodings-0.5.1-py2.py3-none-any.whl: SHA-256 `a0af1213f3c2226497a97e2b3aa01a7e4bee4f403f95be16fc9acd2947514a78`

`postcss-parser.cjs` contains the parser, input and tokenizer from PostCSS 8.5.31 and their runtime dependencies. It is used only by the isolated Node CSS checker. No PostCSS plugins run, source maps are disabled, and CSS imports/URLs are not fetched. Versions, npm integrity hashes and the bundle SHA-256 are recorded in `postcss-parser.manifest.json`; all dependency licenses are in `licenses/`.

To rebuild from pinned official npm packages (including transitive dependencies):

```bash
node deploy/build-css-parser.mjs
```

Only this maintenance command downloads build dependencies to a temporary directory. Normal application startup, validation, and Service Base installation need no npm install.
