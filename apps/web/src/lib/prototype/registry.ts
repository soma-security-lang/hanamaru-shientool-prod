import { laneAScreens } from "@/features/lane-a/screens";
import { laneBScreens } from "@/features/lane-b/screens";
import { laneCScreens } from "@/features/lane-c/screens";

export const allScreens = [...laneAScreens, ...laneBScreens, ...laneCScreens];

function routePattern(pattern: string) {
  const normalized = pattern.replace(/:[^/]+/g, "__PARAM__");
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replaceAll("__PARAM__", "[^/]+")}/?$`);
}

export function findScreen(pathname: string) {
  return allScreens.find((screen) => screen.routes.some((route) => routePattern(route).test(pathname)));
}
