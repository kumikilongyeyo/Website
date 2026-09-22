import { onRequestGet as __api_config_js_onRequestGet } from "/Users/Klyde.Sosa/Downloads/Website/functions/api/config.js"
import { onRequestPost as __api_config_js_onRequestPost } from "/Users/Klyde.Sosa/Downloads/Website/functions/api/config.js"
import { onRequestDelete as __api_media_js_onRequestDelete } from "/Users/Klyde.Sosa/Downloads/Website/functions/api/media.js"
import { onRequestGet as __api_media_js_onRequestGet } from "/Users/Klyde.Sosa/Downloads/Website/functions/api/media.js"
import { onRequestPost as __api_media_js_onRequestPost } from "/Users/Klyde.Sosa/Downloads/Website/functions/api/media.js"
import { onRequestGet as __media___path___js_onRequestGet } from "/Users/Klyde.Sosa/Downloads/Website/functions/media/[[path]].js"
import { onRequestHead as __media___path___js_onRequestHead } from "/Users/Klyde.Sosa/Downloads/Website/functions/media/[[path]].js"

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
  {
      routePath: "/api/media",
      mountPath: "/api",
      method: "DELETE",
      middlewares: [],
      modules: [__api_media_js_onRequestDelete],
    },
  {
      routePath: "/api/media",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_media_js_onRequestGet],
    },
  {
      routePath: "/api/media",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_media_js_onRequestPost],
    },
  {
      routePath: "/media/:path*",
      mountPath: "/media",
      method: "GET",
      middlewares: [],
      modules: [__media___path___js_onRequestGet],
    },
  {
      routePath: "/media/:path*",
      mountPath: "/media",
      method: "HEAD",
      middlewares: [],
      modules: [__media___path___js_onRequestHead],
    },
  ]