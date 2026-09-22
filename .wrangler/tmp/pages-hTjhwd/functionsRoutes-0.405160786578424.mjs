import { onRequestGet as __api_config_js_onRequestGet } from "/Users/Klyde.Sosa/Downloads/Website/functions/api/config.js"
import { onRequestPost as __api_config_js_onRequestPost } from "/Users/Klyde.Sosa/Downloads/Website/functions/api/config.js"

export const routes = [
    {
      routePath: "/api/config",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_config_js_onRequestGet],
    },
  {
      routePath: "/api/config",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_config_js_onRequestPost],
    },
  ]