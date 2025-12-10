# Nanobanana Gemini Chat

A lightweight browser chat client for Google Gemini models. Provide your Gemini API key, pick a model (defaults to `models/gemini-1.5-flash`), and exchange messages. Responses render text, images, videos, and file attachments exactly as Gemini sends them.

## Features
- In-browser chat UI with conversation history
- Model field accepts Gemini model IDs (defaults to `models/gemini-1.5-flash`) and auto-detects whether the model uses `generateContent` or `generateImages`
- Automatically routes prompts to `generateContent` (text/video) or `generateImages` (Imagen) based on the chosen model
- Handles multi-part responses (text, inline images/videos, and file links)
- Safety feedback surfaced when Gemini blocks a prompt or response

## Getting Started
1. Serve the folder with any static file server (for example: `npx serve`, `python3 -m http.server`, or your editor's live server).
2. Open `http://localhost:PORT/index.html` in a modern browser.
3. Paste your Gemini API key, enter the full model ID (for example `models/gemini-3-pro-image-preview`), and start chatting. Imagen models (e.g. `models/imagen-4.0-fast-generate-001`) will yield inline images; Gemini models respond with text.

> **Note:** The API key you enter stays in the browser session only; it is used directly in requests to the Gemini API and is not persisted by the app.

## Usage Tips
- You can swap models at any time between turns—type a new `models/...` identifier into the field. Imagen-series models render generated images directly in the chat.
- Multimedia responses stream back as inline Base64 data. Large responses may take a moment to render.
- If Gemini blocks a prompt or truncates a reply for safety reasons, the banner above the chat explains why so you can adjust your prompt.

## Caveats
- This project is a simple front-end helper and does not proxy or store requests. Keep your API key secure and avoid deploying the page publicly without adding a backend proxy and authentication.
- Availability varies by account; some models (such as `models/nonobanana-3`) require special access and will return a 404 until enabled.
- Text models share the full conversation history on each turn. Image-only models ignore history and treat every prompt independently. Refresh the page to start a fresh chat.

## Deployment
### GitHub Pages
1. Commit `index.html`, `styles.css`, `app.js`, and the `docs/` folder that mirrors the static files.
2. Push to GitHub and enable **GitHub Pages** in the repository settings using the `main` (or default) branch and the `/docs` directory.
3. Wait for Pages to publish, then visit `https://<username>.github.io/<repo>/` to use the app.

> Pages serves static assets only. The browser still calls the Gemini API directly, so keep your key private and rotate it if it leaks.
