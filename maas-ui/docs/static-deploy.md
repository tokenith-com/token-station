# Static deployment

Use the Node version in the repository's `.nvmrc`. Run these commands from `maas-ui/`.

```sh
npm ci
NEXT_PUBLIC_TOKENHUB_API_BASE_URL=https://api.example.com npm run build
```

Serve `out/` with a static web server. Set `NEXT_PUBLIC_TOKENHUB_BASE_PATH` during the build for a path-prefixed deployment. Configure CORS on the backend for the frontend origin. Frontend build variables are public. Inject backend credentials through the service environment.
