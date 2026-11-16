// thimble's Copilot CLI extension. The SDK comes from the CLI; everything else is ../../../lib (see PORT_MAP.md).
import { createCanvas, joinSession } from '@github/copilot-sdk/extension'

import { start } from '../../../lib/main.mjs'

await start({ joinSession, createCanvas })
