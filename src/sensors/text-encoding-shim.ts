// @vernier/godirect only requires 'text-encoding' as a fallback for runtimes without TextDecoder.
// Every browser that has Web Bluetooth already has the native one, so alias the package to it.
export const TextDecoder = globalThis.TextDecoder;
export const TextEncoder = globalThis.TextEncoder;
export default { TextDecoder, TextEncoder };
