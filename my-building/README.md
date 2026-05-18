# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Vercel deployment notes

- Set the Vercel project root directory to `my-building` if your Git repository root is `AI_Building`.
- Framework preset: `Vite`
- Build command: `npm run build`
- Output directory: `dist`

Environment variables:

- `VITE_MCP_API_URL`: deployed backend base URL for chat. Leave empty only if `/chat` is handled on the same domain.
- `VITE_MCP_CHAT_PATH`: usually `/chat`
- `VITE_BUILDING_API_BASE`: deployed PostgREST/data API base URL for building telemetry. Leave empty only if those endpoints are exposed on the same domain.
- `VITE_POWER_API_BASE`: deployed power API base URL. Leave empty only if those endpoints are exposed on the same domain.

Important:

- Vite `server.proxy` only works in local development. It does not run on Vercel production builds.
- Any frontend fallback pointing to `localhost` will fail on Vercel, because the browser runs on the user device, not on your machine.
