// Phase A stub. Phase B replaces this with the real three-job process:
//   1. POST /api/v1/roll  — authenticated ingest from @faerrin/mouth
//   2. GET  /feed         — SSE hub fanning rolls out to OBS browser sources
//   3. GET  /*            — serve the built overlay (dist/)
const port = Number(process.env.PORT ?? 8787);

const server = Bun.serve({
  port,
  fetch() {
    return new Response("eerie: scaffold (Phase A)\n", {
      headers: { "content-type": "text/plain" },
    });
  },
});

console.log(`eerie listening on http://localhost:${server.port}`);
