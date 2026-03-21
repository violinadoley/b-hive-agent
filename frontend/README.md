Minimal live dashboard for B-Hive agent orchestration.

## Getting Started

1) Start backend API first (`backend/`):

```bash
npm run api:start
```

2) Start frontend (`frontend/`):

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

Optional backend URL override:

```bash
NEXT_PUBLIC_BACKEND_BASE=http://localhost:4000
```

## Current dashboard scope

- Live agent step updates via SSE (`/api/stream/events`)
- Agent graph status by node
- Decision timeline
- HCS verifiability pane (topic/sequence/commitment + Mirror link)

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
