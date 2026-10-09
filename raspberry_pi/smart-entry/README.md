# SmartEntry · módulo Raspberry Pi

Interface web e ponte ZigBee da fechadura SmartEntry. O plano de desenvolvimento, a arquitetura e as decisões do projeto estão em [docs/plano-desenvolvimento.md](docs/plano-desenvolvimento.md), incluindo como rodar o projeto em desenvolvimento.

## shadcn/ui

This is a Next.js monorepo template with shadcn/ui.

## Adding components

To add components to your app, run the following command at the root of your `web` app:

```bash
pnpm dlx shadcn@latest add button -c apps/web
```

This will place the ui components in the `packages/ui/src/components` directory.

## Using components

To use the components in your app, import them from the `ui` package.

```tsx
import { Button } from "@workspace/ui/components/button";
```
