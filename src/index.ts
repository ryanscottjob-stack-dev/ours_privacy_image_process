import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
if (config.allowPrivateUrls) {
  console.warn("ALLOW_PRIVATE_URLS is enabled. Do not use this setting on a public server.");
}

const app = createApp(config);
app.listen(config.port, () => {
  console.log(`Image processing service listening on http://localhost:${config.port}`);
});
