import { createServer } from "node:http";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const server = createServer(createApp(config));

server.listen(config.PORT, () => {
  console.log(
    `${config.PUBLIC_SERVICE_SLUG} listening on http://localhost:${config.PORT}`,
  );
});

function close(signal: string) {
  console.log(`${signal} received, closing API`);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", () => close("SIGINT"));
process.once("SIGTERM", () => close("SIGTERM"));
