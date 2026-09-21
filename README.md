# Flow Keys

A browser-based MIDI performance tool built with vanilla JavaScript, CSS, Web MIDI, and a Web Worker clock. An optional Electron host provides a native virtual MIDI output.

## Run locally

For a basic server with Python 3:

```sh
python3 -m http.server 8000
```

Open http://localhost:8000. For live reload, install Python's `livereload` package and run `python3 dev_server.py`.

## Publish to Vercel

1. Push this repository to your GitHub account. If creating a new repository, leave it empty (do not add a README, license, or gitignore), then run these commands using its actual URL:

   ```sh
   git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
   git push -u origin main
   ```

2. In Vercel, add a new project and import that repository.
3. Keep the **Root Directory** at the repository root, and select **Other** as the framework. The committed `vercel.json` configures the build command (`node scripts/build-static.mjs`), output directory (`dist`), and skips dependency installation.
4. Deploy. Subsequent pushes to the connected production branch can deploy automatically.

The deployment script copies only `index.html`, JavaScript, and CSS into `dist/`; no bundler or npm dependencies are needed. Electron, tests, documentation, and development tools are excluded from the published site. To preview the same output locally:

```sh
node scripts/build-static.mjs
python3 -m http.server 8000 --directory dist
```

Configuration reference: [Vercel project configuration](https://vercel.com/docs/project-configuration/vercel-json).

## Browser and desktop behavior

Use a browser with Web MIDI support and allow MIDI access when prompted. The hosted version uses Web MIDI; the native **Flow Keys Out** virtual port requires the [Electron desktop host](electron/README.md).

Songs, sections, mappings, and presets are saved in browser localStorage for each origin. Export your show from the local app and import it on the deployed URL to transfer your setup.

See [AGENTS.md](AGENTS.md) for architecture and development guidance.
