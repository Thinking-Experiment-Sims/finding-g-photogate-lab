declare module '@vernier/godirect' {
  const godirect: { createDevice(bleDevice: unknown): Promise<unknown> };
  export default godirect;
}
