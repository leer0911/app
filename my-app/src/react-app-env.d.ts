/// <reference types="react-scripts" />

declare module "*.less" {
  const classes: Record<string, string>;
  export default classes;
}
