# Static deployment

Use the Node version in the repository's `.nvmrc`. Run these commands from `maas-ui/`.

```sh
npm ci
npm run build
```

Serve `out/` with a static web server. Set `NEXT_PUBLIC_TOKENHUB_BASE_PATH` during the build for a path-prefixed deployment. By default the console calls the API on the same origin. Forward /api/, /v1/, and /v1beta/ to the backend without rewriting their paths. For a separate API origin, set NEXT_PUBLIC_TOKENHUB_API_BASE_URL at build time and allow the frontend origin through CORS. Frontend build variables are public. Inject backend credentials through the service environment.
