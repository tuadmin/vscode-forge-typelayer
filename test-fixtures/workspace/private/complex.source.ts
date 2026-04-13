import { externalValue } from "#ext/external_api.ts";
import { formatInternal, SECRET_KEY } from "./_internal_helper.ts";

/**
 * Complex Entrypoint for Battle-Testing Aliases and Private Helpers
 * @generated Forge TypeLayer
 */
export function runProcess(name: string) {
  const info = formatInternal(`Processing ${name} with key ${SECRET_KEY}`);
  console.log(info);
  console.log(`API Status: ${externalValue}`);
  return { info, status: externalValue };
}

// Internal privasss
const result = runProcess("TestRunner");
console.log("Done:", result.status);
