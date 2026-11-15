import app from "./app.js";
import { PORT } from "./config.js";

app.listen(PORT, () => {
  console.info(`API server listening on port ${PORT}.`);
});
