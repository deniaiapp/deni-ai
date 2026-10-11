import "server-only";

import type { DiscordFeature } from "../discord-ui";
import { feature as computer } from "./computer";
import { feature as files } from "./files";
import { feature as groups } from "./groups";
import { feature as mcp } from "./mcp";
import { feature as notify } from "./notify";
import { feature as plugins } from "./plugins";
import { feature as routines } from "./routines";
import { feature as skills } from "./skills";
import { feature as tasks } from "./tasks";
import { feature as team } from "./team";

/** Every Discord area outside the core chat commands, in the order /help lists them. */
export const features: DiscordFeature[] = [team, groups, tasks, files, skills, routines, computer, plugins, mcp, notify];
